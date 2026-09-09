# Narrow deferred work to out-of-mission recommendations (coo:986.z9p7)

## Definition

`deferredWork` is only for recommended **new** objectives that are **not part of
the current mission**. Out-of-scope bugs found during the work are the canonical
example. It is not:

- work already covered by this mission's future (or otherwise incomplete sibling)
  objectives
- leftover slices of the current objective (those belong as a new objective on
  this mission via `add-objectives`)
- human implementation follow-up such as deploy, secrets, or migrations (those
  belong in `humanActions`)

Empty array is the correct default.

## Pipeline

`agentReport.deferredWork` is never rewritten.

`presentation.deferredWork` is the eligible subset:

1. Persist (`deliverSession` / `recordWork`) filters the agent list against the
   current objective, planned sibling objectives, human actions, and
   path-derived deterministic follow-up candidates.
2. Compose sends only that eligible list to Gemini, plus the planned objectives
   and any omitted items so they are not restated. Extras are kept only when
   they still pass eligibility.
3. Reconciliation still refuses to shorten or drop remaining eligible items.

Feed-rail ids match the original agent-report index, so dropping an earlier
ineligible item does not reattach a resolution to a different statement.
