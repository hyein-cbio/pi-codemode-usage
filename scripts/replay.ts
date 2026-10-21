import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatSummary } from "../src/format.ts";
import { appendRecord, readRecords } from "../src/log.ts";
import { CodemodeRecorder } from "../src/measure.ts";
import { summarize } from "../src/summary.ts";
import type { SessionMeta } from "../src/types.ts";

const logPath = join(mkdtempSync(join(tmpdir(), "codemode-bench-")), "runs.jsonl");
let now = 0;
const recorder = new CodemodeRecorder({
  clock: {
    mono: () => now,
    wall: () => "2026-10-21T17:00:00.000Z",
  },
});
const meta: SessionMeta = {
  sessionId: "replay",
  sessionFile: null,
  cwd: process.cwd(),
  thinkingLevel: "off",
  turnIndex: null,
};

function sample(id: string, code: string, writeMs: number, executeMs: number): void {
  recorder.setTurn(0);
  recorder.onAssistant(
    {
      type: "toolcall_start",
      contentIndex: 0,
      partial: { content: [{ type: "toolCall", id, name: "codemode" }] },
    },
    { provider: "anthropic", model: "claude-sonnet" },
  );
  now += writeMs;
  recorder.onAssistant(
    {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id, name: "codemode", arguments: { code } },
    },
    { provider: "anthropic", model: "claude-sonnet" },
  );
  const record = recorder.onExecutionEnd(
    {
      toolCallId: id,
      toolName: "codemode",
      isError: false,
      durationMs: executeMs,
      result: { content: [{ type: "text", text: "ok" }], details: { calls: [] } },
    },
    meta,
  );
  if (!record) throw new Error(`codemode call ${id} was not recorded`);
  appendRecord(logPath, record);
}

sample("call-a", "return tools.read({ path: 'README.md' })\n", 1800, 240);
sample("call-b", "// @options: {\"timeout_ms\": 1000}\nawait tools.bash({ command: 'ls' })\n", 900, 80);

const records = readRecords(logPath);
const first = records[0];
const second = records[1];
if (records.length !== 2 || !first || !second) {
  throw new Error(`expected 2 records, got ${records.length}`);
}
if (first.writeMs !== 1800 || first.executeMs !== 240) {
  throw new Error(`unexpected first sample: write ${first.writeMs} execute ${first.executeMs}`);
}
if (second.hasOptionsLine !== true) throw new Error("options line was not detected");
if (JSON.stringify(records).includes("tools.read")) {
  throw new Error("script source leaked into the log");
}

console.log(formatSummary(summarize(records), { title: "리플레이", logPath }).join("\n"));
