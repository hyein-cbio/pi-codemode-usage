# Pi 1.5.0 and Node type compatibility

Reviewed on 2026-11-06 for [PR #4](https://github.com/hyein-cbio/pi-codemode-usage/pull/4) and [PR #5](https://github.com/hyein-cbio/pi-codemode-usage/pull/5).

## Pi 1.5.0

PR #4 updates the development lockfile to Pi 1.5.0. The manifest's `^1.3.0` range already permits that release. It does not update the host that runs an installed extension.

Source comparison between tags `v1.4.0` and `v1.5.0` found these files byte-for-byte unchanged:

- [Agent loop](https://github.com/earendil-works/pi/blob/v1.5.0/packages/agent/src/agent-loop.ts): forwards assistant stream events and times `execute()` with a monotonic clock.
- [Codemode execution](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/extensions/codemode/execute.ts): reserves workers inside `execute()` and records nested-call durations separately.
- [Nested tool dispatch](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/nested-tool-calls.ts): preserves `parentToolCallId` on nested start, update, and end events.

The session's forwarding code still passes through `message_update.assistantMessageEvent` and outer `tool_execution_end.durationMs`. Pi's move to `pi-schema` changes tool argument validation; this recorder registers event handlers and a command, with no tool schema of its own.

The timing meanings remain those in [the 1.4 review](pi-1.4-compatibility.md):

- `writeMs` measures streamed script writing from `toolcall_start` to `toolcall_end`.
- `executeMs` is the outer event's `durationMs`, including worker admission wait and awaited nested work.
- A deadline that expires while waiting has an `error` outcome and a finite execution duration.
- `nestedExecuteMs` separately sums nested durations. Overlapping calls can make the sum exceed wall time; it is never added to `executeMs`.
- Nested events do not create independent usage rows.

### Evidence and regression coverage

The existing [CI run 42167190060](https://github.com/hyein-cbio/pi-codemode-usage/actions/runs/42167190060) passed types, 27 tests, replay, and package checks on Node 22.19.0, 22, 24, and 26. This already includes the real SDK/QuickJS worker test in `test/runtime.test.ts`, despite its old title mentioning Pi 1.4.

In its Node 22.19.0 job, the test observed 161 ms of worker wait, 347 ms outer execution, 201.619 ms summed nested execution, and 81 ms for the queued timeout. Each session retained two SQLite rows. These are observations, not performance targets.

The regression now also requires exactly two nested start/end parent associations and two nested result details for each successful outer call, and none for the queued timeout. It checks finite nested end durations. This closes a gap where missing parent ids could escape the earlier event-order loop. The test title now refers to the installed Pi version without hard-coding 1.4.

The test controls assistant output and the recorder's write clock. It exercises real SDK dispatch, worker admission, nested execution, persistence, and summaries without a model service. It does not benchmark provider parsing speed or establish compatibility with every Pi version allowed by the peer range.

## Node.js type definitions

The initial review recommended keeping `engines.node >=22.19.0` and `@types/node ^22.20.5`, holding PR #5's move to `^26.6.6` until a separate Node 22 declaration check was added. The follow-up below adds that check while retaining the Node 26 declaration update.

[PR #5's CI run 42167202812](https://github.com/hyein-cbio/pi-codemode-usage/actions/runs/42167202812) passed on all four Node versions. No current runtime failure was found. The change affects declarations and their `undici-types` dependency, not the running Node binary. Current database code uses `DatabaseSync`, `exec`, `prepare`, `run`, `all`, and `close`, which the minimum-runtime CI exercises.

The initial problem was the development contract: all CI jobs used the same lockfile declarations. Running TypeScript on Node 22 does not make Node 26 declarations describe Node 22. A later use of a newer API could typecheck while failing on the minimum runtime if tests miss that path.

For example, the [Node 26 declaration branch](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/sqlite.d.ts) exposes `DatabaseSync.createTagStore()` (introduced in Node 24.9.0) and `setAuthorizer()` (24.10.0). Neither is present in the [Node 22.19.0 SQLite API](https://github.com/nodejs/node/blob/v22.19.0/doc/api/sqlite.md), and neither is used here. These examples describe the declaration/runtime mismatch, not an observed failure in this extension.

### Follow-up: separate declaration and runtime checks

The lockfile now retains `@types/node ^26.6.6`. Required runtime jobs use Node 22.19.0 and the newest Node 24/26 patches; the duplicate latest-22 job is removed. Node 22.19.0 is a deliberate floor check, not a guarantee about every later patch. Node 27 is currently an alpha and is not a required target.

Each job first checks the locked Node 26 declarations. The minimum-runtime job additionally installs exactly `@types/node@22.20.5` with `--no-save --ignore-scripts` (honoring the existing lockfile for unrelated dependencies), verifies the installed type version and unchanged locked Pi version, and repeats the typecheck and complete test suite. A final tracked-file diff check ensures that neither declaration pass rewrites the manifest or lockfile. Even Node 22 declarations may contain APIs added after 22.19.0, so exact-minimum runtime checks remain required.

The expanded tests pin both-tool success/error/not-run persistence, nested and duplicate suppression, storage failure recovery, session/all-session UI and headless commands, and CLI summary output. CLI subprocesses use the parent runtime's `process.execPath`. The real SDK test now also records a JavaScript exception and a subsequent successful sequential call. Headless session startup exposed an unnecessary widget call, fixed by guarding widget access with `ctx.hasUI`.

No measurement meaning or database schema changes are needed.
