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
  toolName: "codemode",
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
      toolName: "codemode_o",
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
    assert.equal(readRecords(sessionDbPath(dir, "other"))[0]?.toolName, "codemode_o");
    assert.deepEqual(
      listSessionDbPaths(dir).map((file) => file.slice(dir.length + 1)),
      ["other.sqlite", "sess.sqlite"],
    );
    assert.deepEqual(
      readBenchRecords(dir).map((item) => item.toolCallId),
      ["call-1", "call-2"],
    );
  });

  it("adds tool_name when an older runs table is opened", () => {
    const file = join(mkdtempSync(join(tmpdir(), "codemode-bench-")), "old.sqlite");
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE runs (
        schema INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        session_id TEXT,
        session_file TEXT,
        cwd TEXT,
        provider TEXT,
        model TEXT,
        thinking_level TEXT,
        turn_index INTEGER,
        tool_call_id TEXT NOT NULL,
        write_ms REAL,
        execute_ms REAL,
        outcome TEXT NOT NULL,
        code_chars INTEGER,
        code_bytes INTEGER,
        code_lines INTEGER,
        code_sha256 TEXT,
        has_options_line INTEGER,
        output_chars INTEGER,
        nested_call_count INTEGER,
        nested_execute_ms REAL
      )
    `);
    db.prepare(
      "INSERT INTO runs (schema, recorded_at, tool_call_id, outcome) VALUES (1, ?, ?, 'ok')",
    ).run("2026-10-21T17:00:00.000Z", "old-call");
    db.close();

    const [loaded] = readRecords(file);
    assert.equal(loaded?.toolCallId, "old-call");
    assert.equal(loaded?.toolName, null);

    insertRecord(file, { ...record, toolCallId: "new-call", toolName: "codemode_o" });
    const names = readRecords(file).map((item) => [item.toolCallId, item.toolName]);
    assert.deepEqual(names, [
      ["old-call", null],
      ["new-call", "codemode_o"],
    ]);
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
