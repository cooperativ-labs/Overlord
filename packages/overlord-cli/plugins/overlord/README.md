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
- If a shared session already exists but looks stale, authenticate with `ovld auth repair` first. If repair does not help, use `ovld auth login` or Overlord Desktop. `OVERLORD_URL` can be used to point the CLI at a non-default host.
- Optionally set `OVLD_BIN` if the CLI lives at a non-standard path.
- If `ovld` reports `OVERLORD_URL` is unreachable, the bundled workflow tells Codex to request permission escalation or network access before retrying.

## Tool coverage

- Project resolution: `discover_project`
- Ticket search: `search_tickets` — keyword search + status/filter (direct API call)
- Ticket session flow: `attach`, `connect`, `load_ticket_context`, `prompt`
- Progress and review flow: `update`, `record_change_rationales`, `ask`, `deliver`
- Shared context: `read_context`, `write_context`
- Objective attachments: `list_attachments`, `prepare_attachment_upload`, `finalize_attachment_upload`, `get_attachment_download_url`, `upload_attachment_file`

The MCP server shells into the installed `ovld` binary so the plugin stays aligned with the shipped CLI behavior instead of depending on this repository checkout.

## Skill coverage

- `skills/overlord-ticket/SKILL.md` teaches Codex the durable local workflow:
  attach first, update during work, ask when blocked, and deliver last.

## App surface status

The Codex plugin docs support an optional `.app.json` file, but the current file format
expects a real OpenAI-issued `asdk_app_*` or `connector_*` identifier. This repo does not
yet have an issued Overlord app ID to point at, so the plugin intentionally does not ship
an `.app.json` mapping yet.
