# pi-codemode-bench

Pi 코딩 에이전트의 `codemode` 툴이 돌 때마다, 모델이 스크립트를 쓰는 시간과 그 스크립트가 실행되는 시간을 갈라 기록하는 확장입니다. 실사용 세션에서 코드 모드 비용을 보기 위한 벤치입니다.

확장 팩 하나로 로컬에서 바로 켜집니다. Pi가 TypeScript를 직접 로드하므로 빌드 단계는 없습니다.

## 무엇을 재나

한 번의 `codemode` 호출은 두 구간입니다.

| 구간 | 시계 | 의미 |
| --- | --- | --- |
| 쓰기 `writeMs` | `toolcall_start` → `toolcall_end` | 모델이 스크립트 인자를 스트리밍하는 시간 |
| 실행 `executeMs` | Pi가 재는 `execute()` `durationMs` | 샌드박스에서 스크립트가 끝난 시간. 안의 툴 호출을 포함 |

쓰기 시간에는 툴 호출 앞에 있는 생각 시간이 들어가지 않습니다. 실행 시간은 확장 훅 사이 간격이 아니라, Pi가 모노토닉 시계로 잰 `execute()` 시간입니다. 툴이 막혀서 돌지 않으면 `executeMs`는 `null`이고 `outcome`은 `not_run`입니다.

중첩 툴 호출은 바깥 실행 시간에 이미 포함됩니다. 기록에는 호출 수와 그 실행 시간 합만 따로 넣습니다. 스크립트 본문은 저장하지 않습니다. 길이, 줄 수, `@options` 줄 여부, SHA-256 앞 16자리만 남습니다.

## 개발

Node.js 22.19 이상이 필요합니다.

```bash
npm install
npm test
npm run typecheck
npm run replay
```

`npm run replay`는 모델 없이 호출 두 건을 SQLite에 넣고, 스크립트 본문이 안 남는지 확인한 뒤 요약을 출력합니다.

이미 쌓인 기록 요약:

```bash
npm run report
npm run report -- --session <session-id>
npm run report -- --file /path/to/runs.sqlite
```

이 저장소에서 Pi를 띄울 때:

```bash
npm run dev
```

`npm run dev`는 `pi --tools +codemode`입니다. `pi`는 개발 의존성으로 설치됩니다. 프로젝트를 신뢰하면 `.pi/settings.json`의 패키지가 확장으로 로드됩니다.

## Pi에 넣기

프로젝트 설정은 이미 이 패키지와 코드 모드를 가리킵니다.

```json
{
  "packages": [".."],
  "defaultTools": ["+codemode"]
}
```

`packages` 경로는 `.pi/settings.json` 기준입니다. `..`가 이 저장소 루트입니다. 프로젝트를 신뢰하면 Pi가 `extensions/codemode-bench.ts`를 로드하고 `codemode`를 켭니다.

프로젝트 설정을 무시하고 이 파일만 한 번 로드하려면:

```bash
pi -e ./extensions/codemode-bench.ts --tools +codemode --no-approve
```

신뢰된 프로젝트에서 `-e`만 더하면 패키지와 파일이 같이 로드되어 같은 호출이 두 번 기록됩니다.

사용자 설정에 남기려면 `pi install . -l`입니다. 로컬 패키지는 Pi가 의존성을 설치하지 않습니다. 이 확장의 런타임 의존성은 Node 표준 라이브러리뿐이라 추가 설치는 없습니다. 타입 검사는 `@earendil-works/pi-coding-agent`를 devDependency로 둡니다. Pi가 프로세스 안에서 같은 패키지를 제공하므로 dependencies에는 넣지 않습니다.

## 세션 안에서

호출이 끝나면 `runs` 테이블에만 남습니다.

| 명령 | 동작 |
| --- | --- |
| `/codemode-bench` | 이 세션 요약. 편집기 위에 위젯으로 남음 |
| `/codemode-bench all` | DB 전체 |
| `/codemode-bench path` | DB 경로 |
| `/codemode-bench hide` | 요약 위젯 닫기 |

요약은 횟수, 성공/실패/미실행, 쓰기·실행의 p50·p95·평균입니다. 모델이 둘 이상이면 모델별 p50도 보여 줍니다.

## 저장

기록은 SQLite 파일입니다. Node 내장 `node:sqlite`를 쓰므로 네이티브 모듈을 따로 설치하지 않습니다. Node 22에서는 이 모듈이 실험 기능이라, Pi를 띄울 때 `ExperimentalWarning`이 한 번 나올 수 있습니다. 기본 경로는 `~/.pi/agent/codemode-bench/runs.sqlite`입니다. `PI_CODING_AGENT_DIR`이 있으면 그 아래 `codemode-bench/runs.sqlite`입니다. `CODEMODE_BENCH_DB`가 있으면 그 파일을 씁니다.

테이블은 `runs`이고, 한 행이 호출 하나입니다. `schema` 열은 `1`입니다. `outcome`은 `ok`, `error`, `not_run` 중 하나입니다. 스크립트 본문은 없고, `code_sha256`은 앞 16자리입니다. `has_options_line`은 `1`, `0`, 또는 `NULL`입니다.

```sql
SELECT provider, model,
       COUNT(*) AS n,
       AVG(write_ms) AS write_ms,
       AVG(execute_ms) AS execute_ms
FROM runs
GROUP BY provider, model;
```

```bash
sqlite3 ~/.pi/agent/codemode-bench/runs.sqlite
```

같은 기록이 세션 커스텀 엔트리 `codemode-bench`로도 붙습니다. 모델 컨텍스트에는 넣지 않습니다. 쓰기는 WAL 모드이고 `busy_timeout`은 5초입니다. `npm run report`를 Pi가 기록하는 동안 돌려도 됩니다.

## 확장을 더 넣을 때

`extensions/`에 TypeScript 모듈을 두고 `package.json`의 `pi.extensions`에 경로를 추가합니다. 기본 export는 `ExtensionAPI`를 받는 함수입니다. Pi는 jiti로 그 파일을 로드합니다.
