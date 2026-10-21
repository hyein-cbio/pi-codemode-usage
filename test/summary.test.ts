import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDuration, formatStatus, formatSummary } from "../src/format.ts";
import { durationStats, summarize } from "../src/summary.ts";
import type { BenchRecord } from "../src/types.ts";

function record(overrides: Partial<BenchRecord> & Pick<BenchRecord, "toolCallId" | "outcome">): BenchRecord {
  return {
    schema: 1,
    recordedAt: "2026-10-21T17:00:00.000Z",
    sessionId: "sess",
    sessionFile: null,
    cwd: "/workspace",
    provider: "anthropic",
    model: "claude-sonnet",
    thinkingLevel: "high",
    turnIndex: 0,
    writeMs: null,
    executeMs: null,
    codeChars: null,
    codeBytes: null,
    codeLines: null,
    codeSha256: null,
    hasOptionsLine: null,
    outputChars: null,
    nestedCallCount: null,
    nestedExecuteMs: null,
    ...overrides,
  };
}

describe("summary", () => {
  it("interpolates percentiles and skips missing durations", () => {
    const stats = durationStats([100, 300, 200]);
    assert.equal(stats?.p50, 200);
    assert.equal(stats?.min, 100);
    assert.equal(stats?.max, 300);
    assert.equal(stats?.mean, 200);
    const sparse = durationStats([0, 100]);
    assert.ok(sparse);
    assert.equal(sparse.p95, 95);
    assert.equal(durationStats([]), null);
  });

  it("rolls up outcomes and models", () => {
    const summary = summarize([
      record({ toolCallId: "a", outcome: "ok", writeMs: 1000, executeMs: 100, codeChars: 20 }),
      record({ toolCallId: "b", outcome: "error", writeMs: 3000, executeMs: 500, codeChars: 40 }),
      record({
        toolCallId: "c",
        outcome: "not_run",
        writeMs: 2000,
        provider: "openai",
        model: "gpt",
        codeChars: 60,
      }),
    ]);
    assert.deepEqual(
      { n: summary.n, ok: summary.ok, error: summary.error, notRun: summary.notRun },
      { n: 3, ok: 1, error: 1, notRun: 1 },
    );
    assert.equal(summary.write?.n, 3);
    assert.equal(summary.execute?.n, 2);
    assert.equal(summary.execute?.p50, 300);
    assert.equal(summary.models[0]?.n, 2);
    assert.equal(summary.models[1]?.model, "gpt");
  });
});

describe("format", () => {
  it("formats durations and the footer status", () => {
    assert.equal(formatDuration(320), "320ms");
    assert.equal(formatDuration(1500), "1.50s");
    assert.equal(formatDuration(12500), "12.5s");
    const status = formatStatus(
      record({ toolCallId: "a", outcome: "error", writeMs: 1500, executeMs: 320 }),
    );
    assert.equal(status, "codemode · 쓰기 1.50s · 실행 320ms · 실패");
    assert.match(formatStatus(record({ toolCallId: "b", outcome: "not_run", writeMs: 10 })), /실행 안 됨/);
  });

  it("renders an empty summary with the log path", () => {
    const lines = formatSummary(summarize([]), { title: "코드 모드 벤치 · 이 세션", dbPath: "/tmp/runs.sqlite" });
    assert.match(lines[0] ?? "", /이 세션/);
    assert.match(lines[1] ?? "", /0회/);
    assert.equal(lines.at(-1), "DB /tmp/runs.sqlite");
  });
});
