import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createCodemodeUsageExtension } from "../extensions/codemode-usage.ts";
import { readRecords, sessionDbPath } from "../src/db.ts";
import type { Clock } from "../src/types.ts";

interface Harness {
  emit: (event: string, payload: unknown) => Promise<void>;
  run: (args: string) => Promise<void>;
  status: () => string | undefined;
  widget: () => string[] | undefined;
  widgetUpdates: (string[] | undefined)[];
  setSessionFile: (file: string | undefined) => void;
  notifications: string[];
  entries: unknown[];
}

function harness(dbDir: string, clock: Clock, options: { ephemeral?: boolean } = {}): Harness {
  const handlers = new Map<string, ((event: unknown, ctx: FakeCtx) => unknown)[]>();
  let command: ((args: string, ctx: FakeCtx) => Promise<void>) | undefined;
  let status: string | undefined;
  let widget: string[] | undefined;
  let sessionFile = options.ephemeral ? undefined : "/tmp/sess-1.jsonl";
  const widgetUpdates: (string[] | undefined)[] = [];
  const notifications: string[] = [];
  const entries: unknown[] = [];
  const ctx = {
    cwd: "/workspace",
    hasUI: true,
    thinkingLevel: "high" as const,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      setStatus(_key: string, text: string | undefined) {
        status = text;
      },
      setWidget(_key: string, content: string[] | undefined) {
        widget = content;
        widgetUpdates.push(content);
      },
    },
    sessionManager: {
      getSessionId: () => "sess-1",
      getSessionFile: () => sessionFile,
    },
  };

  const pi = {
    on(event: string, handler: (event: unknown, ctx: FakeCtx) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => undefined;
    },
    registerCommand(_name: string, options: { handler: (args: string, ctx: FakeCtx) => Promise<void> }) {
      command = options.handler;
    },
    appendEntry(_type: string, data: unknown) {
      entries.push(data);
    },
  };

  createCodemodeUsageExtension({ dbDir, clock })(pi as unknown as ExtensionAPI);

  return {
    notifications,
    entries,
    status: () => status,
    widget: () => widget,
    widgetUpdates,
    setSessionFile: (file) => {
      sessionFile = file;
    },
    async emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
    async run(args) {
      if (!command) throw new Error("command was not registered");
      await command(args, ctx);
    },
  };
}

interface FakeCtx {
  cwd: string;
  hasUI: boolean;
  thinkingLevel: "high";
  ui: {
    notify: (message: string) => void;
    setStatus: (key: string, text: string | undefined) => void;
    setWidget: (key: string, content: string[] | undefined) => void;
  };
  sessionManager: {
    getSessionId: () => string;
    getSessionFile: () => string | undefined;
  };
}

function manualClock(): { clock: Clock; set: (ms: number) => void } {
  let now = 0;
  return {
    clock: { mono: () => now, wall: () => "2026-10-21T17:00:00.000Z" },
    set: (ms: number) => {
      now = ms;
    },
  };
}

async function streamCall(bench: Harness, id: string, toolName = "codemode"): Promise<void> {
  const message = { role: "assistant", provider: "anthropic", model: "claude-sonnet" };
  await bench.emit("message_update", {
    type: "message_update",
    message,
    assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, toolName },
  });
  await bench.emit("message_update", {
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id, name: toolName, arguments: { code: "return 1" } },
    },
  });
}

describe("codemode usage extension", () => {
  it("does not measure, persist, or update UI in ephemeral sessions", async () => {
    const unexpectedClock = () => {
      throw new Error("ephemeral calls must not be measured");
    };
    const dbDir = join(mkdtempSync(join(tmpdir(), "codemode-usage-")), "usage");
    const bench = harness(dbDir, { mono: unexpectedClock, wall: unexpectedClock }, { ephemeral: true });

    await bench.emit("session_start", {});
    await bench.emit("turn_start", { turnIndex: 0 });
    for (const toolName of ["codemode", "codemode_o"]) {
      await streamCall(bench, toolName, toolName);
      await bench.emit("message_end", {});
      await bench.emit("tool_execution_end", {
        toolCallId: toolName,
        toolName,
        isError: false,
        durationMs: 80,
      });
    }
    await streamCall(bench, "unrun");
    await bench.emit("agent_end", {});
    await bench.emit("session_shutdown", {});

    assert.equal(existsSync(dbDir), false);
    assert.deepEqual(bench.entries, []);
    assert.deepEqual(bench.notifications, []);
    assert.deepEqual(bench.widgetUpdates, []);
    assert.equal(bench.status(), undefined);
  });

  it("ignores usage commands without accessing existing databases in ephemeral sessions", async () => {
    const dbDir = mkdtempSync(join(tmpdir(), "codemode-usage-"));
    const dbPath = sessionDbPath(dbDir, "sess-1");
    // Any attempt to read this as SQLite would fail, including the "all" command.
    writeFileSync(dbPath, "must not be opened as SQLite");
    const bench = harness(dbDir, manualClock().clock, { ephemeral: true });
    for (const args of ["", "session", "all", "path", "hide", "nope"]) await bench.run(args);

    assert.deepEqual(readdirSync(dbDir), ["sess-1.sqlite"]);
    assert.equal(readFileSync(dbPath, "utf8"), "must not be opened as SQLite");
    assert.deepEqual(bench.entries, []);
    assert.deepEqual(bench.notifications, []);
    assert.deepEqual(bench.widgetUpdates, []);
  });

  it("resets pending calls when switching through an ephemeral session", async () => {
    const dbDir = join(mkdtempSync(join(tmpdir(), "codemode-usage-")), "usage");
    const bench = harness(dbDir, manualClock().clock);
    await bench.emit("session_start", {});
    await streamCall(bench, "old-call");

    bench.setSessionFile(undefined);
    await bench.emit("session_start", {});
    await streamCall(bench, "ephemeral-call");
    await bench.emit("agent_end", {});
    await bench.emit("session_shutdown", {});

    bench.setSessionFile("/tmp/sess-1.jsonl");
    await bench.emit("session_start", {});
    await bench.emit("agent_end", {});
    assert.equal(existsSync(dbDir), false);
    assert.deepEqual(bench.entries, []);

    await streamCall(bench, "new-call");
    await bench.emit("tool_execution_end", {
      toolCallId: "new-call",
      toolName: "codemode",
      isError: false,
      durationMs: 80,
    });
    const records = readRecords(sessionDbPath(dbDir, "sess-1"));
    assert.equal(records.length, 1);
    assert.equal(records[0]?.toolCallId, "new-call");
    assert.equal(records[0]?.sessionFile, "/tmp/sess-1.jsonl");
  });

  it("writes a log line when codemode streams and then runs", async () => {
    const time = manualClock();
    const dbDir = mkdtempSync(join(tmpdir(), "codemode-usage-"));
    const dbPath = sessionDbPath(dbDir, "sess-1");
    const bench = harness(dbDir, time.clock);
    const code = "return tools.ls({ path: '.' })\n";

    await bench.emit("turn_start", { type: "turn_start", turnIndex: 3, timestamp: 0 });
    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant", provider: "anthropic", model: "claude-sonnet" },
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial: {
          content: [{ type: "toolCall", id: "call-1", name: "codemode", arguments: {} }],
        },
      },
    });
    time.set(1250);
    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant", provider: "anthropic", model: "claude-sonnet" },
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { type: "toolCall", id: "call-1", name: "codemode", arguments: { code } },
        partial: { content: [] },
      },
    });
    await bench.emit("message_end", { type: "message_end", message: { role: "assistant" } });
    await bench.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "codemode",
      isError: false,
      durationMs: 80,
      result: { content: [{ type: "text", text: "done" }], details: { calls: [{ durationMs: 70 }] } },
    });

    const [record] = readRecords(dbPath);
    assert.ok(record);
    assert.equal(record.toolName, "codemode");
    assert.equal(record.writeMs, 1250);
    assert.equal(record.executeMs, 80);
    assert.equal(record.sessionId, "sess-1");
    assert.equal(record.turnIndex, 3);
    assert.equal(record.nestedCallCount, 1);
    assert.equal(record.nestedExecuteMs, 70);
    assert.equal(JSON.stringify(record).includes("tools.ls"), false);
    assert.equal(bench.status(), undefined);
    assert.equal(bench.entries.length, 1);
    assert.equal(readRecords(dbPath).length, 1);

    await bench.emit("agent_end", { type: "agent_end", messages: [] });
    assert.equal(readRecords(dbPath).length, 1);

    await bench.run("");
    assert.match(bench.widget()?.[1] ?? "", /1회/);
    await bench.run("hide");
    assert.equal(bench.widget(), undefined);
    await bench.run("path");
    assert.equal(bench.notifications.at(-1), dbPath);
    await bench.run("nope");
    assert.match(bench.notifications.at(-1) ?? "", /사용법/);
  });

  it("does not record other tools, and keeps an unrun script at agent end", async () => {
    const time = manualClock();
    const dbDir = mkdtempSync(join(tmpdir(), "codemode-usage-"));
    const dbPath = sessionDbPath(dbDir, "sess-1");
    const bench = harness(dbDir, time.clock);

    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant", provider: "openai", model: "gpt" },
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial: { content: [{ type: "toolCall", name: "bash" }] },
      },
    });
    time.set(400);
    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: "bash-1", name: "bash", arguments: { command: "ls" } },
      },
    });
    await bench.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "bash-1",
      toolName: "bash",
      isError: false,
      durationMs: 10,
      result: { content: [{ type: "text", text: "README.md" }] },
    });

    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant", provider: "openai", model: "gpt" },
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, toolName: "codemode" },
    });
    time.set(650);
    await bench.emit("message_update", {
      type: "message_update",
      message: { role: "assistant", provider: "openai", model: "gpt" },
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 1,
        toolCall: { id: "code-1", name: "codemode", arguments: { code: "return 1" } },
      },
    });
    await bench.emit("agent_end", { type: "agent_end", messages: [] });

    const records = readRecords(dbPath);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.toolCallId, "code-1");
    assert.equal(records[0]?.toolName, "codemode");
    assert.equal(records[0]?.writeMs, 250);
    assert.equal(records[0]?.executeMs, null);
    assert.equal(records[0]?.outcome, "not_run");
    assert.equal(bench.status(), undefined);
  });
});
