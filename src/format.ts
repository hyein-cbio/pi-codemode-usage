import type { BenchRecord } from "./types.ts";
import type { DurationStats, Summary } from "./summary.ts";

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  const seconds = abs / 1000;
  const digits = seconds >= 10 ? 1 : 2;
  return `${sign}${seconds.toFixed(digits)}s`;
}

export function formatStatus(record: BenchRecord): string {
  const parts = ["codemode"];
  if (record.writeMs !== null) parts.push(`쓰기 ${formatDuration(record.writeMs)}`);
  if (record.executeMs !== null) parts.push(`실행 ${formatDuration(record.executeMs)}`);
  else parts.push("실행 안 됨");
  if (record.outcome === "error") parts.push("실패");
  return parts.join(" · ");
}

export function formatSummary(summary: Summary, options: { title: string; dbPath: string }): string[] {
  const lines = [
    options.title,
    `${summary.n}회 · 성공 ${summary.ok} · 실패 ${summary.error} · 미실행 ${summary.notRun}`,
    formatSample("쓰기", summary.write),
    formatSample("실행", summary.execute),
  ];

  if (summary.write && summary.execute && summary.write.mean > 0) {
    lines.push(`실행/쓰기 ${(summary.execute.mean / summary.write.mean).toFixed(2)} (평균)`);
  }
  if (summary.codeChars) {
    lines.push(`스크립트 p50 ${Math.round(summary.codeChars.p50)}자 · n=${summary.codeChars.n}`);
  }
  if (summary.models.length > 1) {
    for (const model of summary.models) {
      const name = [model.provider, model.model].filter((part) => part && part.length > 0).join("/") || "모델 없음";
      const write = model.writeP50 === null ? "쓰기 —" : `쓰기 p50 ${formatDuration(model.writeP50)}`;
      const execute = model.executeP50 === null ? "실행 —" : `실행 p50 ${formatDuration(model.executeP50)}`;
      lines.push(`${name}  n=${model.n}  ${write}  ${execute}`);
    }
  }
  lines.push(`DB ${options.dbPath}`);
  return lines;
}

function formatSample(label: string, stats: DurationStats | null): string {
  if (!stats) return `${label}  기록 없음`;
  return [
    `${label}  p50 ${formatDuration(stats.p50)}`,
    `p95 ${formatDuration(stats.p95)}`,
    `평균 ${formatDuration(stats.mean)}`,
    `n=${stats.n}`,
  ].join(" · ");
}
