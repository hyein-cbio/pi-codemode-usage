/** Tool name of Pi's built-in code mode tool. */
export const CODEMODE_TOOL_NAME = "codemode";

/** JSONL record schema. Bump when a field changes meaning. */
export const SCHEMA_VERSION = 1 as const;

/** Session custom entry type. Not sent to the model. */
export const ENTRY_TYPE = "codemode-bench";

export type Outcome = "ok" | "error" | "not_run";

/**
 * One top-level `codemode` invocation.
 * The script source is never stored. `codeSha256` is a 16-hex prefix so
 * repeated scripts can be grouped without keeping the text.
 */
export interface BenchRecord {
  schema: typeof SCHEMA_VERSION;
  recordedAt: string;
  sessionId: string | null;
  sessionFile: string | null;
  cwd: string | null;
  provider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  turnIndex: number | null;
  toolCallId: string;
  /** Monotonic milliseconds from `toolcall_start` to `toolcall_end`. */
  writeMs: number | null;
  /** Pi's `durationMs` for `execute()`. Null when the tool did not run. */
  executeMs: number | null;
  outcome: Outcome;
  codeChars: number | null;
  codeBytes: number | null;
  codeLines: number | null;
  codeSha256: string | null;
  hasOptionsLine: boolean | null;
  outputChars: number | null;
  nestedCallCount: number | null;
  nestedExecuteMs: number | null;
}

export interface SessionMeta {
  sessionId: string | null;
  sessionFile: string | null;
  cwd: string | null;
  thinkingLevel: string | null;
  turnIndex: number | null;
}

/** `mono` is a monotonic clock in milliseconds. `wall` is an ISO timestamp. */
export interface Clock {
  mono(): number;
  wall(): string;
}

export const systemClock: Clock = {
  mono: () => performance.now(),
  wall: () => new Date().toISOString(),
};
