import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";

import { SCHEMA_VERSION, type BenchRecord, type Outcome } from "./types.ts";

const OUTCOMES = new Set<Outcome>(["ok", "error", "not_run"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
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
);
CREATE INDEX IF NOT EXISTS runs_session ON runs (session_id, recorded_at);
CREATE INDEX IF NOT EXISTS runs_recorded ON runs (recorded_at);
`;

export interface ReadFilter {
  sessionId?: string;
}

/** Directory that holds one `<session-id>.sqlite` file per Pi session. */
export function resolveBenchDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env.CODEMODE_BENCH_DB?.trim() || env.CODEMODE_BENCH_LOG?.trim();
  if (override) return expandHome(override, home);
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configured ? expandHome(configured, home) : join(home, ".pi", "agent");
  return join(agentDir, "codemode-bench");
}

/** `dir/<session-id>.sqlite`. The id is restricted to a single path segment. */
export function sessionDbPath(dir: string, sessionId: string | null): string {
  return join(dir, `${safeSessionId(sessionId)}.sqlite`);
}

export function listSessionDbPaths(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sqlite"))
    .sort()
    .map((name) => join(dir, name));
}

/** Every session file in the directory, ordered by record time. */
export function readBenchRecords(dir: string): BenchRecord[] {
  const records = listSessionDbPaths(dir).flatMap((file) => readRecords(file));
  records.sort(
    (left, right) =>
      left.recordedAt.localeCompare(right.recordedAt) || left.toolCallId.localeCompare(right.toolCallId),
  );
  return records;
}

export function insertRecord(file: string, record: BenchRecord): void {
  withDb(file, (db) => {
    db.prepare(
      `INSERT INTO runs (
        schema, recorded_at, session_id, session_file, cwd, provider, model,
        thinking_level, turn_index, tool_call_id, write_ms, execute_ms, outcome,
        code_chars, code_bytes, code_lines, code_sha256, has_options_line,
        output_chars, nested_call_count, nested_execute_ms
      ) VALUES (
        $schema, $recorded_at, $session_id, $session_file, $cwd, $provider, $model,
        $thinking_level, $turn_index, $tool_call_id, $write_ms, $execute_ms, $outcome,
        $code_chars, $code_bytes, $code_lines, $code_sha256, $has_options_line,
        $output_chars, $nested_call_count, $nested_execute_ms
      )`,
    ).run({
      $schema: record.schema,
      $recorded_at: record.recordedAt,
      $session_id: record.sessionId,
      $session_file: record.sessionFile,
      $cwd: record.cwd,
      $provider: record.provider,
      $model: record.model,
      $thinking_level: record.thinkingLevel,
      $turn_index: record.turnIndex,
      $tool_call_id: record.toolCallId,
      $write_ms: record.writeMs,
      $execute_ms: record.executeMs,
      $outcome: record.outcome,
      $code_chars: record.codeChars,
      $code_bytes: record.codeBytes,
      $code_lines: record.codeLines,
      $code_sha256: record.codeSha256,
      $has_options_line: flagToSql(record.hasOptionsLine),
      $output_chars: record.outputChars,
      $nested_call_count: record.nestedCallCount,
      $nested_execute_ms: record.nestedExecuteMs,
    });
  });
}

/** Missing files yield no rows. Rows from an unknown schema are skipped. */
export function readRecords(file: string, filter?: ReadFilter): BenchRecord[] {
  if (!existsSync(file)) return [];
  return withDb(file, (db) => {
    const rows = db
      .prepare(
        `SELECT
          schema, recorded_at, session_id, session_file, cwd, provider, model,
          thinking_level, turn_index, tool_call_id, write_ms, execute_ms, outcome,
          code_chars, code_bytes, code_lines, code_sha256, has_options_line,
          output_chars, nested_call_count, nested_execute_ms
        FROM runs
        WHERE $session_id IS NULL OR session_id = $session_id
        ORDER BY recorded_at, rowid`,
      )
      .all({ $session_id: filter?.sessionId ?? null });
    const records: BenchRecord[] = [];
    for (const row of rows) {
      const record = toRecord(row);
      if (record) records.push(record);
    }
    return records;
  });
}

function withDb<T>(file: string, fn: (db: DatabaseSync) => T): T {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    return fn(db);
  } finally {
    db.close();
  }
}

function flagToSql(value: boolean | null): SQLInputValue {
  if (value === null) return null;
  return value ? 1 : 0;
}

function toRecord(row: Record<string, SQLOutputValue>): BenchRecord | null {
  const schema = numberOrNull(row.schema);
  const toolCallId = text(row.tool_call_id);
  const outcome = text(row.outcome);
  const recordedAt = text(row.recorded_at);
  if (schema !== SCHEMA_VERSION || toolCallId === null || recordedAt === null) return null;
  if (outcome === null || !OUTCOMES.has(outcome as Outcome)) return null;
  return {
    schema: SCHEMA_VERSION,
    recordedAt,
    sessionId: text(row.session_id),
    sessionFile: text(row.session_file),
    cwd: text(row.cwd),
    provider: text(row.provider),
    model: text(row.model),
    thinkingLevel: text(row.thinking_level),
    turnIndex: numberOrNull(row.turn_index),
    toolCallId,
    writeMs: numberOrNull(row.write_ms),
    executeMs: numberOrNull(row.execute_ms),
    outcome: outcome as Outcome,
    codeChars: numberOrNull(row.code_chars),
    codeBytes: numberOrNull(row.code_bytes),
    codeLines: numberOrNull(row.code_lines),
    codeSha256: text(row.code_sha256),
    hasOptionsLine: flagFromSql(row.has_options_line),
    outputChars: numberOrNull(row.output_chars),
    nestedCallCount: numberOrNull(row.nested_call_count),
    nestedExecuteMs: numberOrNull(row.nested_execute_ms),
  };
}

function text(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: SQLOutputValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function flagFromSql(value: SQLOutputValue | undefined): boolean | null {
  if (value === 1 || value === 1n) return true;
  if (value === 0 || value === 0n) return false;
  return null;
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

/** Pi session ids are alphanumeric plus `.`, `_`, and `-`. Anything else cannot be a filename. */
function safeSessionId(sessionId: string | null): string {
  const raw = sessionId?.trim() ?? "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(raw)) return "no-session";
  return raw;
}
