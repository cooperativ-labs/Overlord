# Overlord Ticket Card Sunpeak App

This directory is the first Sunpeak adoption step for Overlord's interactive MCP ticket card.

Current state:

- `src/resources/ticket-card/ticket-card.tsx` is the Sunpeak resource version of the ticket card UI.
- `src/tools/create_ticket_draft.ts` and `src/tools/save_ticket_draft.ts` provide a local Sunpeak tool loop for simulator work.
- `tests/simulations/` contains starter fixtures for the happy path and a malformed save response.
- Production MCP traffic still flows through `supabase/functions/mcp/`; this app is not wired into the Supabase edge function yet.

Useful commands from the repo root:

- `yarn sunpeak:ticket-card:dev`
- `yarn sunpeak:ticket-card:build`
- `yarn sunpeak:ticket-card:start`
