import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { insertRecord, readUsageRecords, sessionDbPath } from "../src/db.ts";
import type { UsageRecord } from "../src/types.ts";

const reportScript = fileURLToPath(new URL("../scripts/report.ts", import.meta.url));
const record: UsageRecord = {
  schema: 1, recordedAt: "2026-11-06T00:00:00.000Z",
  sessionId: "sess-a", sessionFile: null, cwd: "/workspace",
  provider: "anthropic", model: "test-model", thinkingLevel: "off", turnIndex: 0,
  toolCallId: "ok", toolName: "codemode", writeMs: 100, executeMs: 40, outcome: "ok",
  codeChars: 8, codeBytes: 8, codeLines: 1, codeSha256: "abcdef0123456789",
  hasOptionsLine: false, outputChars: 2, nestedCallCount: 0, nestedExecuteMs: 0,
};

function report(dir: string, args: string[]) {
  // Use the matrix job's exact Node executable, never the host's default Node.
  const result = spawnSync(process.execPath, [
    "--disable-warning=ExperimentalWarning", "--experimental-strip-types", reportScript, ...args,
  ], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, CODEMODE_USAGE_DB: dir, CODEMODE_USAGE_LOG: "" },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function seed(dir: string): void {
  insertRecord(sessionDbPath(dir, "sess-a"), record);
  insertRecord(sessionDbPath(dir, "sess-a"), {
    ...record, toolCallId: "error", toolName: "codemode_o", outcome: "error", writeMs: 300, executeMs: 60,
  });
  insertRecord(sessionDbPath(dir, "sess-b"), {
    ...record, sessionId: "sess-b", toolCallId: "unrun", outcome: "not_run", writeMs: 500, executeMs: null,
    outputChars: null, nestedCallCount: null, nestedExecuteMs: null,
  });
}

describe("report CLI runtime parity", () => {
  it("renders a fixed cross-session summary and separate tool groups", (t) => {
    const root = mkdtempSync(join(tmpdir(), "codemode-report-한글-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    seed(root);
    const before = readUsageRecords(root);
    const result = report(root, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, [
      "코드 모드 사용 기록 · 전체",
      "3회 · 성공 1 · 실패 1 · 미실행 1",
      "쓰기  p50 300ms · p95 480ms · 평균 300ms · n=3",
      "실행  p50 50ms · p95 59ms · 평균 50ms · n=2",
      "실행/쓰기 0.17 (평균)",
      "스크립트 p50 8자 · n=3",
      "anthropic/test-model · codemode  n=2  쓰기 p50 300ms  실행 p50 40ms",
      "anthropic/test-model · codemode_o  n=1  쓰기 p50 300ms  실행 p50 60ms",
      `DB ${root}`, "",
    ].join("\n"));
    assert.deepEqual(readUsageRecords(root), before, "reporting must preserve stored metadata");
    const explicit = report(join(root, "unused"), ["--dir", root]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.stdout, result.stdout);
  });

  it("selects only the requested session or SQLite file", (t) => {
    const root = mkdtempSync(join(tmpdir(), "codemode-report-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    seed(root);
    const selected = report(root, ["--session", "sess-b"]);
    assert.equal(selected.status, 0, selected.stderr);
    assert.match(selected.stdout, /1회 · 성공 0 · 실패 0 · 미실행 1/);
    assert.match(selected.stdout, /실행  기록 없음/);
    assert.equal(selected.stdout.includes("실행/쓰기"), false);
    const file = sessionDbPath(root, "sess-a");
    const byFile = report(join(root, "unused"), ["--file", file]);
    assert.equal(byFile.status, 0, byFile.stderr);
    assert.ok(byFile.stdout.startsWith(`코드 모드 사용 기록 · ${file}\n`));
    assert.match(byFile.stdout, /2회 · 성공 1 · 실패 1 · 미실행 0/);
    assert.match(byFile.stdout, /쓰기  p50 200ms · p95 290ms · 평균 200ms · n=2/);
  });

  it("reports missing storage as empty without creating a database", (t) => {
    const root = mkdtempSync(join(tmpdir(), "codemode-report-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const missing = join(root, "missing");
    const result = report(missing, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0회 · 성공 0 · 실패 0 · 미실행 0/);
    assert.equal(existsSync(missing), false);
    const file = join(missing, "absent.sqlite");
    const byFile = report(root, ["--file", file]);
    assert.equal(byFile.status, 0, byFile.stderr);
    assert.match(byFile.stdout, /0회/);
    assert.equal(existsSync(file), false);
  });

  for (const flag of ["--file", "--dir", "--session", "--unknown"]) {
    it(`rejects invalid CLI arguments: ${flag}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "codemode-report-"));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const result = report(root, [flag]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, flag === "--unknown" ? /알 수 없는 인자/ : /경로가 필요|디렉터리가 필요|id가 필요/);
    });
  }
});
