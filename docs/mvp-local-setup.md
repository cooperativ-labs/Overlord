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

`ORCHESTRATOR_AGENT_TOKEN=orchestrator-local-dev-token`

All protocol calls require:

`Authorization: Bearer <token>`

## Protocol endpoints
- `POST /api/protocol/list-tickets`
- `POST /api/protocol/attach`
- `POST /api/protocol/ask`
- `POST /api/protocol/update`
- `POST /api/protocol/read-context`
- `POST /api/protocol/write-context`
- `POST /api/protocol/deliver`

## Example attach call
```bash
curl -X POST http://localhost:3000/api/protocol/attach \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer orchestrator-local-dev-token" \
  -d '{
    "ticketId":"<uuid>",
    "agentIdentifier":"Claude Code",
    "connectionMethod":"cli"
  }'
```

## Local CLI bridge
Use the built-in helper to call protocol endpoints from terminal workflows:

```bash
yarn orchestrator list
yarn orchestrator attach <ticketId> "Claude Code" cli
```
