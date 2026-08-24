# coo:837.400q — Flush claim long-poll headers and timeout LISTEN connect

Date: 2026-08-23

## What changed

`POST /api/runner/claim` no longer holds the HTTP response completely silent for
up to 25 seconds while Postgres LISTEN waits.

After LISTEN is armed (and the post-LISTEN claim is still empty), the handler
flushes HTTP 200 + `Content-Type: application/json` with **no body bytes**. The
final body is still compact `{ request, longPoll }` JSON. The CLI
`JSON.parse(await response.text())` is unchanged: no newlines, spaces, or
heartbeat JSON during the wait.

`pg.Client.connect()` for the dedicated LISTEN client is bounded at 3 seconds
(`connectionTimeoutMillis` plus a `Promise.race` so injected clients cannot
hang). Connect failure or timeout returns `{ request: null, longPoll: false }`
so the runner uses its jittered 5s fallback instead of sitting until a proxy
502s.

Fetch `bodyTimeout` on claim is unchanged. After early headers the quiet period
moves onto the body.

Backend-only. Runners pick this up on deploy. No LaunchAgent / plist change.

## Tests

- Empty long-poll body is JSON-only after flushed headers (`JSON.parse` of the
  exact compact object).
- Fetch of a delayed long-poll response has no preamble.
- HTTP headers (200) are flushed before the JSON body is written.
- LISTEN connect timeout returns null / `longPoll: false`.
- Notification still claims promptly after LISTEN is armed.
