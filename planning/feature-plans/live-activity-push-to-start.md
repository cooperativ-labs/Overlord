# Desktop-Initiated Live Activities (coo:633)

Status: backend implemented (objective 1 of 2); OverlordMobile adoption outstanding.
Related: coo:439 Live Activity push handoff (contract `28`), coo:444 standard push
notifications (contract `29`). This feature is contract `55`.

## Goal

A mission launched from Overlord Desktop should appear on the assignee's Lock
Screen without them touching their phone. Today a Live Activity only exists if
the mobile app started one locally, so the coo:439 update/end stream has nothing
to update. ActivityKit push-to-start closes that gap: APNs itself creates the
activity from a server payload.

## Three credential families, never interchangeable

| | ActivityKit update token (coo:439) | Device token (coo:444) | Push-to-start token (this feature) |
| --- | --- | --- | --- |
| Source | `Activity.pushTokenUpdates` | `didRegisterForRemoteNotifications…` | `Activity.pushToStartTokenUpdates` |
| Scope | One activity | One app install | One (install, activity type) |
| Lifetime | Dies with its activity | Lives with the install | Outlives every individual activity |
| APNs topic | `<bundleId>.push-type.liveactivity` | `<bundleId>` | `<bundleId>.push-type.liveactivity` |
| `apns-push-type` | `liveactivity` | `alert` / `background` | `liveactivity` |
| Payload `event` | `update` / `end` | n/a | `start` only |
| Storage | `live_activity_push_tokens` | `device_push_tokens` | `live_activity_start_tokens` (new) |

Only a push-to-start token may carry `event: "start"`, and only an update token
may carry `update`/`end`. Passing one where the other is expected is a contract
violation, not merely an APNs error.

## Surface

- `PUT /api/mobile/live-activities/start-token` —
  `{ startToken, environment, bundleId, activityType?, appVersion? }`, `204`.
  Upserts/rotates; the token is globally unique and reassigns to whichever
  profile registered it last, so a shared device never leaves the previous
  account able to start activities on it.
- `POST /api/mobile/live-activities/start-token/revoke` — `{ startToken }`, `204`,
  idempotent.
- `PUT /api/mobile/live-activities/:activityId/push-token` gains the additive
  optional `startedByPush` boolean, recorded as
  `live_activity_push_tokens.origin` (`local` | `push_to_start`).

Tokens travel in the body rather than the URL, exactly as coo:444 device tokens
do, so they stay out of access logs and proxy caches. There is no read surface.

## Consent

Holding a `live_activity_start_tokens` row **is** the consent record. With no row
the server can never remotely start an activity, and revoking is how a user turns
the feature off — so the mobile preference control (objective 2) is implemented
as "upload the token, or revoke it", with no extra server-side preference table.
The coo:444 `notification_preferences` master switch deliberately does not gate
this: it governs standard push only, and the coo:439 contract already states that
it never affects Live Activity delivery.

## Delivery

A mission entering execution enqueues, for the assigned profile only:

1. the existing `overlord.live_activity.dispatch.v1` refresh job, and
2. a new `overlord.live_activity.start.v1` job, coalesced per profile.

Trigger sites are the protocol attach path (objective → `executing`) and the REST
objective-state update. An unassigned mission notifies nobody, as with every
other push surface.

The worker recomputes the same bounded two-running-plus-one-completion snapshot
at delivery time and sends `event: "start"` with `attributes-type`, static
`attributes`, `content-state`, a stale date, and a bounded alert built only from
that snapshot, at `apns-priority: 10` on the registration's own bundle id and
environment host.

A start is skipped when:

- the account already holds **any** `live_activity_push_tokens` row (an activity
  is already on screen, local or push-started) — the refresh job owns it;
- nothing is actually running (a bare completion hold is not worth interrupting
  for); or
- a start was sent to that token within the last five minutes (the handoff round
  trip is not instantaneous, and a duplicate start means a duplicate widget).

After the start, the device registers the new activity's update token with
`startedByPush: true` and the ordinary dispatch job owns every later update and
the end. Retry/backoff and `410`/`400 BadDeviceToken` retirement match the two
existing surfaces; with no APNs credentials configured, enqueueing still succeeds
and dispatch no-ops so local development is unaffected.

## Outstanding (objective 2, OverlordMobile)

Observe `Activity.pushToStartTokenUpdates`, upload and rotate the token for the
signed-in profile, handle account/base-URL changes and sign-out revocation, adopt
the started activity and register its update token with `startedByPush: true`,
add the user-facing consent control, and QA on supported iOS versions. Local
start/update remains the fallback and is unchanged.
