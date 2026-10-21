import { createHash } from "node:crypto";

import {
  CODEMODE_TOOL_NAMES,
  SCHEMA_VERSION,
  systemClock,
  type BenchRecord,
  type Clock,
  type Outcome,
  type SessionMeta,
} from "./types.ts";

const TRACKED_TOOL_NAMES: ReadonlySet<string> = new Set(CODEMODE_TOOL_NAMES);

/** Assistant stream event, either Pi's in-process shape or the JSON wire shape. */
export interface LooseAssistantEvent {
  type: string;
  contentIndex?: number;
  id?: string;
  toolName?: string;
  toolCall?: {
    id?: string;
    name?: string;
    arguments?: unknown;
  };
  partial?: {
    content?: Array<{ type?: string; id?: string; name?: string } | undefined>;
  };
}

export interface ExecutionEnd {
  toolCallId: string;
  toolName: string;
  isError: boolean;
  durationMs?: number;
  parentToolCallId?: string;
  result?: unknown;
}

interface OpenWrite {
  startedAt: number;
}

interface PendingCall {
  toolCallId: string;
  toolName: string;
  writeMs: number | null;
  provider: string | null;
  model: string | null;
  turnIndex: number | null;
  codeChars: number | null;
  codeBytes: number | null;
  codeLines: number | null;
  codeSha256: string | null;
  hasOptionsLine: boolean | null;
}

export interface CodeStats {
  codeChars: number;
  codeBytes: number;
  codeLines: number;
  codeSha256: string;
  hasOptionsLine: boolean;
}

/**
 * The `codemode` parameter is `{ code: string }`. Grammar sampling can hand
 * the script over as a raw string instead of that object.
 */
export function readCode(args: unknown): string | null {
  if (typeof args === "string") return args;
  if (args !== null && typeof args === "object" && "code" in args) {
    const code = (args as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export function measureCode(code: string): CodeStats {
  const normalized = code.replace(/\r\n/g, "\n");
  return {
    codeChars: code.length,
    codeBytes: Buffer.byteLength(code),
    codeLines: normalized === "" ? 0 : normalized.split("\n").length,
    codeSha256: createHash("sha256").update(code).digest("hex").slice(0, 16),
    hasOptionsLine: /^\uFEFF?\s*\/\/\s*@options:/.test(code),
  };
}

export function readModel(message: unknown): { provider: string | null; model: string | null } {
  if (message === null || typeof message !== "object") {
    return { provider: null, model: null };
  }
  const record = message as { provider?: unknown; model?: unknown };
  return {
    provider: typeof record.provider === "string" ? record.provider : null,
    model: typeof record.model === "string" ? record.model : null,
  };
}

function isTrackedTool(name: string | undefined): name is string {
  return name !== undefined && TRACKED_TOOL_NAMES.has(name);
}

function blockName(event: LooseAssistantEvent): string | undefined {
  if (event.contentIndex === undefined) return undefined;
  const block = event.partial?.content?.[event.contentIndex];
  if (block?.type === "toolCall" && typeof block.name === "string" && block.name.length > 0) {
    return block.name;
  }
  return undefined;
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

function textLength(result: unknown): number | null {
  if (result === null || typeof result !== "object" || !("content" in result)) return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  let total = 0;
  for (const part of content) {
    if (
      part !== null &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      total += (part as { text: string }).text.length;
    }
  }
  return total;
}

function nestedStats(result: unknown): { count: number; executeMs: number } | null {
  if (result === null || typeof result !== "object" || !("details" in result)) return null;
  const details = (result as { details?: unknown }).details;
  if (details === null || typeof details !== "object" || !("calls" in details)) return null;
  const calls = (details as { calls?: unknown }).calls;
  if (!Array.isArray(calls)) return null;
  let executeMs = 0;
  for (const call of calls) {
    if (call !== null && typeof call === "object" && typeof (call as { durationMs?: unknown }).durationMs === "number") {
      const duration = (call as { durationMs: number }).durationMs;
      if (Number.isFinite(duration)) executeMs += duration;
    }
  }
  return { count: calls.length, executeMs: roundMs(executeMs) };
}

function emptyCode(): Pick<
  PendingCall,
  "codeChars" | "codeBytes" | "codeLines" | "codeSha256" | "hasOptionsLine"
> {
  return {
    codeChars: null,
    codeBytes: null,
    codeLines: null,
    codeSha256: null,
    hasOptionsLine: null,
  };
}

/**
 * Tracks each top-level `codemode` or `codemode_o` call.
 *
 * Write time starts when the assistant stream opens that tool-call block and
 * stops when the arguments are complete. Execution time is Pi's own
 * monotonic `execute()` duration, not the gap between extension events.
 */
export class CodemodeRecorder {
  private readonly clock: Clock;
  private turnIndex: number | null = null;
  private readonly open = new Map<number, OpenWrite>();
  private readonly pending = new Map<string, PendingCall>();
  private readonly done = new Set<string>();

  constructor(options?: { clock?: Clock }) {
    this.clock = options?.clock ?? systemClock;
  }

  setTurn(turnIndex: number): void {
    this.turnIndex = turnIndex;
  }

  /** Drop in-flight state. Recorded calls stay in the log. */
  reset(): void {
    this.turnIndex = null;
    this.open.clear();
    this.pending.clear();
    this.done.clear();
  }

  onAssistant(event: LooseAssistantEvent, message?: unknown): void {
    if (event.type === "toolcall_start") {
      this.openWrite(event);
      return;
    }
    if (event.type === "toolcall_delta") {
      this.noteName(event);
      return;
    }
    if (event.type === "toolcall_end") {
      this.closeWrite(event, message);
    }
  }

  /** A finished assistant message will not emit more deltas for its open blocks. */
  onMessageEnd(): void {
    this.open.clear();
  }

  onExecutionEnd(event: ExecutionEnd, meta: SessionMeta): BenchRecord | null {
    if (!isTrackedTool(event.toolName) || event.parentToolCallId !== undefined) return null;
    if (this.done.has(event.toolCallId)) return null;

    const call = this.pending.get(event.toolCallId);
    this.pending.delete(event.toolCallId);
    this.done.add(event.toolCallId);

    const ran = typeof event.durationMs === "number" && Number.isFinite(event.durationMs);
    const outcome: Outcome = !ran ? "not_run" : event.isError ? "error" : "ok";
    return this.toRecord(call, event.toolCallId, call?.toolName ?? event.toolName, meta, {
      executeMs: ran ? roundMs(event.durationMs as number) : null,
      outcome,
      result: event.result,
    });
  }

  /** Calls whose script finished streaming but never executed. */
  flush(meta: SessionMeta): BenchRecord[] {
    const records: BenchRecord[] = [];
    for (const call of this.pending.values()) {
      if (this.done.has(call.toolCallId)) continue;
      this.done.add(call.toolCallId);
      records.push(
        this.toRecord(call, call.toolCallId, call.toolName, meta, {
          executeMs: null,
          outcome: "not_run",
          result: undefined,
        }),
      );
    }
    this.pending.clear();
    this.open.clear();
    return records;
  }

  private openWrite(event: LooseAssistantEvent): void {
    if (event.contentIndex === undefined) return;
    const name = event.toolName ?? blockName(event);
    if (name !== undefined && !isTrackedTool(name)) {
      this.open.delete(event.contentIndex);
      return;
    }
    this.open.set(event.contentIndex, { startedAt: this.clock.mono() });
  }

  private noteName(event: LooseAssistantEvent): void {
    if (event.contentIndex === undefined) return;
    const name = event.toolName ?? blockName(event);
    if (name === undefined) return;
    if (!isTrackedTool(name)) this.open.delete(event.contentIndex);
  }

  private closeWrite(event: LooseAssistantEvent, message: unknown): void {
    const name = event.toolCall?.name ?? event.toolName ?? blockName(event);
    const open = event.contentIndex === undefined ? undefined : this.open.get(event.contentIndex);
    if (event.contentIndex !== undefined) this.open.delete(event.contentIndex);
    if (!isTrackedTool(name)) return;

    const toolCallId = event.toolCall?.id ?? event.id;
    if (toolCallId === undefined || toolCallId.length === 0) return;
    if (this.done.has(toolCallId) || this.pending.has(toolCallId)) return;

    const code = readCode(event.toolCall?.arguments);
    const stats = code === null ? emptyCode() : measureCode(code);
    const model = readModel(message);
    const writeMs = open === undefined ? null : roundMs(Math.max(0, this.clock.mono() - open.startedAt));

    this.pending.set(toolCallId, {
      toolCallId,
      toolName: name,
      writeMs,
      provider: model.provider,
      model: model.model,
      turnIndex: this.turnIndex,
      ...stats,
    });
  }

  private toRecord(
    call: PendingCall | undefined,
    toolCallId: string,
    toolName: string,
    meta: SessionMeta,
    execution: { executeMs: number | null; outcome: Outcome; result: unknown },
  ): BenchRecord {
    const nested = nestedStats(execution.result);
    return {
      schema: SCHEMA_VERSION,
      recordedAt: this.clock.wall(),
      sessionId: meta.sessionId,
      sessionFile: meta.sessionFile,
      cwd: meta.cwd,
      provider: call?.provider ?? null,
      model: call?.model ?? null,
      thinkingLevel: meta.thinkingLevel,
      turnIndex: call?.turnIndex ?? meta.turnIndex,
      toolCallId,
      toolName,
      writeMs: call?.writeMs ?? null,
      executeMs: execution.executeMs,
      outcome: execution.outcome,
      codeChars: call?.codeChars ?? null,
      codeBytes: call?.codeBytes ?? null,
      codeLines: call?.codeLines ?? null,
      codeSha256: call?.codeSha256 ?? null,
      hasOptionsLine: call?.hasOptionsLine ?? null,
      outputChars: textLength(execution.result),
      nestedCallCount: nested?.count ?? null,
      nestedExecuteMs: nested?.executeMs ?? null,
    };
  }
}
