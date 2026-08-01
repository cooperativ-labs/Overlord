# coo:566 — Display Shared Mission State

Date: 2026-08-01

## Summary

Missions already persist durable shared context in `shared_context_entries`
(Protocol `read-context` / `write-context`). This work exposes that state to
humans in the web/desktop mission panel and adds REST endpoints matching the
existing protocol model.

## Changes

- Contract v50: `GET`/`PUT /api/missions/:id/context` + `SharedContextEntryDto`
- Backend list/upsert with `shared_context_entry` entity-change projections
- Protocol `writeSharedContext` also emits entity changes for realtime
- Mission panel footer: collapsed Shared State, view/edit/add entries
- Desktop covered automatically (embeds the same SPA)

## Tests

- `backend/shared-context.test.ts`
- realtime invalidation routing for `shared_context_entry`
