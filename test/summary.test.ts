import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDuration, formatSummary } from "../src/format.ts";
import { durationStats, summarize } from "../src/summary.ts";
import type { UsageRecord } from "../src/types.ts";

function record(overrides: Partial<UsageRecord> & Pick<UsageRecord, "toolCallId" | "outcome">): UsageRecord {
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
    toolName: "codemode",
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

  it("keeps codemode and codemode_o apart for the same model", () => {
    const summary = summarize([
      record({ toolCallId: "a", outcome: "ok", writeMs: 100, executeMs: 10 }),
      record({ toolCallId: "b", outcome: "ok", writeMs: 300, executeMs: 30 }),
      record({ toolCallId: "c", outcome: "ok", toolName: "codemode_o", writeMs: 5000, executeMs: 900 }),
    ]);
    assert.equal(summary.models.length, 2);
    const codemode = summary.models.find((model) => model.toolName === "codemode");
    const codemodeO = summary.models.find((model) => model.toolName === "codemode_o");
    assert.ok(codemode);
    assert.ok(codemodeO);
    assert.equal(codemode.n, 2);
    assert.equal(codemode.writeP50, 200);
    assert.equal(codemode.executeP50, 20);
    assert.equal(codemodeO.n, 1);
    assert.equal(codemodeO.writeP50, 5000);
    assert.equal(codemodeO.executeP50, 900);
    assert.equal(summary.models[0]?.toolName, "codemode");
  });

  it("shows the tool name in each model row", () => {
    const summary = summarize([
      record({ toolCallId: "a", outcome: "ok", toolName: "codemode" }),
      record({ toolCallId: "b", outcome: "ok", toolName: "codemode_o" }),
      record({ toolCallId: "c", outcome: "ok", toolName: null }),
    ]);
    const lines = formatSummary(summary, { title: "요약", dbPath: "/tmp/runs.sqlite" });
    for (const toolName of ["codemode", "codemode_o", "툴 없음"]) {
      assert.ok(lines.some((line) => line.startsWith(`anthropic/claude-sonnet · ${toolName}  n=1`)));
    }
  });
});

describe("format", () => {
  it("formats durations", () => {
    assert.equal(formatDuration(320), "320ms");
    assert.equal(formatDuration(1500), "1.50s");
    assert.equal(formatDuration(12500), "12.5s");
  });

  it("renders an empty summary with the log path", () => {
    const lines = formatSummary(summarize([]), { title: "코드 모드 사용 기록 · 이 세션", dbPath: "/tmp/runs.sqlite" });
    assert.match(lines[0] ?? "", /이 세션/);
    assert.match(lines[1] ?? "", /0회/);
    assert.equal(lines.at(-1), "DB /tmp/runs.sqlite");
  });
});
