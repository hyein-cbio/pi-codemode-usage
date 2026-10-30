# pi-codemode-usage

[English](README.md)

Pi의 `codemode`와 `codemode_o` 호출마다 **스크립트를 쓰는 시간**과 **실행하는 시간**을 나눠 기록하는 확장입니다. 기록은 세션별 SQLite 파일에 로컬로 저장합니다. 빌드나 네이티브 모듈 설치는 필요하지 않습니다.

## 요구 사항

- Node.js **22.19.0 이상**
- Pi **1.3.0 이상**. 개발 타입 검사와 런타임 회귀 테스트는 잠금 파일의 Pi 1.4.0 기준이며, Pi 1.3.0 이전 버전은 지원하지 않습니다.
- `codemode`는 별도로 켜야 합니다. 이 패키지는 툴을 제공하거나 활성화하지 않고, 호출만 기록합니다.

Node 22에서는 내장 `node:sqlite` 때문에 `ExperimentalWarning`이 나올 수 있습니다.

## 설치와 빠른 시작

**0.1.0** 릴리스 설치:

```bash
pi install git:github.com/hyein-cbio/pi-codemode-usage@v0.1.0
```

최신 개발 커밋을 설치하려면 `@v0.1.0`을 뺍니다. 이미 켜진 Pi 세션에서는 `/reload` 합니다.

`~/.pi/agent/settings.json`의 기존 설정을 유지하면서 `defaultTools`에 `+codemode`를 추가합니다.

```json
{
  "defaultTools": ["+codemode"]
}
```

한 번만 켜려면 `pi --tools +codemode`로 실행합니다. 저장되는 세션에서 툴 호출이 끝난 뒤 아래 명령을 쓰면 됩니다.

| 명령 | 동작 |
| --- | --- |
| `/codemode-usage` | 이 세션 요약을 편집기 위 위젯으로 표시 |
| `/codemode-usage all` | 기록 디렉터리의 세션 DB 전체 요약 |
| `/codemode-usage path` | 이 세션 DB 경로 표시 |
| `/codemode-usage hide` | 요약 위젯 닫기 |

요약에는 횟수, 성공·실패·미실행, 쓰기·실행 시간의 p50·p95·평균이 나옵니다. 모델·툴 조합별 통계는 구분해서 보여 줍니다.

## 측정 기준

- **쓰기 `writeMs`**: `toolcall_start`부터 `toolcall_end`까지 스크립트 인자를 스트리밍한 시간입니다. 그 앞의 생각 시간은 제외합니다.
- **실행 `executeMs`**: Pi가 모노토닉 시계로 측정한 `execute()`의 `durationMs`입니다. Pi 1.4.0의 worker 대기 시간과 안에서 호출한 툴의 실행 시간을 포함합니다.
- Pi가 실행 시간을 보고하지 않으면 `executeMs`는 `null`, `outcome`은 `not_run`입니다.
- 중첩 호출의 수와 실행 시간 합도 따로 남기지만, 바깥 실행 시간에 다시 더하지는 않습니다. 병렬 중첩 호출은 시간이 겹치므로 이 합은 경과 시간과 다릅니다. 병렬 최상위 호출의 실행 시간도 서로 겹칠 수 있습니다.

Pi 1.4.0은 `execute()` 안에서 사용 가능한 worker를 기다립니다. 따라서 대기 시간은 `executeMs`에 포함되고 `writeMs`에는 포함되지 않습니다. `executeMs`는 JavaScript 본문만의 실행 시간이 아니라 툴 호출 전체의 지연 시간입니다. 대기 중 시간 초과나 취소가 발생하면 본문이 시작되지 않아도 실행 시간이 있는 `error`로 기록합니다. [런타임 호환성 검증](docs/pi-1.4-compatibility.md)을 참고하세요.

## 저장과 개인정보

기본 경로는 `~/.pi/agent/codemode-usage/<session-id>.sqlite`입니다.

이 기록기는 **스크립트 본문·프롬프트·결과 텍스트를 저장하지 않고 외부로 전송하지 않습니다**. 다만 작업 디렉터리, 세션 파일 경로, 모델 정보, 시간, 크기, 스크립트 해시 앞 16자리는 저장합니다. 같은 기록이 Pi 세션의 커스텀 엔트리에도 붙으며, 이 엔트리는 모델 컨텍스트에 들어가지 않습니다.

Pi 자체 세션 로그에는 원래 대화와 툴 호출이 남을 수 있습니다. 이 기록기의 저장 범위와는 별개입니다. `--no-session`처럼 세션 파일 경로가 없는 경우에는 DB를 만들거나 기록하지 않으며, 요약 명령도 동작하지 않습니다.

보관 기간 제한과 자동 삭제는 없습니다. 삭제하려면 먼저 Pi를 종료하고 해당 DB와 `-wal`·`-shm` 파일을 지웁니다. **DB를 지워도 Pi 세션 안의 사본은 남습니다.** 사본까지 없애려면 필요한 대화를 백업한 뒤 해당 Pi 세션 파일도 별도로 삭제해야 합니다. 세션 파일 삭제는 대화 이력도 지우므로 주의하세요.

자세한 [저장 경로·스키마](docs/storage.md), [개인정보·보관·삭제 안내](docs/privacy.md)를 참고하세요. DB나 세션 내보내기 파일을 공유하기 전에는 경로 등 식별 가능한 정보를 확인하세요.

## 개발

아래 명령은 **설치된 패키지가 아니라 소스 저장소 루트**에서 실행합니다.

```bash
git clone https://github.com/hyein-cbio/pi-codemode-usage.git
cd pi-codemode-usage
npm ci
npm run check
npm run replay
```

CI는 Node 22.19.0·22·24·26에서 타입 검사, 전체 테스트, 모델 없는 SQLite 리플레이, 패키징 dry run을 실행합니다.

[개발과 CLI 리포트](docs/development.md) · [변경 이력](CHANGELOG.md) · [보안 제보](SECURITY.md) · [MIT 라이선스](LICENSE)
