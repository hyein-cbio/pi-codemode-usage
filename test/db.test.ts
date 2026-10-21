import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { insertRecord, listSessionDbPaths, readBenchRecords, readRecords, resolveBenchDir, sessionDbPath } from "../src/db.ts";
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
  it("names one file per session id", () => {
    assert.equal(resolveBenchDir({}, "/home/hyein"), "/home/hyein/.pi/agent/codemode-bench");
    assert.equal(
      resolveBenchDir({ PI_CODING_AGENT_DIR: "~/agents" }, "/home/hyein"),
      "/home/hyein/agents/codemode-bench",
    );
    assert.equal(resolveBenchDir({ CODEMODE_BENCH_DB: "/tmp/bench" }, "/home/hyein"), "/tmp/bench");
    assert.equal(resolveBenchDir({ CODEMODE_BENCH_LOG: "~/bench" }, "/home/hyein"), "/home/hyein/bench");

    const dir = "/tmp/bench";
    assert.equal(sessionDbPath(dir, "01939b3e-7c2a-7000-8000-000000000001"), join(dir, "01939b3e-7c2a-7000-8000-000000000001.sqlite"));
    assert.equal(sessionDbPath(dir, "sess-1"), join(dir, "sess-1.sqlite"));
    assert.equal(sessionDbPath(dir, "../etc/passwd"), join(dir, "no-session.sqlite"));
    assert.equal(sessionDbPath(dir, null), join(dir, "no-session.sqlite"));
  });

  it("writes each session to its own file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemode-bench-"));
    assert.deepEqual(readRecords(sessionDbPath(dir, "sess")), []);
    insertRecord(sessionDbPath(dir, record.sessionId), record);
    insertRecord(sessionDbPath(dir, "other"), {
      ...record,
      toolCallId: "call-2",
      outcome: "error",
      sessionId: "other",
      writeMs: null,
      executeMs: null,
      hasOptionsLine: null,
      turnIndex: null,
    });

    const records = readRecords(sessionDbPath(dir, "sess"));
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], record);
    assert.equal(readRecords(sessionDbPath(dir, "other"))[0]?.writeMs, null);
    assert.deepEqual(
      listSessionDbPaths(dir).map((file) => file.slice(dir.length + 1)),
      ["other.sqlite", "sess.sqlite"],
    );
    assert.deepEqual(
      readBenchRecords(dir).map((item) => item.toolCallId),
      ["call-1", "call-2"],
    );
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
