# Changelog

## Unreleased

- Validate the locked Pi 1.5.0 development dependency with real parallel codemode workers, cross-session worker waiting, queue timeout, nested calls, and per-session SQLite persistence.
- Expand both-tool outcome, storage recovery, UI/headless command, CLI output, and real-worker script-error recovery coverage. Avoid widget calls in headless sessions.
- Keep Node 22.19.0 as the Node 22 CI representative alongside current Node 24/26 patches, and check Node 22 declarations separately from the locked Node 26 declarations.
- Document that worker wait is included in execution duration, and queued failures are errors even when the script body never starts. No recorder or schema change is needed.

## 0.1.0

Initial public release of **pi-codemode-usage**.

- Record separate script-writing and execution times for top-level `codemode` and `codemode_o` calls.
- Store metadata in per-session SQLite databases and Pi session custom entries, without copying script source or result text.
- Summarize usage by model and tool, including outcomes and p50/p95/mean durations.
- Skip recording and database access in ephemeral sessions.
- Add automated tests, a model-free replay, CI, and English/Korean documentation.

The `v0.1.0` tag replaces the pre-release snapshot that still used the name `pi-codemode-bench`. All development commits leading to this release remain in Git history.
