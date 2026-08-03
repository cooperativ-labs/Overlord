# Fix inbox dueDatetime null validation

## Problem

Saving an unassigned mission (inbox item) from the new mission modal failed with:

`dueDatetime must be a valid ISO-8601 datetime or null`

## Cause

`validateInboxBody` in `backend/repository.ts` coerced `undefined`/`null` to `null`, then rejected anything that was not a string — including the valid `null` case.

## Fix

Allow `null` through, matching mission create/update validation. Only reject non-null values that are not parseable ISO-8601 datetimes.

## Client check

- `NewMissionModal` already passes `dueDatetime: null` when there is no default due date.
- `QuickTaskBar` omits `dueDatetime` when creating an inbox item (same null path server-side). No client change required.

## Follow-up: hide Run / agent controls without a project

Inbox items cannot be launched, so both surfaces now hide the agent selector and Run button when no project is selected:

- `NewMissionModal`
- `QuickTaskBar`
