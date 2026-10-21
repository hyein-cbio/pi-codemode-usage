import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { insertRecord, readRecords, resolveDbPath } from "../src/db.ts";
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

describe("sqlite store", () => {
  it("resolves the agent dir, an override, and a tilde", () => {
    assert.equal(
      resolveDbPath({}, "/home/hyein"),
      "/home/hyein/.pi/agent/codemode-bench/runs.sqlite",
    );
    assert.equal(
      resolveDbPath({ PI_CODING_AGENT_DIR: "~/agents" }, "/home/hyein"),
      "/home/hyein/agents/codemode-bench/runs.sqlite",
    );
    assert.equal(resolveDbPath({ CODEMODE_BENCH_DB: "/tmp/bench.sqlite" }, "/home/hyein"), "/tmp/bench.sqlite");
    assert.equal(resolveDbPath({ CODEMODE_BENCH_LOG: "~/bench.sqlite" }, "/home/hyein"), "/home/hyein/bench.sqlite");
  });

  it("round-trips rows and filters by session", () => {
    const file = join(mkdtempSync(join(tmpdir(), "codemode-bench-")), "nested", "runs.sqlite");
    assert.deepEqual(readRecords(file), []);
    insertRecord(file, record);
    insertRecord(file, {
      ...record,
      toolCallId: "call-2",
      outcome: "error",
      sessionId: "other",
      writeMs: null,
      executeMs: null,
      hasOptionsLine: null,
      turnIndex: null,
    });

    const records = readRecords(file);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], record);
    assert.equal(records[1]?.toolCallId, "call-2");
    assert.equal(records[1]?.writeMs, null);
    assert.equal(records[1]?.hasOptionsLine, null);
    assert.deepEqual(readRecords(file, { sessionId: "sess" }).map((item) => item.toolCallId), ["call-1"]);
    assert.deepEqual(readRecords(file, { sessionId: "missing" }), []);
  });

  it("skips a row whose schema is not the current one", () => {
    const file = join(mkdtempSync(join(tmpdir(), "codemode-bench-")), "runs.sqlite");
    insertRecord(file, record);
    const db = new DatabaseSync(file);
    db.prepare("UPDATE runs SET schema = 99 WHERE tool_call_id = ?").run(record.toolCallId);
    db.close();
    assert.deepEqual(readRecords(file), []);
  });
});
