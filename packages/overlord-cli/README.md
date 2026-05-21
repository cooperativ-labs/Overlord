# Overlord CLI

`overlord-cli` is the packaged command-line interface for Overlord. It lets you launch agents on tickets, create new tickets, and manage the ticket lifecycle from the terminal.

Website: [ovld.ai](https://ovld.ai)

## Install

Note: Use Node.js 20 or newer for every CLI install or update.

Install it globally so the `ovld` and `overlord` commands are available on your `PATH`:

```bash
npm install -g overlord-cli

#After installing, run
ovld setup all #to configure every supported connector (`ovld setup` alone is interactive)

#for individual connectors, run `ovld setup <connector>`.
ovld setup cursor
ovld setup claude
ovld setup codex
ovld setup all
```

```bash
# To update the CLI to the latest release, run:
ovld update
```

## Usage

```bash
ovld help
overlord help
```

### Auth

```bash
# Repair shared credentials first when a session already exists
ovld auth repair # mirror and chmod shared Desktop/CLI credentials when possible

# Login to Overlord if repair does not restore access
ovld auth login #opens a browser when possible and also prints a verification URL/code so login can be completed from another machine over SSH.
ovld auth status # show current login status (use --verbose for redacted diagnostics)
ovld auth logout # remove stored credentials
```

Desktop-installed wrappers default `OVERLORD_URL` to `https://www.ovld.ai` unless you override it explicitly.
For local dev against the web app on port 3000, export the override before running auth or protocol commands:

```bash
export OVERLORD_URL=http://localhost:3000
```

Common commands:

```bash
ovld auth login
ovld auth status
ovld attach
ovld create "Investigate the failing build" --agent codex
ovld prompt "Draft a fix for the onboarding flow"
ovld version
ovld update
ovld protocol discover-project
ovld protocol attach --ticket-id <ticket_id>
ovld protocol search-tickets --query "auth refactor" --status next-up,execute
ovld protocol update --session-key <session-key> --ticket-id <ticket_id> --summary "Working on it" --phase execute
ovld runner start
ovld setup
ovld setup codex
ovld setup claude
ovld setup cursor
ovld setup antigravity
ovld setup all
ovld launch antigravity --ticket-id <ticket_id>
ovld doctor
```

**Antigravity:** Gemini CLI is deprecated. Use `ovld setup antigravity` and `ovld launch antigravity --ticket-id <ticket_id>`. Antigravity manages model selection internally.

For ticket-scoped protocol and launch commands, `ticket_id` values such as `1:899` carry the organization id. The CLI uses that first, then `--organization-id` for UUID compatibility, then stored auth.

## Requirements

- Node.js 20 or newer
- Access to an Overlord instance when using authenticated commands

## Commands for Humans

Find full CLI docs here: https://www.ovld.ai/docs/surfaces/cli

Top-level commands (see `ovld help`):

- `attach` - search tickets and launch an agent interactively (`ovld attach [ticketId] [agent]`)
- `create` - create a ticket with numbered project selection; supports `--agent`, `--model`, `--delegate` (same delegate flags as `ovld protocol create`)
- `prompt` - create a ticket, then launch an agent on it
- `auth` - `login`, `status`, `repair` (shared Desktop/CLI credentials), or `logout`
- `tickets` - `create` or `list` (optional `--status`)
- `ticket` - `context <ticketId>` to print context for one ticket
- `launch`, `restart` - launch or resume an agent session
- `runner` - claim queued execution requests and launch assigned agents with `ovld launch`
- `connect`, `run`, `resume` - legacy aliases for `launch` and `restart`
- `setup` - install the Overlord connector for an agent; `ovld setup [agent|all]` (interactive with no args). `ovld setup claude` also performs the one-time v3.25.0 to v4 Claude plugin migration
- `update` - install the latest CLI release from npm
- `doctor` - validate installed connectors and check for CLI updates
- `version` - print the installed CLI version

## Commands for agents

Agents can find docs here: https://www.ovld.ai/docs/for-agents

`ovld protocol <subcommand>` is the surface agents and hooks use for ticket lifecycle work. Run `ovld protocol help` for flags, env fallbacks, and examples.

- `auth-status` - return machine-readable auth status for agent runtimes
- `discover-project` - resolve a project from the current (or given) working directory
- `attach` - start a ticket session, create a local git checkpoint per executing objective, and return full working context
- `connect` - start a lightweight session without full context
- `load-context` - read ticket context without creating a session
- `revert` - restore the local working tree to an objective checkpoint after fetching its checkpoint row
- `search-tickets` - find tickets by keyword, status, project, creator, or update date
- `add-objectives` - append ordered objectives to an existing ticket (`--objectives-json` / `--objectives-file`)
- `create` - create a draft ticket without attaching (standalone or follow-up)
- `prompt` - create a ticket and attach to it immediately (`spawn` is a backward-compatible alias)
- `record-work` - record already-completed chat work as a ticket in review with a completed objective and trigger feed-post generation
- `update` - post progress, activity events, and optional change rationales
- `record-change-rationales` - persist structured change rationales without a normal progress update
- `ask` - post a blocking question and move the ticket to review
- `permission-request` - notify Overlord that the agent is requesting tool permission
- `hook-event` - record lifecycle hook events such as `UserPromptSubmit` / Cursor `beforeSubmitPrompt` without a session key
- `read-context` - read shared persistent context for this ticket
- `write-context` - write shared persistent context for future sessions
- `deliver` - send artifacts/rationales and move the ticket to review
- `attachment-prepare-upload` - get a signed upload URL for an objective attachment
- `attachment-finalize-upload` - finalize an uploaded objective attachment row after storage upload
- `attachment-download-url` - get a signed download URL for an existing objective attachment
- `attachment-upload-file` - prepare, upload, and finalize a local objective attachment in one command
- `get-device` / `update-device` - register the caller machine (per organization + user + fingerprint) and rename its label
- `list-project-resources` / `add-project-resource` / `update-project-resource` - manage filesystem directories tied to a project device
- `request-execution` / `claim-execution` / `complete-execution-launch` / `fail-execution-launch` - durable runner queue operations used by auto-advance and manual Run

Devices are keyed by **(organization, user, fingerprint)** so the same physical workstation can appear once per org session.

`ovld runner start` keeps a foreground runner alive for CLI-only or remote hosts. It claims compatible execution requests for the current device and launches the assigned agent/model with `ovld launch`; `ovld runner once` claims at most one request and exits.

Use `create` for future work you want to track, `prompt` for work that should start immediately, and `record-work` for work that was already completed in chat and now needs a review ticket plus feed post. Use multiple tickets when prompts represent different features or goals; use `add-objectives` or `--objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'` when prompts are sequential steps toward the same feature or goal.

`ovld protocol deliver` accepts either discrete flags like `--summary` / `--artifacts-json`, an inline full payload with `--payload-json '{"summary":"...","artifacts":[...],"changeRationales":[...]}'`, or a file/stdin payload with `--payload-file <path|->`.

## License

Permission is granted to use this software for any purpose, free of charge. You may not modify, distribute, sublicense, or sell copies of the software without explicit permission from the author.
