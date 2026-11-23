# Cloud board and activity-feed egress, November 23, 2026

**Contract impact: minor.** Contract 182.3.0 and OpenAPI 7.2.0 document negotiated Brotli and gzip and the board's private HTTP cache revalidation. The REST backend computes the current authorized response before evaluating its weak ETag. Feed reads remain live and carry their current timestamp and cursor. Web, Desktop and Mobile use their existing HTTP and realtime paths.

## Production baseline

Railway production `overlord-backend`, deployment `412787eb-e533-45dd-b293-a909adca7f87`. The requested window was November 22 17:06:10 UTC to November 23 08:20:00 UTC. The board sample covers the Overlord project board, which had the most requests in the five-minute discovery sample. The feed sample covers `/api/activity-feed` across the deployment. Both filtered queries returned fewer than 5,000 rows. The logs omitted query strings and identified client groups by source IP and exact User-Agent. All reported groups issued repeat reads. Shared IPs and changing addresses make these groups an approximation of active clients.

| Route | Client family | Active groups | GET 200 | GET 304 | Railway `txBytes` | Mean bytes per active group |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Selected board | Electron | 2 | 100 | 258 | 26,765,063 | 13,382,532 |
| Selected board | Apple native | 2 | 40 | 0 | 70,955,854 | 35,477,927 |
| Activity feed | Electron | 2 | 201 | 0 | 22,736,064 | 11,368,032 |
| Activity feed | Apple native | 1 | 42 | 0 | 4,844,135 | 4,844,135 |

Railway counted zero body bytes for the 304s. Median 200 response bodies were 268,808 and 1,995,415 bytes on the board, and 112,390 and 116,489 bytes on the feed, for Electron and Apple native respectively. The board already had conditional GET traffic. All observed activity-feed requests returned full responses.

## Matched payload replay

Five authorized GETs per variant at 08:23 UTC used the same Cloud account, Overlord board and historical feed cursor. Every response was identity-encoded even with `Accept-Encoding: br, gzip`. Brotli quality 4 and gzip replayed each exact body in memory. All decoded bodies matched the originals byte for byte, including `generatedAt`, `nextBefore` and the response order. The body-byte figures below exclude headers.

| Request | Live bytes per 200 | Brotli replay bytes | Gzip replay bytes | Live explicit ETag follow-up |
| --- | ---: | ---: | ---: | --- |
| Board | 268,938 | 21,119 | 23,747 | 304, zero body bytes |
| Board with objectives | 2,005,785 | 367,479 | 401,636 | 304, zero body bytes |
| Feed head | 120,048 | 28,257 | 28,994 | 200, 120,048 body bytes |
| Feed history | 91,506 | 21,942–21,945 | 22,480–22,481 | 200, 91,506 body bytes |

Both board variants were byte-identical on repeat. The feed's `generatedAt` advanced on every read and the head cursor advanced with it. Compression preserves these fields and avoids an expiry or revision rule for the feed. Board matches reuse Express's current representation validator, which still detects changes from the rolling completion window and embedded objectives. Full responses compress only at 1 KiB or larger and when compression shrinks the body.

## Local verification

The backend suite passed 1,019 tests with 18 skipped and checked 604 HTTP responses for conformance. The focused run also passed the Web realtime invalidation tests. The HTTP tests compared decoded bodies across identity, Brotli and gzip, verified 304s and refreshed payloads after a board edit, and verified authorization against unauthenticated and project-scoped callers before reuse. The contract suite passed 150 tests. The backend typecheck remains blocked by the pre-existing `cli/src/backend-client.ts:137` `Buffer`/`BodyInit` mismatch.

In one local sequential replay, median asynchronous compression took about 2–4 ms for the ordinary board and feed head. The 2.07 MB board with embedded objectives took 24 ms for Brotli and 64 ms for gzip. These estimates exclude network and JSON serialization. Measure production route latency alongside bytes, especially for large boards.

## Gated production comparison

The implementation is local. After it reaches the Cloud backend through the release gate, repeat the same board and feed requests from the same account and client families. Exercise navigation, window focus, a board edit followed by a realtime refresh, a new activity item and a historical feed scroll. Confirm that the board edit returns a new body, that feed timestamps and cursors stay current, and that the next read of an unchanged board can revalidate. Check negotiated encoding and identity fallback on the actual Cloud edge.

Collect the equivalent deployment-scoped logs with `railway logs <deployment-id> --http --method GET --path <path> --since <start> --until <end> --lines 5000 --json`. Match the project, duration, time of day and client-family mix. Compare total `txBytes` per active source-IP/User-Agent group alongside request counts and 200/304 rates. Compare bytes per 200 as a control for differences in client activity and separate any capped windows. The production acceptance criterion remains open until those samples show lower bytes per active client with equivalent freshness.
