import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { formatSummary } from "../src/format.ts";
import { insertRecord, readBenchRecords, readRecords, resolveBenchDir, sessionDbPath } from "../src/db.ts";
import { CodemodeRecorder, type ExecutionEnd } from "../src/measure.ts";
import { summarize } from "../src/summary.ts";
import {
  ENTRY_TYPE,
  systemClock,
  type BenchRecord,
  type Clock,
  type SessionMeta,
} from "../src/types.ts";

const WIDGET_KEY = "codemode-bench";

export interface BenchExtensionOptions {
  /** Directory of per-session SQLite files. Defaults to ~/.pi/agent/codemode-bench/. */
  dbDir?: string;
  clock?: Clock;
}

/**
 * Record every top-level `codemode` or `codemode_o` call.
 *
 * Write time is the monotonic gap from `toolcall_start` to `toolcall_end`
 * for that tool call: how long the model spent streaming the script.
 * Execute time is Pi's `durationMs` on `tool_execution_end`: how long
 * `execute()` ran, including nested tool calls inside the script.
 */
export function createCodemodeBenchExtension(options: BenchExtensionOptions = {}) {
  const dbDir = options.dbDir ?? resolveBenchDir();
  const recorder = new CodemodeRecorder({ clock: options.clock });
  let logErrorNotified = false;

  return function codemodeBench(pi: ExtensionAPI): void {
    const commit = (records: readonly BenchRecord[], ctx: ExtensionContext): void => {
      for (const record of records) {
        try {
          insertRecord(sessionDbPath(dbDir, record.sessionId), record);
        } catch (error) {
          if (!logErrorNotified) {
            logErrorNotified = true;
            const message = error instanceof Error ? error.message : String(error);
            safeNotify(ctx, `코드 모드 벤치를 기록하지 못했습니다: ${message}`, "error");
          }
          continue;
        }
        try {
          pi.appendEntry(ENTRY_TYPE, record);
        } catch {
          // The SQLite row is the benchmark. The session entry is a copy.
        }
      }
    };

    pi.on("session_start", (_event, ctx) => {
      recorder.reset();
      logErrorNotified = false;
      safeWidget(ctx, undefined);
    });

    pi.on("session_shutdown", (_event, ctx) => {
      commit(recorder.flush(sessionMeta(ctx)), ctx);
    });

    pi.on("turn_start", (event) => {
      recorder.setTurn(event.turnIndex);
    });

    pi.on("message_update", (event) => {
      recorder.onAssistant(event.assistantMessageEvent, event.message);
    });

    pi.on("message_end", () => {
      recorder.onMessageEnd();
    });

    pi.on("tool_execution_end", (event, ctx) => {
      const execution: ExecutionEnd = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: event.result,
      };
      if (typeof event.durationMs === "number") execution.durationMs = event.durationMs;
      if (event.parentToolCallId !== undefined) execution.parentToolCallId = event.parentToolCallId;
      const record = recorder.onExecutionEnd(execution, sessionMeta(ctx));
      if (record) commit([record], ctx);
    });

    pi.on("agent_end", (_event, ctx) => {
      commit(recorder.flush(sessionMeta(ctx)), ctx);
    });

    pi.registerCommand("codemode-bench", {
      description: "코드 모드 작성·실행 시간 요약",
      handler: async (args, ctx) => {
        const command = args.trim();
        if (command === "hide") {
          safeWidget(ctx, undefined);
          safeNotify(ctx, "코드 모드 벤치 요약을 숨겼습니다.", "info");
          return;
        }
        if (command === "path") {
          safeNotify(ctx, sessionDbPath(dbDir, ctx.sessionManager.getSessionId()), "info");
          return;
        }
        if (command !== "" && command !== "session" && command !== "all") {
          safeNotify(ctx, "사용법: /codemode-bench [session|all|path|hide]", "warning");
          return;
        }

        const scope = command === "all" ? "all" : "session";
        const sessionId = ctx.sessionManager.getSessionId();
        const dbPath = scope === "all" ? dbDir : sessionDbPath(dbDir, sessionId);
        const records = scope === "all" ? readBenchRecords(dbDir) : readRecords(dbPath);
        const lines = formatSummary(summarize(records), {
          title: scope === "all" ? "코드 모드 벤치 · 전체" : "코드 모드 벤치 · 이 세션",
          dbPath,
        });
        if (ctx.hasUI) {
          safeWidget(ctx, lines);
          safeNotify(ctx, `${lines[0]} · ${lines[1]}`, "info");
        } else {
          safeNotify(ctx, lines.join("\n"), "info");
        }
      },
    });
  };
}

function sessionMeta(ctx: ExtensionContext): SessionMeta {
  return {
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile() ?? null,
    cwd: ctx.cwd,
    thinkingLevel: ctx.thinkingLevel ?? null,
    turnIndex: null,
  };
}

function safeNotify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // Headless modes can omit a notifier.
  }
}

function safeWidget(ctx: ExtensionCommandContext | ExtensionContext, lines: string[] | undefined): void {
  try {
    ctx.ui.setWidget(WIDGET_KEY, lines);
  } catch {
    // Headless modes can omit widgets.
  }
}

export default createCodemodeBenchExtension();
