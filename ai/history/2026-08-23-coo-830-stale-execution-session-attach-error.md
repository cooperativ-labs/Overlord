# coo:830 — Clarify stale execution-session attach errors

## Change

Attach failures with `execution_request_already_linked` were easy to mistake for
auth/session credential rejection: the backend text contains "session", and the
CLI 401 handler appends `ovld auth login` whenever status is 401.

The CLI now detects that payload (by `code` or message) **before** the 401
credential branch and throws a dedicated diagnostic: stale mission-session
binding, not a user authentication failure, with recovery to retry attach
without `--execution-request-id`. Unlinkable-request retry and other attach
lifecycle paths are unchanged — this case still rejects.

## Result

Focused tests cover the diagnostic text, payload detection, 409 vs 401 HTTP
handling, and the attach command path. Real auth 401s still recommend
`ovld auth login`.
