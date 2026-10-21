# pi-codemode-usage

Pi 코딩 에이전트의 `codemode`와 `codemode_o` 툴이 돌 때마다, 모델이 스크립트를 쓰는 시간과 그 스크립트가 실행되는 시간을 갈라 기록하는 확장입니다. 실사용 세션의 코드 모드 비용을 남기는 기록기입니다. 어느 툴이 호출됐는지도 같은 행에 남깁니다.

확장 팩 하나로 로컬에서 바로 켜집니다. Pi가 TypeScript를 직접 로드하므로 빌드 단계는 없습니다.

## 설치

GitHub에서 설치합니다.

```bash
pi install git:github.com/hyein-cbio/pi-codemode-usage
```

태그 `v0.1.0`은 이름을 `pi-codemode-usage`로 바꾸기 전 커밋입니다. 그 태그를 설치하면 패키지 이름과 기록 경로가 아직 `bench`입니다. 이미 켜진 세션이면 `/reload` 합니다.

`codemode`는 이 패키지가 켜 주지 않습니다. 사용자 설정 `~/.pi/agent/settings.json`에 다음이 있어야 기록이 쌓입니다.

```json
{
  "defaultTools": ["+codemode"]
}
```

## 무엇을 재나

한 번의 `codemode` 또는 `codemode_o` 호출은 두 구간입니다.

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
npm run report -- --file /path/to/<session-id>.sqlite
```

이 저장소에서 Pi를 띄울 때:

```bash
npm run dev
```

`npm run dev`는 `pi --tools +codemode`입니다. `pi`는 개발 의존성으로 설치됩니다. 프로젝트를 신뢰하면 `.pi/settings.json`의 패키지가 확장으로 로드됩니다.

## 이 저장소에서 개발

프로젝트 설정은 이미 이 패키지와 코드 모드를 가리킵니다.

```json
{
  "packages": [".."],
  "defaultTools": ["+codemode"]
}
```

`packages` 경로는 `.pi/settings.json` 기준입니다. `..`가 이 저장소 루트입니다. 프로젝트를 신뢰하면 Pi가 `extensions/codemode-usage.ts`를 로드하고 `codemode`를 켭니다.

프로젝트 설정을 무시하고 이 파일만 한 번 로드하려면:

```bash
pi -e ./extensions/codemode-usage.ts --tools +codemode --no-approve
```

신뢰된 프로젝트에서 `-e`만 더하면 패키지와 파일이 같이 로드되어 같은 호출이 두 번 기록됩니다.

사용자 설정에 남기려면 `pi install . -l`입니다. 로컬 패키지는 Pi가 의존성을 설치하지 않습니다. 이 확장의 런타임 의존성은 Node 표준 라이브러리뿐이라 추가 설치는 없습니다. 타입 검사는 `@earendil-works/pi-coding-agent`를 devDependency로 둡니다. Pi가 프로세스 안에서 같은 패키지를 제공하므로 dependencies에는 넣지 않습니다.

## 세션 안에서

호출이 끝나면 `runs` 테이블에만 남습니다.

| 명령 | 동작 |
| --- | --- |
| `/codemode-usage` | 이 세션 파일 요약. 편집기 위에 위젯으로 남음 |
| `/codemode-usage all` | 디렉터리의 세션 파일 전부 |
| `/codemode-usage path` | 이 세션 파일 경로 |
| `/codemode-usage hide` | 요약 위젯 닫기 |

요약은 횟수, 성공/실패/미실행, 쓰기·실행의 p50·p95·평균입니다. 모델이 둘 이상이면 모델별 p50도 보여 줍니다.

## 저장

기록은 세션마다 SQLite 파일 하나입니다. Node 내장 `node:sqlite`를 쓰므로 네이티브 모듈을 따로 설치하지 않습니다. Node 22에서는 이 모듈이 실험 기능이라, Pi를 띄울 때 `ExperimentalWarning`이 한 번 나올 수 있습니다.

```text
~/.pi/agent/codemode-usage/<session-id>.sqlite
```

`PI_CODING_AGENT_DIR`이 있으면 그 아래 `codemode-usage/`입니다. `CODEMODE_USAGE_DB`가 있으면 그 디렉터리를 씁니다. 세션 id는 Pi와 같이 영숫자와 `.` `_` `-`만 파일명에 들어가고, 그 밖의 id는 `no-session.sqlite`입니다.

테이블은 `runs`이고, 한 행이 `codemode` 또는 `codemode_o` 호출 하나입니다. `schema` 열은 `1`입니다. 이 열이 생기기 전에 만든 파일은 열 때 `tool_name`을 덧붙입니다. 그 이전 행의 `tool_name`은 `NULL`입니다.

| 열 | 의미 |
| --- | --- |
| `recorded_at` | 기록 시각 (ISO-8601) |
| `session_id` | Pi 세션 id. 파일명과 같습니다 |
| `session_file` | Pi 세션 JSONL 경로 |
| `cwd` | 작업 디렉터리 |
| `provider`, `model`, `thinking_level` | 그 호출의 모델 |
| `turn_index` | 에이전트 턴 번호 |
| `tool_call_id` | 툴 호출 id |
| `tool_name` | 툴 호출 이름. `codemode` 또는 `codemode_o` |
| `write_ms` | 스크립트를 스트리밍한 시간. 못 재면 `NULL` |
| `execute_ms` | `execute()` 시간. 실행되지 않으면 `NULL` |
| `outcome` | `ok`, `error`, `not_run` |
| `code_chars`, `code_bytes`, `code_lines` | 스크립트 크기. 본문은 없음 |
| `code_sha256` | 스크립트 SHA-256 앞 16자리 |
| `has_options_line` | 첫 줄이 `// @options:`이면 `1`, 아니면 `0`, 코드를 못 읽으면 `NULL` |
| `output_chars` | 결과 텍스트 길이 |
| `nested_call_count`, `nested_execute_ms` | 스크립트 안의 툴 호출 수와 실행 시간 합 |

```sql
SELECT provider, model,
       COUNT(*) AS n,
       AVG(write_ms) AS write_ms,
       AVG(execute_ms) AS execute_ms
FROM runs
GROUP BY provider, model;
```

```bash
sqlite3 ~/.pi/agent/codemode-usage/<session-id>.sqlite
```

같은 기록이 세션 커스텀 엔트리 `codemode-usage`로도 붙습니다. 모델 컨텍스트에는 넣지 않습니다. 쓰기는 WAL 모드이고 `busy_timeout`은 5초입니다. `npm run report`를 Pi가 기록하는 동안 돌려도 됩니다.

## 확장을 더 넣을 때

`extensions/`에 TypeScript 모듈을 두고 `package.json`의 `pi.extensions`에 경로를 추가합니다. 기본 export는 `ExtensionAPI`를 받는 함수입니다. Pi는 jiti로 그 파일을 로드합니다.
