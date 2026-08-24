# coo:844.rjhs — Inbox missions are agent-Next only

## Summary

`GET /api/inbox/missions` no longer includes the v117–v118 recent window that
surfaced human-created missions. The Inbox missions triage list now returns only
agent-authored missions still in status type `next`. Unallocated profile-owned
captures remain on `/api/inbox`.

## Changes

- **Contract v120**: narrow inbox missions to agent-Next only; remove recent
  human-mission union.
- **Backend**: drop the recent SQL projection; tag recent agent-Next rows in the
  mapper for UI labeling.
- **Webapp**: Inbox copy updated to match.

## Assumptions

- "Unassociated" means unallocated inbox captures (`/api/inbox`), not a separate
  mission filter beyond agent + Next status.
