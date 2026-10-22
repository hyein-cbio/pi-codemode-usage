import type { UsageRecord } from "./types.ts";

export interface DurationStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

export interface ModelRollup {
  provider: string | null;
  model: string | null;
  toolName: string | null;
  n: number;
  writeP50: number | null;
  executeP50: number | null;
}

export interface Summary {
  n: number;
  ok: number;
  error: number;
  notRun: number;
  write: DurationStats | null;
  execute: DurationStats | null;
  codeChars: DurationStats | null;
  models: ModelRollup[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty sample");
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? low;
  if (lo === hi) return low;
  return low + (high - low) * (rank - lo);
}

export function durationStats(values: readonly number[]): DurationStats | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

export function summarize(records: readonly UsageRecord[]): Summary {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = `${record.provider ?? ""}\n${record.model ?? ""}\n${record.toolName ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const models = [...groups.entries()]
    .map(([, group]) => {
      const first = group[0];
      return {
        provider: first?.provider ?? null,
        model: first?.model ?? null,
        toolName: first?.toolName ?? null,
        n: group.length,
        writeP50: durationStats(numbers(group, "writeMs"))?.p50 ?? null,
        executeP50: durationStats(numbers(group, "executeMs"))?.p50 ?? null,
      };
    })
    .sort((a, b) =>
      b.n - a.n ||
      `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`) ||
      (a.toolName ?? "").localeCompare(b.toolName ?? ""),
    );

  return {
    n: records.length,
    ok: records.filter((record) => record.outcome === "ok").length,
    error: records.filter((record) => record.outcome === "error").length,
    notRun: records.filter((record) => record.outcome === "not_run").length,
    write: durationStats(numbers(records, "writeMs")),
    execute: durationStats(numbers(records, "executeMs")),
    codeChars: durationStats(numbers(records, "codeChars")),
    models,
  };
}

function numbers(records: readonly UsageRecord[], key: "writeMs" | "executeMs" | "codeChars"): number[] {
  const values: number[] = [];
  for (const record of records) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  return values;
}
