# ADR 0034: Assistant conversations are private, Cloud-only, and create work only through Create

- Date: 2026-10-05
- Status: accepted
- Contract version: 152
- Supersedes: none
- Origin: contract v152 (coo:1108), backfilled 2026-11

## Context

Overlord gained an assistant that researches projects, repositories and a Knowledgebase and proposes missions.

## Decision

A chat thread is private to one owner profile in one organization; every route hides other owners' resources with 404. Chat is Cloud-only, with tables on both editions. Chat events are a private, owner-scoped channel that does not derive from `entity_changes`; this is the sole exception to that realtime rule, and chat writes emit no change rows, webhooks or search documents. Runs are leased and fenced so a worker that lost its lease cannot publish, invoke or checkpoint. Every derived row records its source dependencies, and revoked access fails closed. `POST /api/chat/proposals/:id/create` is the only path from a conversation to missions; no tool creates, changes, launches or queues work. Account connections store external credentials in AES-256-GCM envelopes bound to the owner.

## Consequences

- The behavioural contract is [architecture.md](../architecture.md) "Assistant Conversation Behaviour".

## Alternatives considered

Not recorded.
