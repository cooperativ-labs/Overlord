# Fix inbox create rejecting null dueDatetime

## Problem

`POST /api/inbox` from the New Mission modal returned 400:
`dueDatetime must be a valid ISO-8601 datetime or null` when creating an
Inbox item without a due date (the modal sends `dueDatetime: null`).

## Cause

`validateInboxBody` normalized `undefined`/`null` to `null`, then required
`typeof dueDatetime === 'string'`. Because `typeof null === 'object'`, every
create without a due date failed.

Source was fixed in `1ff75b6d`, but `backend/dist-server/index.cjs` (what
production serves) still had the old check.

## Fix

- Rebuild `backend/dist-server` so the null-safe validation ships.
- Add `backend/inbox.test.ts` covering omitted, null, valid, and invalid
  `dueDatetime` values.
