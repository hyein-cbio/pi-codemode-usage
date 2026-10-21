import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { CodemodeRecorder, measureCode, readCode } from "../src/measure.ts";
import type { Clock, SessionMeta } from "../src/types.ts";

function clock(): { clock: Clock; set: (ms: number) => void } {
  let now = 0;
  return {
    clock: { mono: () => now, wall: () => "2026-10-21T17:00:00.000Z" },
    set: (ms: number) => {
      now = ms;
    },
  };
}

const meta: SessionMeta = {
  sessionId: "sess",
  sessionFile: "/tmp/sess.jsonl",
  cwd: "/workspace",
  thinkingLevel: "high",
  turnIndex: null,
};

function script(code: string): { type: string; id: string; name: string; arguments: { code: string } } {
  return { type: "toolCall", id: "call-1", name: "codemode", arguments: { code } };
}

describe("readCode and measureCode", () => {
  it("reads the code field and a raw script string", () => {
    assert.equal(readCode({ code: "return 1" }), "return 1");
    assert.equal(readCode("return 2"), "return 2");
    assert.equal(readCode({ code: 1 }), null);
    assert.equal(readCode(null), null);
  });

  it("measures size and the options line without keeping the source", () => {
    const stats = measureCode("\uFEFF// @options: {\"timeout_ms\": 1}\nreturn 1\n");
    assert.equal(stats.codeLines, 3);
    assert.equal(stats.hasOptionsLine, true);
    assert.equal(stats.codeSha256.length, 16);
    assert.equal(stats.codeBytes, Buffer.byteLength("\uFEFF// @options: {\"timeout_ms\": 1}\nreturn 1\n"));
    assert.equal(measureCode("return 1\n// @options: {}").hasOptionsLine, false);
    assert.equal(measureCode("").codeLines, 0);
  });
});

describe("CodemodeRecorder", () => {
  it("times script streaming separately from execute()", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.setTurn(2);
    recorder.onAssistant({ type: "thinking_start", contentIndex: 0 }, { provider: "anthropic", model: "claude" });
    time.set(400);
    recorder.onAssistant(
      {
        type: "toolcall_start",
        contentIndex: 1,
        partial: { content: [undefined, { type: "toolCall", id: "call-1", name: "codemode" }] },
      },
      { provider: "anthropic", model: "claude-sonnet" },
    );
    time.set(1900);
    recorder.onAssistant(
      { type: "toolcall_end", contentIndex: 1, toolCall: script("return 1\n") },
      { provider: "anthropic", model: "claude-sonnet" },
    );

    const record = recorder.onExecutionEnd(
      {
        toolCallId: "call-1",
        toolName: "codemode",
        isError: false,
        durationMs: 320,
        result: {
          content: [
            { type: "text", text: "Script completed" },
            { type: "image", data: "abc" },
          ],
          details: { calls: [{ durationMs: 100 }, { name: "read" }, { durationMs: 40 }] },
        },
      },
      meta,
    );

    assert.ok(record);
    assert.equal(record.writeMs, 1500);
    assert.equal(record.executeMs, 320);
    assert.equal(record.outcome, "ok");
    assert.equal(record.turnIndex, 2);
    assert.equal(record.provider, "anthropic");
    assert.equal(record.model, "claude-sonnet");
    assert.equal(record.thinkingLevel, "high");
    assert.equal(record.codeChars, "return 1\n".length);
    assert.equal(record.codeLines, 2);
    assert.equal(record.hasOptionsLine, false);
    assert.equal(
      record.codeSha256,
      createHash("sha256").update("return 1\n").digest("hex").slice(0, 16),
    );
    assert.equal(record.outputChars, "Script completed".length);
    assert.equal(record.nestedCallCount, 3);
    assert.equal(record.nestedExecuteMs, 140);
    assert.equal(JSON.stringify(record).includes("return 1"), false);
    assert.equal(recorder.flush(meta).length, 0);
  });

  it("starts the write clock before the tool name is known", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0 });
    time.set(250);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "late", name: "codemode", arguments: "return 1" },
    });
    const record = recorder.onExecutionEnd(
      { toolCallId: "late", toolName: "codemode", isError: false, durationMs: 10, result: { content: [] } },
      meta,
    );
    assert.equal(record?.writeMs, 250);
    assert.equal(record?.codeChars, "return 1".length);
    assert.equal(record?.outputChars, 0);
  });

  it("drops a block once a delta shows it is not codemode", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0 });
    recorder.onAssistant({
      type: "toolcall_delta",
      contentIndex: 0,
      partial: { content: [{ type: "toolCall", name: "bash" }] },
    });
    time.set(50);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "bash-1", name: "bash", arguments: { command: "ls" } },
    });
    assert.equal(
      recorder.onExecutionEnd(
        { toolCallId: "bash-1", toolName: "bash", isError: false, durationMs: 5 },
        meta,
      ),
      null,
    );
    assert.equal(recorder.flush(meta).length, 0);
  });

  it("keeps another tool's stream out of the codemode write window", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({
      type: "toolcall_start",
      contentIndex: 0,
      partial: { content: [{ type: "toolCall", name: "bash" }] },
    });
    time.set(800);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "bash-1", name: "bash", arguments: { command: "ls" } },
    });
    recorder.onAssistant({
      type: "toolcall_start",
      contentIndex: 1,
      partial: { content: [undefined, { type: "toolCall", name: "codemode" }] },
    });
    time.set(1000);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { id: "code-1", name: "codemode", arguments: { code: "return 1" } },
    });
    const record = recorder.onExecutionEnd(
      { toolCallId: "code-1", toolName: "codemode", isError: false, durationMs: 1 },
      meta,
    );
    assert.equal(record?.writeMs, 200);
  });

  it("records a failed run and a run that never executed", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0, toolName: "codemode" });
    time.set(10);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "err", name: "codemode", arguments: { code: "throw 1" } },
    });
    const failed = recorder.onExecutionEnd(
      { toolCallId: "err", toolName: "codemode", isError: true, durationMs: 15 },
      meta,
    );
    assert.equal(failed?.outcome, "error");
    assert.equal(failed?.executeMs, 15);

    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0, toolName: "codemode" });
    time.set(40);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "blocked", name: "codemode", arguments: { code: "return 1" } },
    });
    const skipped = recorder.onExecutionEnd(
      { toolCallId: "blocked", toolName: "codemode", isError: true },
      meta,
    );
    assert.equal(skipped?.outcome, "not_run");
    assert.equal(skipped?.executeMs, null);
    assert.equal(skipped?.writeMs, 30);
  });

  it("flushes a finished script that never started executing", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0, toolName: "codemode" });
    time.set(75);
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "abort", name: "codemode", arguments: { code: "return 1" } },
    });
    recorder.onMessageEnd();
    const [record] = recorder.flush(meta);
    assert.equal(record?.toolCallId, "abort");
    assert.equal(record?.writeMs, 75);
    assert.equal(record?.outcome, "not_run");
    assert.equal(recorder.flush(meta).length, 0);
  });

  it("ignores nested calls and duplicate execution events", () => {
    const recorder = new CodemodeRecorder({ clock: clock().clock });
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "outer", name: "codemode", arguments: { code: "return 1" } },
    });
    assert.equal(
      recorder.onExecutionEnd(
        {
          toolCallId: "outer/read",
          toolName: "codemode",
          isError: false,
          durationMs: 5,
          parentToolCallId: "outer",
        },
        meta,
      ),
      null,
    );
    const first = recorder.onExecutionEnd(
      { toolCallId: "outer", toolName: "codemode", isError: false, durationMs: 8 },
      meta,
    );
    const second = recorder.onExecutionEnd(
      { toolCallId: "outer", toolName: "codemode", isError: false, durationMs: 8 },
      meta,
    );
    assert.equal(first?.executeMs, 8);
    assert.equal(first?.writeMs, null);
    assert.equal(second, null);
  });

  it("forgets an unfinished block when the message ends", () => {
    const time = clock();
    const recorder = new CodemodeRecorder({ clock: time.clock });
    recorder.onAssistant({ type: "toolcall_start", contentIndex: 0, toolName: "codemode" });
    time.set(500);
    recorder.onMessageEnd();
    recorder.onAssistant({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id: "late", name: "codemode", arguments: { code: "return 1" } },
    });
    const [record] = recorder.flush(meta);
    assert.equal(record?.writeMs, null);
  });
});
