# Chat agent — Phase E conversation notifications and acknowledgements (coo:1108.bxc2)

Implements the notification slice of the Gemini-first milestone against contract v152.
The schema, DTOs and candidate writes already existed from `vasc`/`a1ac`. This
objective adds presence, acknowledgements, history and the dispatcher. Clients
(`r2b0` web, `btc9` mobile) are not part of it.

## What was built

- `packages/core/service/chat/notifications.ts` (`ChatNotifications`):
  - **Presence:** `presence()` renews (TTL `presenceTtlMs`, default 30 s) or releases
    one client's foreground presence.
  - **Acknowledgement:** `ack()` records a monotonic, idempotent rendered-event
    acknowledgement. It suppresses pending candidates at or below that `seq`, but only
    when the acknowledging client holds live presence at that moment.
  - **History:** `history()` and `markRead()` (revision-checked).
  - **Dispatch lifecycle:** `claimDue()` uses a state-guarded claim with a 60 s lease,
    and a crashed worker's rows are reclaimed. `recheck()` covers owner/organization
    membership, thread addressing, and for questions that the question is still open
    on a `waiting_user` run. The finalizers apply only while the worker holds the
    claim. Transient failures back off and become `failed` after `max_attempts`.
- `backend/chat-notification-dispatcher.ts`:
  - An in-process poller, started next to the chat worker on Cloud.
  - Rechecks the preference catalog through `resolveNotificationMode`:
    - master switch off, or both `apns` and `in_app` off: the candidate is cancelled;
    - `apns` off with `in_app` on: added to history without a push;
    - `silent`: a background push.
  - Sends through the existing device-token APNs path. That path was extracted from the
    mission dispatcher as `sendToProfileDevices`, so the transport, token retirement
    and sandbox/production routing are shared.
  - The payload carries only type, sanitized title (≤ 80 characters), thread/run ids,
    badge and `overlord://chat/threads/:threadId`. The collapse id is
    `chat:<notificationId>`.
- `backend/chat.ts`: `PUT /threads/:id/presence`, `POST /threads/:id/ack`,
  `GET /notifications`, `POST /notifications/:id/read`. These carry the same
  `chat_unavailable` Local guard and existence-hiding 404s as the other chat routes.
- `backend/push-notifications.ts`:
  - The preference catalog now admits `chat_needs_answer`/`chat_finished` on `apns`,
    `realtime` and `in_app`. The legacy `categories` alias stays mission-only, because
    released iOS builds decode it.
  - `unreadBadgeCount` is now the single badge definition: unread mission notifications
    plus unread dispatched conversation notifications. Mission pushes use it too.
- Config: `CHAT_NOTIFICATION_GRACE_MS` and `CHAT_PRESENCE_TTL_MS` (defaults 5000 and
  30000). They are applied to the router, the chat worker, the dispatcher, and the
  connections runtime's access-loss path, which can also end runs.
- Contract v152 text now records the acknowledgement edge cases, the
  preference/dispatch rules, retry, the collapse id and the badge definition.
  `NotificationPreferenceDto.type` was widened to include the chat types.

## Verification

```sh
TMPDIR=/tmp node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 \
  backend/chat-notifications.postgres-conformance.test.ts \
  packages/core/service/chat/chat.postgres-conformance.test.ts \
  packages/core/service/chat/proposals.postgres-conformance.test.ts \
  backend/chat/gemini-runtime.postgres-conformance.test.ts backend/chat.test.ts \
  database/src/chat-schema.postgres-conformance.test.ts \
  backend/connections/connections.postgres-conformance.test.ts \
  backend/push-notifications.test.ts backend/live-activity-push-to-start.test.ts
```

- 176/176 focused tests, with the new notification suite (10 cases) on both SQLite and
  real pooled Postgres. The cases cover:
  - a stale "open" stream plus foreground presence without an acknowledgement still
    dispatches after the grace period;
  - a foreground acknowledgement from a second device suppresses;
  - lapsed or released presence does not suppress;
  - acknowledgements are monotonic, bounded and owner-scoped;
  - repeated questions are independent;
  - an answered question is cancelled at dispatch, a failed run notifies, a cancelled
    run never does;
  - retry with backoff, two racing dispatchers send once, a crashed worker's lease is
    reclaimed and the stale worker cannot finalize, and the row fails after max
    attempts;
  - silent, in-app-only, both-off, master-off and revoked-membership outcomes;
  - history, unread count, badge, and the revision-checked read;
  - no question or transcript text appears in the payload, and the mission
    `notifications` table is untouched.
- HTTP route test for presence, acknowledgement, history and the Local guard.
- `push-notifications.test.ts`: the preference count rises from 16 to 22, chat
  preferences round-trip, and a new combined badge test passes. All existing mission
  push tests pass unchanged.
- Regression: backend 601/601, core 598/598. Core and webapp typecheck clean. The
  backend typecheck has only the two existing errors in
  `backend/execution/runner-claim-http.test.ts`. The conformance-version check
  reports stale desktop/everhour/mcp manifests that this objective did not touch.

## Limitations

- **APNs not exercised live.** No real APNs push was sent. The dispatcher was tested
  with an injected sender; the shared transport is the one mission pushes already use.
  An end-to-end push to a physical phone waits on the mobile client (`btc9`) and is
  rechecked in `z77k`.
- **No client sends presence or acknowledgements yet.** Until `r2b0`/`btc9` do, every
  qualifying transition dispatches after the grace period.
- **Retries can duplicate.** Delivery is at-least-once. A crash between the APNs send
  and the `dispatched` write re-sends under the same collapse id, so the device
  replaces the banner rather than showing two.
- **Small recheck race.** The recheck runs just before the send, so a question
  answered during that window can still alert.
- **Unused or missing preferences.** The `realtime` preference for the chat types is
  stored but nothing consumes it yet (no in-app toast). History has no dismiss route
  and returns at most the newest 100 entries.
- **Mobile badge.** The badge counts conversation notifications across all of the
  profile's organizations. Whether the mobile app clears or derives the badge locally
  is for `btc9` to align.
