import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { SCHEMA_VERSION, type BenchRecord, type Outcome } from "./types.ts";

const OUTCOMES = new Set<Outcome>(["ok", "error", "not_run"]);

export function resolveLogPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env.CODEMODE_BENCH_LOG?.trim();
  if (override) return expandHome(override, home);
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configured ? expandHome(configured, home) : join(home, ".pi", "agent");
  return join(agentDir, "codemode-bench", "runs.jsonl");
}

export function appendRecord(file: string, record: BenchRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

/** Missing files and broken lines are skipped. One valid record per line. */
export function readRecords(file: string): BenchRecord[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const records: BenchRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      continue;
    }
  }
  return records;
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is BenchRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<BenchRecord>;
  return (
    record.schema === SCHEMA_VERSION &&
    typeof record.toolCallId === "string" &&
    typeof record.outcome === "string" &&
    OUTCOMES.has(record.outcome)
  );
}
