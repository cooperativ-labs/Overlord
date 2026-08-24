# coo:826.yb2y — Inbox Next items are agent-created only

## Summary

`GET /api/inbox/missions` no longer surfaces human (or other non-agent) Next
missions through the recent window. Status type `next` on the Inbox triage list
is agent-authored only; the recent window still includes non-Next missions of
any creator.

## Changes

- **Contract v118**: clarify Next-status rows are agent-authored only; recent
  window excludes non-agent Next.
- **Backend**: recent SQL adds
  `(status_type != 'next' OR created_by_kind = 'agent')`; tests cover human Next
  exclusion and recent agent Next inclusion.
- **Webapp**: Inbox copy updated to match the narrower Next rule.

## Assumptions

- "Next items" means missions with status type `next` on the Inbox missions
  triage list, not Everything Queued run-queue entries.
