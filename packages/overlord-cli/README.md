# Overlord CLI

`overlord-cli` is the packaged command-line interface for Overlord. It lets you launch agents on tickets, create new tickets, and manage the ticket lifecycle from the terminal.

Website: [ovld.ai](https://ovld.ai)

## Install

Note: Use Node.js 20 or newer for every CLI install or update.

Install it globally so the `ovld` and `overlord` commands are available on your `PATH`:

```bash
npm install -g overlord-cli
```


After installing, run `ovld setup [agent|all]` for the agent you use (`ovld setup` alone is interactive), for example `ovld setup cursor`, `ovld setup claude`, `ovld setup codex`, or `ovld setup all` for every supported connector.

Run `ovld update` any time you want to refresh the global npm install to the latest release.

## Usage

```bash
ovld help
overlord help
```

The CLI exposes the same command set under both names.
`ovld auth login` opens a browser when possible and also prints a verification URL/code so login can be completed from another machine over SSH.
Use `ovld auth status`, `ovld auth repair` (shared Desktop/CLI credentials), and `ovld auth logout` for the other auth flows.

Desktop-installed wrappers default `OVERLORD_URL` to `https://www.ovld.ai` unless you override it explicitly.
For local dev against the web app on port 3000, export the override before running auth or protocol commands:

```bash
export OVERLORD_URL=http://localhost:3000
ovld auth login
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
ovld protocol attach --ticket-id <ticket-id>
ovld protocol search-tickets --query "auth refactor" --status next-up,execute
ovld protocol update --session-key <session-key> --ticket-id <ticket-id> --summary "Working on it" --phase execute
ovld setup
ovld setup codex
ovld setup claude
ovld setup cursor
ovld setup gemini
ovld setup all
ovld doctor
```

## Requirements

- Node.js 20 or newer
- Access to an Overlord instance when using authenticated commands

## Commands

Top-level commands (see `ovld help`):

- `attach` - search tickets and launch an agent interactively (`ovld attach [ticketId] [agent]`)
- `create` - create a ticket with numbered project selection; supports `--agent`, `--model`, `--delegate` (same delegate flags as `ovld protocol create`)
- `prompt` - create a ticket, then launch an agent on it
- `auth` - `login`, `status`, `repair` (shared Desktop/CLI credentials), or `logout`
- `tickets` - `create` or `list` (optional `--status`)
- `ticket` - `context <ticketId>` to print context for one ticket
- `protocol` - agent workflow / ticket lifecycle; see `ovld protocol help`. Subcommands include `auth-status`, `discover-project`, `attach`, `connect`, `load-context`, `search-tickets`, `create`, `spawn`, `update`, `record-change-rationales`, `ask`, `permission-request`, `read-context`, `write-context`, `deliver`, and artifact helpers (`artifact-prepare-upload`, `artifact-finalize-upload`, `artifact-download-url`, `artifact-upload-file`)
- `connect`, `restart`, `context` - launch or resume an agent session, or print ticket context (`context` requires `TICKET_ID`)
- `run`, `resume` - legacy aliases for `connect` and `restart`
- `setup` - install the Overlord connector for an agent; `ovld setup [agent|all]` (interactive with no args). `ovld setup claude` also performs the one-time v3.25.0 to v4 Claude plugin migration
- `update` - install the latest CLI release from npm
- `doctor` - validate installed connectors and check for CLI updates
- `version` - print the installed CLI version

## License

Permission is granted to use this software for any purpose, free of charge. You may not modify, distribute, sublicense, or sell copies of the software without explicit permission from the author.
