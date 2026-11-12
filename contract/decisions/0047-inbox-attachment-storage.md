# ADR 0047: Inbox attachments live in the owner's storage workspace

- Date: 2026-10-26
- Status: accepted
- Contract version: 168
- Supersedes: none
- Origin: contract v168 (coo:1197), backfilled 2026-11

## Context

Profile-owned Inbox captures have no project or workspace, but attachment bytes live in a workspace bucket.

## Decision

An Inbox attachment keeps NOT NULL workspace and bucket: the workspace of the item's earlier attachments, else the request's active workspace, else the owner's oldest membership granting `attachment:create` (409 with none). It is authorized by Inbox item ownership, not workspace membership; workspace-scoped attachment services ignore such rows, and they emit no `entity_changes`. Promotion re-points them to the created mission's first objective, copying bytes into the destination workspace first.

## Consequences

- The oldest-membership fallback is storage placement, but it sits in tension with the rule that no route selects an oldest membership (ADR 0017); flagged for review.

## Alternatives considered

Not recorded.
