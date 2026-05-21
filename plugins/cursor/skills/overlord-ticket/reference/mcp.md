# MCP And API Defaults

- API requires `agentIdentifier` and `connectionMethod` on attach/connect/prompt. The CLI defaults them to `cursor`/`cli`; the MCP tool defaults to `mcp`. Override with `--agent` / `--method` when calling from a different runtime.
- Hosted Overlord MCP (`/functions/v1/mcp`) uses the same canonical tool names as the local shim that shells into `ovld protocol` (`attach`, `update`, `deliver`, `get_device`, `list_project_resources`, …). Hosted calls use camelCase JSON keys (`ticketId`, `sessionKey`, `deviceFingerprint`) matching `POST /api/protocol/*` bodies; the local shim uses snake_case keys mapped to CLI flags (`ticket_id`, `session_key`, `device_fingerprint`).
- `permission-request` is invoked by the Cursor permission hook installed by the bundle. Agents do not normally call it directly.
- `record_change_rationales` (MCP) and `ovld protocol record-change-rationales` (CLI) both write to the same `file_changes` table. The dedicated CLI route is `POST /api/protocol/record-change-rationales`.
- Objective attachment tools follow the `<verb>_<noun>` MCP naming: `list_attachments`, `prepare_attachment_upload`, `finalize_attachment_upload`, `get_attachment_download_url`, `upload_attachment_file`. CLI commands use `attachment-*` and require `--objective-id` for upload/finalize.
- "Artifacts" in `deliver` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files. Files attached by users live on objectives via the attachment tools above.

