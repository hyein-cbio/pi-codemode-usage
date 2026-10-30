import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { it } from "node:test";

import {
  createAgentSession, createCodemodeExtension, DefaultResourceLoader,
  ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionFactory, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

import { createCodemodeUsageExtension } from "../extensions/codemode-usage.ts";
import { listSessionDbPaths, readRecords, sessionDbPath } from "../src/db.ts";
import { summarize } from "../src/summary.ts";
import { ENTRY_TYPE } from "../src/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type EndEvent = {
  toolCallId: string;
  toolName: string;
  parentToolCallId?: string;
  durationMs?: number;
  isError: boolean;
  result: { content: { type: string; text?: string }[]; details?: { calls?: { durationMs?: number }[] } };
};

// Model output and the recorder's write clock are controlled. Pi's SDK, event dispatch, nested-tool pipeline,
// QuickJS workers, worker admission queue, and the extension's SQLite writes are real.
it("records Pi 1.4 parallel workers, queued execution and nested calls per session", { timeout: 30_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codemode-runtime-"));
  const dbDir = join(root, "usage");
  const previousLimit = process.env.PI_CODEMODE_MAX_WORKERS;
  process.env.PI_CODEMODE_MAX_WORKERS = "2";
  const sessions: AgentSession[] = [];
  const release = deferred();
  const occupied = deferred();
  const waiting = deferred();
  let heldCalls = 0;
  const nestedStarts = new Set<string>();
  const ends = new Map<string, EndEvent>();
  const order: string[] = [];
  const writes = new Map<string, { start?: number; end?: number }>();
  const extensionErrors: unknown[] = [];
  let writeTick = 0;
  const writeClock: ExtensionFactory = (pi) => {
    pi.on("message_update", (event) => {
      if (event.assistantMessageEvent.type === "toolcall_end") writeTick += 10;
    });
  };
  let queuedAt = 0;
  let admittedAt = 0;

  const observer: ExtensionFactory = (pi) => {
    pi.on("message_update", (event) => {
      const stream = event.assistantMessageEvent;
      if (stream.type === "toolcall_start") {
        const block = stream.partial.content[stream.contentIndex];
        if (block?.type === "toolCall") writes.set(block.id, { start: writeTick });
      } else if (stream.type === "toolcall_end") {
        const write = writes.get(stream.toolCall.id);
        if (write) write.end = writeTick;
      }
    });
    pi.on("tool_execution_start", (event) => {
      order.push(`start:${event.toolCallId}`);
      if (event.parentToolCallId) nestedStarts.add(event.parentToolCallId);
    });
    pi.on("tool_execution_update", (event) => {
      if (event.toolCallId === "queued" && queuedAt === 0) {
        // executeCodemode publishes its initial update immediately before admission.
        queuedAt = performance.now();
        waiting.resolve();
      }
    });
    pi.on("tool_execution_end", (event) => {
      order.push(`end:${event.toolCallId}`);
      ends.set(event.toolCallId, event as EndEvent);
    });
  };

  const gateParameters = Type.Object({ held: Type.Boolean() });
  const gate: ToolDefinition<typeof gateParameters> = {
    name: "gate", label: "gate", description: "Test-only worker barrier",
    parameters: gateParameters,
    async execute(_id, params) {
      if (params.held) {
        if (++heldCalls === 4) occupied.resolve();
        await release.promise;
      } else {
        if (admittedAt === 0) admittedAt = performance.now();
        // Overlap two nested calls so their sum is distinguishable from wall time.
        await delay(100);
      }
      return { content: [{ type: "text", text: "done" }], details: {} };
    },
  };

  async function makeSession(calls: ToolCall[]) {
    const cwd = root;
    const agentDir = join(root, "agent");
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      extensionFactories: [
        createCodemodeExtension({ models: false }), writeClock,
        createCodemodeUsageExtension({ dbDir, clock: { mono: () => writeTick, wall: () => new Date().toISOString() } }),
        observer,
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    const model = getModel("anthropic", "claude-sonnet-4-5")!;
    await modelRuntime.setRuntimeApiKey(model.provider, "test-only-unused-key");
    const sessionManager = SessionManager.create(cwd, join(root, "sessions"));
    const { session } = await createAgentSession({
      cwd, agentDir, model, modelRuntime, settingsManager, sessionManager,
      resourceLoader: loader, customTools: [gate], tools: ["codemode", "gate"],
    });
    sessions.push(session);
    await session.bindExtensions({ onError: (error) => { extensionErrors.push(error); } });
    session.agent.toolExecution = "parallel";
    let request = 0;
    session.agent.streamFunction = () => {
      const stream = createAssistantMessageEventStream();
      const content = request++ === 0 ? calls : [];
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content, stopReason: content.length ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        stream.push({ type: "start", partial: { ...message, content: [] } });
        for (const [contentIndex, toolCall] of content.entries()) {
          stream.push({ type: "toolcall_start", contentIndex, partial: { ...message, content: content.slice(0, contentIndex + 1) } });
          await delay(10);
          stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message });
        }
        stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
      })();
      return stream;
    };
    return { session, sessionManager, dbPath: sessionDbPath(dbDir, sessionManager.getSessionId()) };
  }

  const script = (id: string, code: string): ToolCall => ({ type: "toolCall", id, name: "codemode", arguments: { code } });
  const parallel = (held: boolean) => `await Promise.all([tools.gate({held:${held}}), tools.gate({held:${held}})]); text("done");`;
  const prompts: Promise<unknown>[] = [];
  try {
    const first = await makeSession([script("held-a", parallel(true)), script("held-b", parallel(true))]);
    const second = await makeSession([
      script("queued", parallel(false)),
      script("expired", '// @options: {"timeout_ms": 80}\ntext("must not run");'),
    ]);
    prompts.push(first.session.prompt("occupy both workers"));
    await Promise.race([occupied.promise, delay(10_000, undefined, { ref: false }).then(() => { throw new Error("workers did not reach the barrier"); })]);
    // Both scripts reached real nested tools concurrently, holding both worker slots.
    assert.equal(heldCalls, 4);
    prompts.push(second.session.prompt("queue behind the first session"));
    await Promise.race([waiting.promise, delay(10_000, undefined, { ref: false }).then(() => { throw new Error("queued script did not enter execute()"); })]);
    await delay(160);
    assert.equal(nestedStarts.has("queued"), false);
    assert.equal(ends.has("queued"), false);
    const expired = ends.get("expired");
    assert.ok(expired, "short-deadline script must fail while both workers remain held");
    assert.equal(expired.isError, true);
    assert.match(expired.result.content.map((part) => part.text ?? "").join("\n"), /while waiting for a free codemode worker/);
    assert.ok((expired.durationMs ?? 0) >= 70);
    assert.equal(nestedStarts.has("expired"), false);
    const releasedAt = performance.now();
    release.resolve();
    await Promise.all(prompts);

    const queued = ends.get("queued");
    assert.ok(queued);
    assert.equal(queued.isError, false);
    assert.ok(admittedAt >= releasedAt, "queued script must only start after capacity is released");
    const observedWait = releasedAt - queuedAt;
    assert.ok(observedWait >= 150);
    assert.ok((queued.durationMs ?? 0) >= observedWait + 90, "durationMs includes worker wait plus nested execution");

    const firstRows = readRecords(first.dbPath);
    const secondRows = readRecords(second.dbPath);
    assert.deepEqual(firstRows.map((row) => row.toolCallId).sort(), ["held-a", "held-b"]);
    assert.deepEqual(secondRows.map((row) => row.toolCallId).sort(), ["expired", "queued"]);
    assert.equal(listSessionDbPaths(dbDir).length, 2);
    for (const [rows, manager] of [[firstRows, first.sessionManager], [secondRows, second.sessionManager]] as const) {
      for (const row of rows) {
        const event = ends.get(row.toolCallId)!;
        assert.equal(row.sessionId, manager.getSessionId());
        assert.equal(row.sessionFile, manager.getSessionFile());
        assert.equal(row.executeMs, event.durationMs, "nested duration must not be added to outer durationMs");
        assert.equal(row.outcome, event.isError ? "error" : "ok");
        const write = writes.get(row.toolCallId)!;
        assert.ok(row.writeMs !== null && row.writeMs >= 0);
        assert.equal(row.writeMs, write.end! - write.start!);
        assert.equal(row.writeMs, 10, "worker wait is excluded from script writing time");
        const calls = event.result.details?.calls ?? [];
        const sum = calls.reduce((total, call) => total + (call.durationMs ?? 0), 0);
        assert.equal(row.nestedCallCount, calls.length);
        assert.ok(Math.abs((row.nestedExecuteMs ?? 0) - sum) <= 0.001);
        assert.ok(order.indexOf(`start:${row.toolCallId}`) < order.indexOf(`end:${row.toolCallId}`));
        for (const [id, child] of ends) {
          if (child.parentToolCallId !== row.toolCallId) continue;
          assert.ok(order.indexOf(`start:${row.toolCallId}`) < order.indexOf(`start:${id}`));
          assert.ok(order.indexOf(`end:${id}`) < order.indexOf(`end:${row.toolCallId}`));
        }
      }
      const entries = manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE);
      assert.equal(entries.length, rows.length, "one session copy for each SQLite row");
      const summary = summarize(rows);
      assert.equal(summary.n, rows.length);
      assert.equal(summary.execute?.mean, rows.reduce((sum, row) => sum + row.executeMs!, 0) / rows.length);
    }
    assert.equal(ends.size, 10, "four outer events and six nested events");
    assert.deepEqual(extensionErrors, []);
    t.diagnostic(JSON.stringify({
      observedWorkerWaitMs: Math.round(observedWait),
      queuedDurationMs: queued.durationMs,
      queuedNestedSumMs: secondRows.find((row) => row.toolCallId === "queued")?.nestedExecuteMs,
      expiredDurationMs: expired.durationMs,
      rowsPerSession: [firstRows.length, secondRows.length],
    }));
  } finally {
    release.resolve();
    await Promise.allSettled(sessions.map((session) => session.abort()));
    await Promise.allSettled(prompts);
    for (const session of sessions) session.dispose();
    if (previousLimit === undefined) delete process.env.PI_CODEMODE_MAX_WORKERS;
    else process.env.PI_CODEMODE_MAX_WORKERS = previousLimit;
    rmSync(root, { recursive: true, force: true });
  }
});
