# Privacy, retention, and deletion

## What this extension records

The recorder stores timing and size metadata in local SQLite databases. It also appends the same record to Pi's session JSONL as a `codemode-usage` custom entry, which is not added to model context.

Stored metadata includes:

- Session ID and session-file path.
- Working-directory path, which may reveal a username, project, or customer name.
- Model/provider, thinking level, turn index, tool name, and call ID.
- Timestamps, durations, outcomes, script/output sizes, and nested-call statistics.
- The first 16 hexadecimal characters of a script's SHA-256 hash.

It does **not** store script source, prompts, or output text. A script hash is not encryption or guaranteed anonymization: known scripts can be matched against their hash.

This extension makes **no network requests** and has no telemetry service. Files may still be copied by your own backups, sync tools, session exports, or other software. Pi's normal model/provider traffic and original conversation/tool-call logging are separate from this extension.

## Retention and access

Records remain until you delete them; there is no automatic expiry, rotation, or encryption. Files use the operating system's normal permissions and your process's umask. Restrict directory access and use appropriate disk encryption if paths or model metadata are sensitive.

Sessions without a session-file path, including `--no-session`, are not recorded and do not create a usage directory or database. This does not delete older records.

## Delete records

1. Locate the session database with `/codemode-usage path`, or use the [configured storage directory](storage.md). If you also need to remove the session-file copy, note the stored `session_file` path before deleting the database.
2. Exit Pi processes using the database so they cannot recreate files or keep a WAL file open.
3. Delete that session's `<session-id>.sqlite` and any matching `.sqlite-wal` and `.sqlite-shm` files. To remove all usage databases, remove the usage directory's database files instead.
4. SQLite deletion does **not** remove the custom-entry copy in Pi's session JSONL. If you need to remove that copy too, locate the session JSONL using the stored `session_file` path before deleting the DB. Back up any conversation you need, then separately delete that session file. Deleting it also removes its conversation history.
5. Review backups, synced copies, and exports separately.

To stop future recording, remove the package with:

```bash
pi remove git:github.com/hyein-cbio/pi-codemode-usage@v0.1.0
```

Use the source you installed (for example, omit the tag for an unpinned install), and add `-l` if it was installed in project settings. Restart Pi afterward. Uninstalling the package does not delete existing databases or session files.

## Before sharing

Treat both databases and Pi session exports as potentially identifying. Inspect paths and metadata, and remember that Pi's original session may contain the full conversation and tool calls even though this recorder does not copy their text.

Report security concerns through [the security policy](../SECURITY.md), not public issues containing real session data.
