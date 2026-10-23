# pi-codemode-usage

[![CI](https://github.com/hyein-cbio/pi-codemode-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/hyein-cbio/pi-codemode-usage/actions/workflows/ci.yml)

[한국어](README.ko.md)

Record how long Pi spends **writing** a `codemode` or `codemode_o` script and **executing** it. Records stay local, in one SQLite file per persisted session. No build step or native dependency installation is required.

## Requirements

- Node.js **22.19.0 or newer**.
- [Pi](https://pi.dev) **1.3.0 or newer**. Development type checks use Pi 1.3.0; older Pi versions are not supported.
- Enable `codemode` separately. This package only records calls; it does not provide or enable either tool.

Node 22 may print an `ExperimentalWarning` for its built-in `node:sqlite` module.

## Install and quick start

Install the **0.1.0** release from GitHub:

```bash
pi install git:github.com/hyein-cbio/pi-codemode-usage@v0.1.0
```

For the latest development commit instead, omit `@v0.1.0`. Run `/reload` in an existing Pi session.

Add `+codemode` to `defaultTools` in `~/.pi/agent/settings.json`, preserving any other settings:

```json
{
  "defaultTools": ["+codemode"]
}
```

Or enable it for one invocation with `pi --tools +codemode`. After a call completes in a persisted session, use:

| Command | Action |
| --- | --- |
| `/codemode-usage` | Show this session's summary above the editor |
| `/codemode-usage all` | Summarize every session database in the usage directory |
| `/codemode-usage path` | Show this session's database path |
| `/codemode-usage hide` | Hide the summary widget |

The summary includes counts, outcomes, and p50/p95/mean write and execution times, with separate model/tool groups. The command UI currently uses Korean.

## What is measured?

| Field | Measurement |
| --- | --- |
| `writeMs` | Monotonic time from `toolcall_start` to `toolcall_end`: streaming the script arguments, not preceding thinking time |
| `executeMs` | Pi's `execute()` `durationMs`, including nested tool calls |
| `outcome` | `ok`, `error`, or `not_run`; execution time is null if execution did not run |

Nested calls are already included in the outer execution time; their count and summed duration are recorded separately.

## Storage and privacy

Default location:

```text
~/.pi/agent/codemode-usage/<session-id>.sqlite
```

The recorder does **not** store script source, prompts, or output text, and makes **no network requests**. It does store metadata, including working-directory and session-file paths, model/provider, timings, sizes, and a truncated script hash. A copy is also appended to the Pi session as a custom entry; that entry is not added to model context.

Pi's own session logs are separate and may contain the original conversation and tool calls. Sessions without a session-file path, such as `--no-session`, are not recorded.

See [storage and schema](docs/storage.md) and [privacy, retention, and deletion](docs/privacy.md) before sharing databases or session exports.

## Development

Run these commands **from a source checkout**, not from an installed package:

```bash
git clone https://github.com/hyein-cbio/pi-codemode-usage.git
cd pi-codemode-usage
npm ci
npm run check
npm run replay
```

CI runs type checks, all tests, a model-free SQLite replay, and a packaging dry run on Node 22.19.0, 22, 24, and 26.

See [development and CLI reports](docs/development.md), [changelog](CHANGELOG.md), and [security reporting](SECURITY.md).

## License

[MIT](LICENSE).
