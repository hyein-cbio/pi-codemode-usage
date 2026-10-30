# Pi 1.4.0 timing compatibility

Validated for Dependabot PR #3 on 2026-10-30. The lockfile installs Pi 1.4.0; the manifest's `^1.3.0` development range already allows it. This development dependency does not select or upgrade the Pi host running an installed extension.

## Timing contract

Pi's agent loop starts its monotonic execution timer immediately before calling the tool's `execute()` and reports the rounded duration in `tool_execution_end`. Pi 1.4.0 reserves a codemode worker **inside** that call, before starting the sandbox. The worker pool is shared across sessions in the same process.

Consequently:

- `writeMs` still measures only `toolcall_start` → `toolcall_end`, before execution and admission.
- `executeMs` remains Pi's outer `durationMs`: worker waiting, sandbox startup/execution/cleanup, and awaited nested tools are included. It measures tool latency rather than JavaScript-only runtime.
- A timeout or abort in the admission queue has a duration and an `error` outcome even when the script body never starts. `not_run` means no finite execution duration was reported.
- Nested events carry `parentToolCallId`. The recorder ignores them as independent rows and takes the outer duration once. `nestedExecuteMs` separately sums `result.details.calls[].durationMs`; overlapping nested calls can make this sum exceed wall time. It is never added to `executeMs`.
- Parallel outer calls also overlap. Adding their durations does not measure session elapsed time.

The event/timing contract is compatible with the existing recorder; no recorder or database schema changes are required. Worker contention can increase the execution-time distribution in 1.4.0, so comparisons with 1.3.0 must account for the new queueing behavior.

Source locations at the reviewed release:

- [Agent loop execution timer and end event](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/src/agent-loop.ts)
- [Codemode worker admission and nested-call details](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/extensions/codemode/execute.ts)
- [Nested tool event dispatch](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/nested-tool-calls.ts)

## Runtime regression

`test/runtime.test.ts` uses the installed Pi SDK and real QuickJS workers. Assistant output, a test barrier tool, and the recorder's write clock are controlled; no model service or network request is needed.

1. Session A emits two parallel codemode calls. Each runs two parallel nested barrier calls, holding both worker slots.
2. Session B emits another codemode call and an 80 ms deadline call. The former cannot reach its nested tools until A releases capacity; the latter fails while queued and never starts its script body.
3. The test checks stream/start/nested/end event order, unchanged write timing, queue-inclusive outer duration, and separately summed nested durations. It compares persisted `executeMs` directly with the real outer event, catching accidental nested-time addition.
4. Each session retains exactly two SQLite rows and two session custom entries. Nested events create no extra rows. Summary execution means use only the outer durations.

One local run observed 161 ms of forced worker wait, 350 ms outer duration for the queued call, 202.797 ms summed nested duration, and 82 ms for the queue timeout. These are observations, not performance targets; assertions use barrier ordering and timing bounds.

The original CI run [41007552040](https://github.com/hyein-cbio/pi-codemode-usage/actions/runs/41007552040) passed on Node 22.19.0, 22, 24, and 26 before this regression was added. That run covered types, synthetic tests, replay, and packaging; it did not exercise real worker waiting. The new regression runs under the existing CI test matrix.
