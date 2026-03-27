# Overlord Plugin

This plugin exposes the installed `ovld protocol` workflow to Codex as a local plugin bundle.

It now includes:

- MCP tools for the Overlord ticket protocol
- a bundled Codex skill for the local ticket lifecycle
- branded plugin assets for the Codex install surfaces

The plugin is designed for personal installs under `~/.codex/plugins/overlord` with a
personal marketplace entry at `~/.agents/plugins/marketplace.json`.

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

## Skill coverage

- `skills/overlord-ticket-workflow/SKILL.md` teaches Codex the durable local workflow:
  attach first, update during work, ask when blocked, and deliver last.

## App surface status

The Codex plugin docs support an optional `.app.json` file, but the current file format
expects a real OpenAI-issued `asdk_app_*` or `connector_*` identifier. This repo does not
yet have an issued Overlord app ID to point at, so the plugin intentionally does not ship
an `.app.json` mapping yet.
