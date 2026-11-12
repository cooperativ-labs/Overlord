# ADR 0037: Features are identified by a canonical reference found by exhaustive lookup

- Date: 2026-10-05
- Status: accepted
- Contract version: 155
- Supersedes: none
- Origin: contract v155 (per:202.5h64), backfilled 2026-11

## Context

Knowledgebase Features are handed to Overlord as missions, and both sides must find the mission for a Feature without relying on titles.

## Decision

A Feature's identity is `kb-feature:<origin>/<workspace slug>/<node uuid>`, carried in objective text; never a title or path. Protocol `search --reference` is an exhaustive, unranked lookup of that token within one readable project; ranked search never proves absence. Mission completion is mission status type `complete`. The assistant may link a Feature to a mission only when the write names exactly one live readable mission that carries no other Feature's reference.

## Consequences

- Handoff creates drafts through the user's Create only.

## Alternatives considered

Not recorded.
