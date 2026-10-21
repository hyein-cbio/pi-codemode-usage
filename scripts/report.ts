import { formatSummary } from "../src/format.ts";
import { readRecords, resolveLogPath } from "../src/log.ts";
import { summarize } from "../src/summary.ts";

const args = process.argv.slice(2);
let file = resolveLogPath();
let session: string | undefined;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--file") {
    const next = args[index + 1];
    if (!next) throw new Error("--file 다음에 경로가 필요합니다.");
    file = next;
    index += 1;
    continue;
  }
  if (arg === "--session") {
    const next = args[index + 1];
    if (!next) throw new Error("--session 다음에 세션 id가 필요합니다.");
    session = next;
    index += 1;
    continue;
  }
  throw new Error(`알 수 없는 인자입니다: ${arg ?? ""}`);
}

const records = readRecords(file).filter((record) => session === undefined || record.sessionId === session);
const title = session === undefined ? "코드 모드 벤치 · 전체" : `코드 모드 벤치 · ${session}`;
console.log(formatSummary(summarize(records), { title, logPath: file }).join("\n"));
