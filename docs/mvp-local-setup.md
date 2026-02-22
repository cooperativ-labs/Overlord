# Local MVP Setup

## Prerequisites
- Node.js 20+ (project currently running on Node 25)
- Yarn 4
- Supabase CLI

## Start local services
1. Start Supabase:
   - `yarn supabase:start`
2. Apply migrations + seed:
   - `yarn supabase:reset`
3. Start the web app:
   - `yarn dev`

Web app: `http://localhost:3000`  
Supabase API: `http://127.0.0.1:54321`

## Agent protocol auth
Set a local token in `.env.local`:

`OVERLORD_AGENT_TOKEN=overlord-local-dev-token`

All protocol calls require:

`Authorization: Bearer <token>`

## Install agent permissions

Run the installer once after cloning the repo to pre-approve Overlord protocol
calls so agents don't trigger repeated permission prompts:

```bash
yarn install-agent-permissions
```

Options:
- `--agent=claude|codex|all` — target a specific runtime (default: `all`)
- `--platform-url=<url>` — override the default `http://localhost:3000`
- `--dry-run` — preview changes without writing files

Verify permissions are correctly installed:

```bash
yarn verify-agent-permissions
```

### Rollback

The installer creates a timestamped backup before modifying any file. To restore:

```bash
# Find the backup
ls .claude/settings.local.json.backup-*

# Restore
cp .claude/settings.local.json.backup-<timestamp> .claude/settings.local.json
```

### Troubleshooting

- **Permission prompts still appear:** Run `yarn verify-agent-permissions` to check for
  missing entries. The verifier will print the exact remediation command.
- **Custom platform URL:** If your local dev server runs on a different port, pass
  `--platform-url=http://localhost:<port>` to both install and verify.
- **Broad `curl:*` wildcard present:** The verifier will report OK if `Bash(curl:*)`
  exists (it covers all curl commands). The installer only adds scoped entries for
  new setups.

## Protocol endpoints
- `POST /api/protocol/list-tickets`
- `POST /api/protocol/attach`
- `POST /api/protocol/ask`
- `POST /api/protocol/update`
- `POST /api/protocol/decision`
- `POST /api/protocol/read-context`
- `POST /api/protocol/write-context`
- `POST /api/protocol/deliver`

## Example attach call
```bash
curl -X POST http://localhost:3000/api/protocol/attach \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer overlord-local-dev-token" \
  -d '{
    "ticketId":"<uuid>",
    "agentIdentifier":"Claude Code",
    "connectionMethod":"cli"
  }'
```

## Local CLI bridge
Use the built-in helper to call protocol endpoints from terminal workflows:

```bash
yarn overlord list
yarn overlord attach <ticketId> "Claude Code" cli 
```
