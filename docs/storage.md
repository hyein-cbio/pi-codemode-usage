# Storage and schema

Each persisted Pi session gets one SQLite database:

```text
~/.pi/agent/codemode-usage/<session-id>.sqlite
```

Directory selection, in priority order:

1. `CODEMODE_USAGE_DB`, or the legacy alias `CODEMODE_USAGE_LOG`: a **directory**, not a database filename.
2. `PI_CODING_AGENT_DIR` plus `codemode-usage/`.
3. `~/.pi/agent/codemode-usage/`.

A leading `~/` is expanded. Session IDs must start and end with a letter or number and contain only letters, numbers, dots, underscores, or hyphens. Invalid or missing IDs use `no-session.sqlite`. The extension skips recording entirely when Pi has no session-file path.

## Table

One `runs` row represents one top-level `codemode` or `codemode_o` call. The current row schema is `1`. Older databases without `tool_name` gain that column when opened; their existing rows have a null tool name. Rows with an unknown schema version are skipped by reports.

| Column | Meaning |
| --- | --- |
| `schema` | Row schema version |
| `recorded_at` | ISO-8601 record timestamp |
| `session_id` | Pi session ID |
| `session_file` | Pi session JSONL path |
| `cwd` | Working directory |
| `provider`, `model`, `thinking_level` | Model metadata |
| `turn_index` | Agent turn index |
| `tool_call_id` | Tool call ID |
| `tool_name` | `codemode` or `codemode_o`; null for older rows |
| `write_ms` | Argument streaming time; null when unavailable |
| `execute_ms` | Pi's `execute()` duration, including worker wait and nested calls; null when no duration was reported |
| `outcome` | `ok`, `error`, or `not_run` |
| `code_chars`, `code_bytes`, `code_lines` | Script size, not source |
| `code_sha256` | First 16 hexadecimal characters of the script's SHA-256 |
| `has_options_line` | Whether the script begins with an `// @options:` line, allowing leading whitespace; null if source was unavailable |
| `output_chars` | Result text length, not result text |
| `nested_call_count`, `nested_execute_ms` | Nested call count and summed duration, kept separate from `execute_ms`; parallel calls can overlap |

Writes use WAL mode and a five-second `busy_timeout`. Reports can run while Pi is recording. Opening an existing database for a report may initialize or migrate its schema; it is not a strictly read-only operation.

The same metadata is also appended to the Pi session as a `codemode-usage` custom entry, outside model context.

## Query example

```bash
sqlite3 ~/.pi/agent/codemode-usage/<session-id>.sqlite
```

```sql
SELECT provider, model, tool_name,
       COUNT(*) AS n,
       AVG(write_ms) AS write_ms,
       AVG(execute_ms) AS execute_ms
FROM runs
GROUP BY provider, model, tool_name;
```

For source-checkout report commands, see [development](development.md). For retention and deletion, see [privacy](privacy.md).
