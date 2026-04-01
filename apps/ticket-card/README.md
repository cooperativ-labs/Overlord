# Overlord Ticket Card Sunpeak App

This directory is the first Sunpeak adoption step for Overlord's interactive MCP ticket card.

Current state:

- `src/resources/ticket-card/ticket-card.tsx` is the Sunpeak resource version of the ticket card UI.
- `src/tools/create_ticket_draft.ts` and `src/tools/save_ticket_draft.ts` provide a local Sunpeak tool loop for simulator work.
- `tests/simulations/` contains starter fixtures for the happy path and a malformed save response.
- The Sunpeak-built HTML is synced into the Supabase edge function via `yarn sunpeak:ticket-card:build-and-sync`.

Useful commands from the repo root:

- `yarn sunpeak:ticket-card:dev` — start the Sunpeak dev server with simulator
- `yarn sunpeak:ticket-card:build` — build the Sunpeak app to `dist/`
- `yarn sunpeak:ticket-card:start` — start the production Sunpeak MCP server
- `yarn sunpeak:ticket-card:sync` — sync built output into the edge function resource file
- `yarn sunpeak:ticket-card:build-and-sync` — build + sync in one step

After syncing, the production MCP edge function at `supabase/functions/mcp/` serves the
Sunpeak-built ticket card HTML via the stable resource URI `ui://overlord/ticket-card`.
The public endpoint is available at `https://cooperativ.io/api/mcp` (proxied through the
Next.js app route).
