# coo:765 — Latch widget "request entity too large"

## Symptom

The mission-page Latch card showed:

```
request entity too large — request entity too large
```

Inspect, open, stop, and the agent session itself kept working. The error sat on
the card as if the session were broken.

## Root cause

The widget collects `latch events --json --from N` locally, then POSTs the whole
snapshot to `POST /api/missions/:id/terminal-sessions/harness-events`. That
ingest is presentation only (turn count, pending `awaiting_input`, cursor).

Express's default JSON body limit is 100 KiB. A Latch session that has been
streaming `assistant_delta` lines, or that is catching up from cursor 0, easily
exceeds that. body-parser throws `PayloadTooLargeError` (`type:
entity.too.large`, message `request entity too large`). The generic error
handler did not recognize it, so it answered 500 with `{ error, detail }` both
set to that message. The web client always renders `error — detail`, which is
why the string was duplicated.

Because ingest failed, the stored cursor did not advance, so every 10s poll
retried the same oversized POST and the red text stayed on the card. Channel 1
(protocol attach/update/deliver) never touched this path.

## Fix

- Harness-event POSTs parse JSON with a 1 MiB limit instead of the global 100
  KiB default.
- The widget and the runner post-launch ingest split collected events into
  ≤64 KiB chunks, each with the correct `from` cursor so the server can fold
  them in order.
- body-parser 413 maps to `body_too_large` with a single message, so a future
  oversize cannot reappear as the duplicated string.
