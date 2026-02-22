# MVP Execution Plan (Chat Deferred)

## MVP Goal
Ship a local-first Orchestrator where a PM can create and manage tickets in a webapp (`localhost:3000`), and external agents (Claude apps/CLI and ChatGPT custom GPT) can attach to tickets, read context, and push structured updates.

## Explicitly Out of Scope for This MVP
- In-app DM/chat UI and group chat UX
- Advanced overlap intelligence (LLM/embeddings)
- Multi-tenant org complexity
- Full cloud deployment polish

## Phase 1: Local Platform Foundation (Week 1)
1. Stand up Next.js app + local Supabase + auth scaffolding.
2. Create core DB schema: `tickets`, `agent_sessions`, `ticket_events`, `shared_state`, `artifacts`, `connections`.
3. Add RLS for single-user/local mode and service-role paths for agent protocol.
4. Generate typed DB models and seed example tickets.

Exit criteria: local app runs, DB migrations stable, user can sign in and see seeded tickets.

## Phase 2: Agent Protocol API (Week 1-2)
1. Implement REST endpoints for `list_tickets`, `attach`, `ask`, `update`, `read_context`, `write_context`, `deliver`.
2. Add idempotency, session heartbeat, and attach/resume behavior.
3. Store all agent actions as `ticket_events` (replaces chat for MVP).
4. Add API key/token auth for external agent clients.

Exit criteria: protocol works end-to-end via curl/Postman and persists state correctly.

## Phase 3: Webapp PM Dashboard (Week 2-3)
1. Build ticket list + filters by lifecycle state.
2. Build ticket detail view with spec fields, lifecycle controls, event timeline, shared context panel, and artifacts panel.
3. Build ticket create/edit flow using structured prompt fields.
4. Add “Open in…” menu with attach commands/links (Claude, ChatGPT, Terminal).

Exit criteria: PM can run ticket lifecycle without chat, via structured forms + event timeline.

## Phase 4: External Attach Integrations (Week 3-4)
1. CLI adapter: `overlord attach TICKET-###`, `update`, `ask`, `deliver`.
2. Claude Code path: local CLI bridge + optional local MCP server exposing protocol tools.
3. Claude app path: MCP config instructions + attach command UX.
4. ChatGPT path: Custom GPT Action schema against REST API + deep link with prefilled `attach`.

Exit criteria: each environment can attach to a ticket and submit updates visible in the dashboard.

## Phase 5: Basic Coordination and Safety (Week 4)
1. Implement MVP overlap detection from `shared_state` keys + file/module tags.
2. Surface overlap alerts in ticket dashboard (no chat; alert + action buttons).
3. Add audit trail and replay-friendly event history.
4. Add retries, error states, and reconnect/resume flows.

Exit criteria: overlap alerts and recovery flows work for at least 2 concurrent attached agents.

## Phase 6: Hardening and Demo Readiness (Week 5)
1. Add integration tests for protocol operations and attach flows.
2. Add basic observability: request logs, session liveness, error reporting.
3. Performance pass for realtime/event polling behavior.
4. Write operator docs: local setup, Claude config, ChatGPT Action setup, CLI usage.

Exit criteria: reproducible local demo with PM dashboard + Claude + ChatGPT + CLI attach working.

## MVP Definition of Done
1. PM can create a ticket and move it through Draft -> Review -> Refine -> Execute -> Deliver.
2. Claude CLI/app and ChatGPT custom GPT can attach to a ticket and exchange structured protocol events.
3. Dashboard shows live ticket events, shared context, artifacts, and overlap alerts.
4. Entire flow runs locally with Next.js + local Supabase.

## Post-MVP (Next)
1. Add full chat/DM UI on top of existing `ticket_events`.
2. Add cloud-hosted MCP endpoint and hosted auth model.
3. Add semantic overlap detection (coordinator LLM + embeddings).

## Implementation Status (February 11, 2026)
1. In progress: local platform foundation (Next.js app shell, Supabase project init, MVP schema + seed).
2. In progress: protocol API routes for external agent attach/update/deliver flow.
3. In progress: PM dashboard for ticket list/create/detail with event timeline and attach helpers.
