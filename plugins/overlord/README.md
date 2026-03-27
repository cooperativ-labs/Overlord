# Overlord Plugin

This plugin exposes the installed `ovld protocol` workflow as MCP tools for chat-based use.

## Requirements

- Install the Overlord CLI so `ovld` is available on `PATH`.
- Ensure `OVERLORD_URL` and `AGENT_TOKEN` are available when the target Overlord instance requires them.
- Optionally set `OVLD_BIN` if the CLI lives at a non-standard path.

## Tool coverage

- Project resolution: `discover_project`
- Ticket search: `search_tickets` — keyword search + status/filter (direct API call)
- Ticket session flow: `attach_ticket`, `connect_ticket`, `load_ticket_context`, `spawn_ticket`
- Progress and review flow: `post_update`, `record_change_rationales`, `ask_blocking_question`, `deliver_ticket`
- Shared context: `read_shared_context`, `write_shared_context`
- Artifacts: `artifact_prepare_upload`, `artifact_finalize_upload`, `artifact_download_url`, `artifact_upload_file`

The MCP server shells into the installed `ovld` binary so the plugin stays aligned with the shipped CLI behavior instead of depending on this repository checkout.
