import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { appendRecord, readRecords, resolveLogPath } from "../src/log.ts";
import type { BenchRecord } from "../src/types.ts";

const record: BenchRecord = {
  schema: 1,
  recordedAt: "2026-10-21T17:00:00.000Z",
  sessionId: "sess",
  sessionFile: null,
  cwd: "/workspace",
  provider: "anthropic",
  model: "claude-sonnet",
  thinkingLevel: "high",
  turnIndex: 1,
  toolCallId: "call-1",
  writeMs: 1500,
  executeMs: 320,
  outcome: "ok",
  codeChars: 8,
  codeBytes: 8,
  codeLines: 1,
  codeSha256: "abcdef0123456789",
  hasOptionsLine: false,
  outputChars: 4,
  nestedCallCount: 1,
  nestedExecuteMs: 20,
};

describe("log", () => {
  it("resolves the agent dir, an override, and a tilde", () => {
    assert.equal(
      resolveLogPath({}, "/home/hyein"),
      "/home/hyein/.pi/agent/codemode-bench/runs.jsonl",
    );
    assert.equal(
      resolveLogPath({ PI_CODING_AGENT_DIR: "~/agents" }, "/home/hyein"),
      "/home/hyein/agents/codemode-bench/runs.jsonl",
    );
    assert.equal(resolveLogPath({ CODEMODE_BENCH_LOG: "/tmp/bench.jsonl" }, "/home/hyein"), "/tmp/bench.jsonl");
  });

  it("appends one JSON object per line and skips a broken line", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemode-bench-"));
    const file = join(dir, "nested", "runs.jsonl");
    assert.deepEqual(readRecords(file), []);
    appendRecord(file, record);
    appendRecord(file, { ...record, toolCallId: "call-2", outcome: "error" });
    writeFileSync(file, `${readRecords(file).map((item) => JSON.stringify(item)).join("\n")}\nnot json\n\n`, "utf8");
    const records = readRecords(file);
    assert.equal(records.length, 2);
    assert.equal(records[1]?.toolCallId, "call-2");
    assert.equal(records[0]?.writeMs, 1500);
  });
});
