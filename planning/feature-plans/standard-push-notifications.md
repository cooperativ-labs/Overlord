# Standard Push Notifications (coo:444)

Status: backend implemented (objectives 1–2 of 4); mobile work outstanding.
Related: coo:439 Live Activity push handoff (contract `28`).

## Goal

Deliver ordinary iOS push notifications — alerts a user sees when Overlord is
backgrounded or closed — for the small set of mission-lifecycle moments that
actually need a person. This is distinct from the coo:439 Live Activity surface,
which keeps a Lock Screen widget fresh while work runs.

The two surfaces reuse the same durable dispatch machinery (`worker_jobs`, APNs
JWT signing, retry/backoff, invalid-token retirement) but never share tokens,
tables, routes, topics, or payload shapes.

## Why device tokens and ActivityKit tokens must stay separate

| | ActivityKit token (coo:439) | Standard device token (this feature) |
| --- | --- | --- |
| Source | `Activity.pushTokenUpdates` per started activity | `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` |
| Lifetime | Lives and dies with one Live Activity | Lives with the app install; rotates on reinstall/restore |
| APNs topic | `<bundleId>.push-type.liveactivity` | `<bundleId>` |
| `apns-push-type` | `liveactivity` | `alert` or `background` |
| Permission | No user prompt required | Requires `UNUserNotificationCenter` authorization |
| Storage | `live_activity_push_tokens` | `device_push_tokens` (new) |

Sending an alert to an ActivityKit token (or vice versa) is rejected by APNs and,
worse, would let an ended activity silently suppress a user's alerts. The mobile
app must never pass one where the other is expected.

## Policy

### Notification categories

Exactly four categories, each mapped to an existing server-side lifecycle
transition that already enqueues Live Activity refreshes:

| Category | Fires when | Default |
| --- | --- | --- |
| `mission_awaiting_review` | An objective is delivered and the mission lands in review | on |
| `agent_question` | An agent posts a blocking `ask` / the objective enters `blocked` | on |
| `mission_complete` | The mission's final objective completes and the mission closes | on |
| `mission_failed` | An objective or execution request fails or is cancelled with an error | on |

Categories are intentionally lifecycle-only. Ordinary progress updates,
heartbeats, and discussion events never produce an alert — that is the Live
Activity's job.

#### Implemented trigger sites

Each category has exactly one enqueue site, so a single lifecycle moment can
never produce two notifications:

| Category | Enqueued from |
| --- | --- |
| `mission_awaiting_review` | `deliverSession` (`packages/core/service/protocol.ts`), after the auto-advance decision. **Skipped** when auto-advance successfully queued the next objective: work is still in flight, no review is owed yet, and the Live Activity already shows it. A failed auto-advance still notifies, because the mission is then genuinely parked. |
| `agent_question` | `askQuestion` (`packages/core/service/protocol.ts`), in the same transaction that writes the `ask` event and moves the mission to review. |
| `mission_complete` | `updateMission` (`backend/repository.ts`), on an actual transition into a `complete` status type. Re-saving the same status is a no-op, so a no-op PATCH cannot re-notify. |
| `mission_failed` | `markExecutionFailed` (`packages/core/service/execution-requests.ts`). A failed launch strands the mission with nobody working it; the error text stays in the mission event and never reaches the payload. |

`recordWork` deliberately does *not* notify: the person recording already-finished
work is the same person who would receive the alert.

### Delivery rules

- **Recipient**: only the profile assigned to the mission (the same
  `assigned_workspace_user_id → profile_id` resolution the Live Activity jobs
  use). Notifications are never broadcast to a workspace.
- **Opt-in**: a device receives an alert only if the profile has a registered,
  non-retired device token *and* the category resolves to `alert`. There is no
  implicit registration; the app must have been granted OS permission.
- **Per-category mode**: `alert` (visible), `silent` (background content-available
  push, no banner — refreshes badge/state only), or `off` (nothing sent).
- **Master switch**: a profile-level `enabled` flag. When off, no standard push
  of any category is sent, regardless of per-category values. Live Activity
  delivery is unaffected — it is a separate, non-interruptive surface.
- **Coalescing**: one `apns-collapse-id` per `(missionId, category)` so a rapid
  re-delivery replaces rather than stacks. Distinct categories never collapse
  into each other.
- **Deduplication**: the dispatch job carries a `dedupeKey` of
  `<category>:<missionId>:<objectiveId|->`; a queued or running job with the same
  key for the same profile is not re-enqueued.
- **Priority**: `apns-priority: 10` for `alert`, `5` for `silent`. Alerts carry
  an `apns-expiration` of one hour — a stale "awaiting review" ping is noise.
- **Durability**: dispatch is a `worker_jobs` row (`overlord.push_notification.dispatch.v1`)
  with the same claim/lock/backoff shape as the Live Activity dispatcher, so a
  backend restart or transient APNs failure never drops a notification.
- **No credentials, no delivery**: when APNs environment variables are absent
  (the normal local-development case) enqueueing still succeeds and the
  dispatcher no-ops. Local Overlord must remain fully functional offline.

### Token lifecycle

- Registration is an upsert on `(profile_id, device_token)`; re-registering an
  existing token refreshes `last_registered_at` and clears any retirement.
- A device token is bound to exactly one profile. Registering a token already
  held by another profile reassigns it (sign-out on a shared device must not
  leak the previous account's notifications).
- Sign-out revokes explicitly via the revoke route; the app must call it before
  clearing credentials.
- APNs `410 Unregistered` or `400 BadDeviceToken` retires the row (delete). Any
  other non-2xx is a retryable dispatch error.
- Registration records `environment` (`sandbox` | `production`) so a TestFlight
  or debug build is never sent through the production APNs host, and `bundle_id`
  so a future second app target cannot receive another target's pushes.

### APNs payload privacy rules

The payload is a **presentation snapshot only**, recomputed at delivery time from
the database — never carried in the job payload. It contains:

- `aps.alert.title`: bounded project name, ≤ 40 chars.
- `aps.alert.body`: sanitized, bounded mission title (≤ 80 chars, markdown
  stripped) prefixed by the mission display id, plus a fixed per-category verb
  ("is ready for review", "needs your input", "finished", "failed").
- `aps.thread-id`: mission id (groups a mission's notifications in Notification
  Center).
- `aps.badge`: count of the profile's missions currently awaiting its review.
- `aps.sound`: `default` for `alert`; omitted for `silent`.
- `aps.content-available: 1` and no `alert` for `silent`.
- `data.missionId`, `data.category`, `data.deepLink` (`overlord://missions/<missionId>`).

It **must never** contain: bearer tokens, session keys, ActivityKit tokens,
objective instructions, agent prompts, delivery summaries, change rationales,
file paths, diffs, question text, `mission_events.payload_json`, or any workspace
or project the recipient cannot already read. The sanitizer reused from
`live-activities.ts` (`presentationTitle` / `bounded`) is the only path by which
user-authored text reaches a payload.

Because APNs sees payload contents in transit, "the recipient could read it
anyway" is not a justification for including detail. If a field is not needed to
decide whether to open the app, it is not in the payload.

## Data model

### `device_push_tokens` (new core table)

| Column | Notes |
| --- | --- |
| `id` | text PK |
| `profile_id` | FK → `profiles(id)` ON DELETE CASCADE |
| `device_token` | opaque APNs hex token, non-empty, `UNIQUE` |
| `platform` | `'ios'` (only value today) |
| `environment` | `'sandbox'` \| `'production'` |
| `bundle_id` | app target that owns the token |
| `app_version` | nullable, diagnostics only |
| `last_registered_at`, `last_sent_at` | timestamps |
| `created_at`, `updated_at` | timestamps |

Index on `profile_id`. Private: never projected through REST reads, realtime,
entity changes, or audit payloads — the same rule `live_activity_push_tokens`
already carries.

### `notification_preferences` (superseded by coo:637 P4)

The original standard-push design used one row per `(profile_id, category)`.
P4 supersedes that storage shape with `(profile_id, type, transport)` rows and
the reserved `(all, all)` master row. Existing category rows fan out to every
catalog-eligible transport during migration; Live Activity delivery remains
outside the master switch.

| Column | Notes |
| --- | --- |
| `id` | text PK |
| `profile_id` | FK → `profiles(id)` ON DELETE CASCADE |
| `type` | `all` or a shared notification-catalog id |
| `transport` | `all` for the master row, otherwise catalog-eligible `apns` \| `realtime` \| `in_app` |
| `mode` | `alert` \| `silent` \| `off` (`(all, all)` uses `alert`/`off` only) |
| `created_at`, `updated_at` | timestamps |
| | `UNIQUE (profile_id, type, transport)` |

Absent rows mean the catalog descriptor's `defaultMode`, so a new account is
opted in at the policy layer but still receives nothing until it registers a
token — OS permission remains the real gate.

## Surfaces

### REST (backend owns)

- `PUT /api/mobile/push/device-token` — `{ deviceToken, environment, bundleId, appVersion? }`
  → `204`. Upserts/rotates the caller's registration.
- `POST /api/mobile/push/device-token/revoke` — `{ deviceToken }` → `204`,
  idempotent. A `POST` rather than `DELETE` so the token stays out of the URL and
  therefore out of access logs and proxy caches.
- `GET /api/profile/notification-preferences` → canonical
  `{ enabled: boolean, preferences: { type, transport, mode }[] }`, plus an
  additive APNs `{ categories: { category, mode }[] }` compatibility projection
  for released mobile builds.
- `PUT /api/profile/notification-preferences` accepts `{ enabled?, preferences? }`;
  the legacy `categories?` field remains an APNs-only compatibility alias. Partial
  updates merge; unknown types, transports, pairs, or modes are rejected `400`.

Preferences are profile state readable by any of the profile's own clients (web
and desktop settings UI, not only mobile), which is why they live under
`/api/profile` rather than `/api/mobile`. Device tokens are mobile-only and have
no read surface at all.

### Service layer

- `enqueuePushNotificationJob({ db, workspaceId, profileId, category, missionId, objectiveId? })`
  and `enqueuePushNotificationForMission(...)` in
  `packages/core/service/push-notification-jobs.ts`, mirroring the Live Activity
  jobs module. Called from the same protocol/repository lifecycle sites that
  already call `enqueueLiveActivityRefreshForMission` — deliver, ask/blocked,
  complete, and failure paths.

### Dispatcher

`backend/push-notification-dispatcher.ts`, an in-process worker started next to
`liveActivityDispatcher`. Shares the JWT/HTTP2 APNs client helpers (to be
extracted into `backend/apns-client.ts` so both dispatchers use one signer and
one connection routine) but keeps its own job type, topic, push type, priority,
and retirement handling.

## Configuration

Reuses the existing `OVERLORD_APNS_TEAM_ID`, `OVERLORD_APNS_KEY_ID`,
`OVERLORD_APNS_PRIVATE_KEY`, `OVERLORD_IOS_BUNDLE_ID`, and `OVERLORD_APNS_ENV`.
Per-registration `environment` overrides `OVERLORD_APNS_ENV` for host selection
so sandbox and production installs can coexist against one backend. No new
secrets.

## Objective plan

1. **(done)** Policy, preference model, payload privacy rules, contract `29`.
2. **(done)** Backend: migrations, registration/revocation, preferences,
   dispatcher, lifecycle enqueueing, retirement, config, tests. The APNs signer
   and HTTP/2 transport were extracted to `backend/apns-client.ts`, which the
   Live Activity dispatcher now shares; `bounded`/`presentationTitle` are
   exported from `live-activities.ts` so both surfaces sanitize user text
   through one implementation.
3. **(next)** Mobile: permission request, token registration/rotation/sync, settings UI.
4. Mobile: device QA across app states, permission denial, rotation, sign-out,
   taps/deep links, preference changes.

## Risks and open questions

- Badge count is computed per dispatch; if a user clears missions on the web the
  badge only corrects on the next push. Acceptable for v1; a periodic silent
  refresh is deferred.
- Reassigning a device token between profiles on a shared device is handled by
  the `UNIQUE (device_token)` upsert, but a client that never calls revoke on
  sign-out leaves a window until the next registration. The mobile objective
  must call revoke before clearing credentials.
- APNs connection reuse across two dispatchers is deliberately not pooled in v1;
  each send opens and closes an HTTP/2 session, matching coo:439. Pooling is a
  later performance change, not a contract change.
