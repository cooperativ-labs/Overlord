# CLI Command Reference

## Attach

```bash
ovld protocol attach --ticket-id $TICKET_ID
```

In a git workspace, `attach` automatically creates a local git checkpoint for each executing objective before work begins, stored under `refs/overlord/checkpoints/<objectiveId>`. Pass `--skip-checkpoint` only when intentionally bypassing local provenance.

## Update

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
```

Supported `--phase` values:

- `draft`
- `execute`
- `review`
- `deliver`
- `complete`
- `blocked`
- `cancelled`

These are hardcoded CLI-supported values for the `--phase` flag. They are not user-defined phase types.

Event types:

- `update` for standard progress updates
- `user_follow_up` — only when the Cursor `beforeSubmitPrompt` hook (see `~/.cursor/hooks.json`) is unavailable; the hook normally posts follow-ups to the activity feed
- `alert` for warnings or non-blocking issues

## Ask

```bash
ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
```

## Deliver

```bash
ovld protocol deliver --session-key <sessionKey> \
  --ticket-id $TICKET_ID \
  --summary "Narrative: what you did, next steps." \
  --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \
  --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
```

Use `--payload-json` when the full delivery object fits comfortably inline. For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery.

Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

## Revert

```bash
ovld protocol revert --objective-id <objective-id>
```

`revert` restores the local working tree to the recorded objective checkpoint and saves a safety ref under `refs/overlord/safety/` first.

## Record Change Rationales

These are structured protocol payloads that Overlord stores as first-class rows in the `file_changes` table. Prefer inline JSON or the dedicated command below. Use `--payload-json` for compact full delivery payloads, or `--payload-file -` when the JSON is larger or quote-sensitive so summary, artifacts, and change rationales stay in one JSON document without creating a temporary file.

**Required fields per entry:** `file_path`, `label`, `summary`, `why`, `impact` (all strings). Do not use `filePath` or `rationale` — those are the internal API shape and will fail CLI validation.

```bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \
  --summary "Recorded rationale details for the latest code changes." --phase execute \
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
```

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID \
  --summary "Added retry logic." --phase execute \
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
```

For many entries (roughly 5+), pipe via stdin to avoid shell quoting failures:

```bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \
  --summary "Recorded rationale details for the latest code changes." --phase execute \
  --change-rationales-file - <<'EOF'
[
  {"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x."},
  {"label":"Update config","file_path":"lib/config.ts","summary":"Added timeout.","why":"Match new defaults.","impact":"Requests time out after 30s."}
]
EOF
```

## Project Discovery And Ticket Creation

When creating tickets from within a repository:

- Prefer `create` by default for draft ticket creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override or `--project-id` to be explicit.
- Create multiple tickets when each prompt represents a different feature or goal.
- Add objectives to the same ticket when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"..."}]'`.
- `create`, `prompt`, and `record-work` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "objective": "...", "title": "...", "autoAdvance": true }` objects. A single objective is just an array with one item.

```bash
ovld protocol create --agent cursor --objectives-json '[{"objective":"Capture follow-up work from this repository"}]'
```

```bash
ovld protocol prompt --agent cursor --objectives-json '[{"objective":"Implement feature X"}]' --priority medium
```

```bash
ovld protocol add-objectives --ticket-id 1:899 --objectives-json '[{"objective":"Implement the API"},{"objective":"Add CLI docs"}]'
```

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
ovld protocol discover-project --project-id <project_uuid>
ovld protocol discover-project --working-directory /path/to/repo
```

Use `--project-id` when the project id is already known. Use `--working-directory` to override cwd path matching. If the runtime has an `OVERLORD_DEVICE_FINGERPRINT`, pass `--device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"` so resource-directory matching prefers the current device.

### Resolving the project ID when you don't have one

When you need a project ID for a protocol command and the ticket prompt did not supply one, resolve it in this order.

**Locally (CLI inside a shell on the user's machine):**

1. `--project-id` if explicitly provided.
2. Otherwise, let the CLI match the current working directory (the default behavior of `create`, `prompt`, `discover-project`).
3. If working-directory resolution returns nothing, read `overlord.json` from the cwd (or any ancestor you have access to) and pass its project id via `--project-id`.

**Over MCP (web agents and hosted tools, where the server cannot see the agent's cwd):**

1. `projectId` (hosted MCP) or `project_id` (local shim) if explicitly provided or found in the ticket/context.
2. Read `overlord.json` from the directory the user is accessing and pass its project id as `projectId` / `project_id`.
3. As a last resort, try `workingDirectory` / `working_directory` resolution. If a device fingerprint is available, include `deviceFingerprint` / `device_fingerprint`.

If `overlord.json` contains more than one project, show the user the project **names** from that file and ask which one to use before calling any protocol command — never silently pick one.

