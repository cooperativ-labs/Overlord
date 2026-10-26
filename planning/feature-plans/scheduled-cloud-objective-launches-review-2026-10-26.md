# Review: Claude Cloud Execution plan (2026-10-26)

Mission: coo:1219, objective coo:1219.zb17
Reviewed: `planning/feature-plans/scheduled-cloud-objective-launches.md` (consolidated final implementation spec)
Method: every claim about existing code was checked against the schema, services and CLI in this
checkout; the §3 platform facts were rechecked against the Anthropic routines guide and the fire API
reference on 2026-10-26.

Findings are grouped by severity. **Blocking** items break Phase 1 or 2 as written. **Should fix**
items are design gaps that will otherwise be discovered mid-implementation. **Editorial** items are
inaccuracies that cost an implementer time.

## 1. Blocking

### 1.1 Mission-less verification requests violate an existing CHECK

§8.6 uses "a mission-less execution request with `requested_source = cloud_verify`". The schema
only allows NULL `mission_id` / `objective_id` for one source:

```sql
-- database/postgres/migrations/20260827120000_local_target_mutation_optional_mission.sql
CONSTRAINT execution_requests_mission_scope CHECK (
  requested_source = 'local_target_mutation'
  OR (mission_id IS NOT NULL AND objective_id IS NOT NULL)
)
```

A `cloud_verify` insert fails. §13 Database does not list this change.

Fix: extend the CHECK to `requested_source IN ('local_target_mutation', 'cloud_verify')` in both
dialects. SQLite cannot alter a CHECK, so that dialect needs an `execution_requests` table rebuild
(the 2026-08-27 SQLite migration is the precedent). Also note that
`notify_execution_request_completed` is keyed on `local_target_mutation` and does not need
extending. The generic expiry sweep already ignores mission-less rows for sources other than
`local_target_mutation` (the objective join is NULL), which is the reason verify requests escape
it, not the exclusion §8.4 describes.

### 1.2 The Claude Cloud target can never be "reachable"

§4.1 and §12.1 launch an existing objective through `resolveLaunchExecutionTarget` with the Claude
Cloud target selected. For an explicit target that function requires the target to appear in
`listEligibleProjectExecutionTargets` and be `reachable`
(`packages/core/service/project-execution-target.ts:869-889`). For a `virtual` target:

- eligibility needs an active `workspace_user_execution_targets` row for the caller and an
  `execution_targets` row with `status = 'active'`;
- `reachable` needs `execution_target_registrations.last_heartbeat_at` to be recent
  (`isTargetReachable`, `:149`), and the workspace target list additionally requires
  `registration.health` in `healthy` / `degraded` (`:253-262`).

§5.2 step 4 only says "create the user's Claude Cloud target if it doesn't exist". Nothing in the
plan creates the access row or a registration, and nothing refreshes a heartbeat, so the target
picker will show the target as "No healthy runner is currently available" and direct launches
will fail with `execution_target_not_eligible`.

Fix: specify the target bootstrap and its liveness. Recommended shape:

- On first Save, create the `execution_targets` row (`type = 'virtual'`,
  `owner_workspace_user_id` = the user, label "Claude Cloud"), the owner's
  `workspace_user_execution_targets` row (`access_status = 'active'`), and one
  `execution_target_registrations` row with `gateway_key = 'claude-code-cloud'` and
  `gateway_instance_id = 'builtin:<targetId>'` (the `(gateway_key, gateway_instance_id)` unique
  index needs a per-target value).
- The backend owns that registration: the `CloudJobWatchdog` poll refreshes `last_heartbeat_at`
  and sets `health` from the routine binding (`needs_attention` → `unhealthy`, otherwise `healthy`).
- Alternatively add a built-in-adapter bypass in the two reachability computations. Either way,
  §13 Virtual targets must name the mechanism, and §5.1 Disconnect must say what happens to the
  target (soft-delete via `deleteWorkspaceExecutionTarget`, which refuses while requests are active).

### 1.3 The request state machine lacks the transitions the run procedure uses

`assertTransition` only permits `claimed → launching`, `launching → launched`, and
`queued|claimed|launching → failed` (`packages/core/service/execution-requests.ts:887, 957, 1048`).
The plan needs three moves that do not exist:

| Plan | Where | Problem |
| --- | --- | --- |
| `queued → launching` | §8.2 Transaction A2 | No claim step. Either the adapter claims first (`claimed_by_execution_target_id` = the cloud target, no runner registration) or a new built-in transition is added |
| `launching → queued` | §8.3 `429` and `503` rows, "back to `queued`" | No such transition. Deferral needs an explicit adapter-only requeue, or the request stays `launching` and only the attempt row records the deferral |
| Insert directly as `launched` | §11.2 continuation requests | Bypasses `createExecutionRequest`; must still set `launch_completed_at` so the request looks launched to every reader |

Fix: add these to §13 Service / Vocabulary as adapter-scoped transitions, and say which fields
each one writes. Keeping deferrals in `launching` with attempt rows is simpler and avoids a new
`claimable` row that a notify could surface to local runners.

### 1.4 The connector and CLI hosts are probably wrong

§3 states the Overlord connector is `https://app.ovld.ai/mcp`; §5.2 step 3 and §9.2 allow the
domain `app.ovld.ai` for the CLI. In this repo the `/mcp` routes are served by the backend
(`backend/index.ts:605-608`), whose production domain is `backend.ovld.ai`
(`.railway/railway.ts:71`, `webapp/web/lib/backend-defaults.ts`). `app.ovld.ai` is the web
app. Unless the web app proxies `/mcp`, the connector URL is `https://backend.ovld.ai/mcp` and the
CLI must be allowed to reach `backend.ovld.ai`.

Separately, the CLI finds its backend only through `overlord.toml` or `OVERLORD_BACKEND_URL`, and
refuses to write `overlord.toml` inside a container (`cli/src/config.ts:224-231, 347`). The step 3
environment instructions install the CLI and set the allowed domain but never set the backend URL,
so every `ovld` call in the cloud session would target the default.

Fix: verify the connector URL against the deployed claude.ai connector, correct §3/§5.2/§9.2, and
add `OVERLORD_BACKEND_URL=https://backend.ovld.ai` to the step 3 environment variables (docs note
environment variables are visible to anyone using the environment; this one is not secret).

## 2. Should fix

### 2.1 Mission-shaped runs collide with existing multi-objective semantics

§8.2 step 5 creates mission-shaped missions "with every objective … all `draft`", and §11.2 says
intermediate deliveries keep the mission in `execute`. The existing code does the opposite:

- `createMission` puts only the first objective in `draft`; the rest are `future`
  (`packages/core/service/missions.ts:746`), and a requested `draft` is coerced to `future` when a
  draft already exists (`:422`).
- `launchObjective` accepts only `draft` / `submitted` / `launching`
  (`backend/execution/launch.ts:897`), so a `future` objective cannot receive a request without
  promotion.
- `deliverSession` (`packages/core/service/protocol.ts:2733-2800`) on **every** delivery: counts
  objectives in launching/executing/pending_delivery, and when zero calls `moveMissionToReview`
  and emits `mission_awaiting_review`; writes an `awaiting_approval` event for the next draft
  objective; and enqueues run-queue dispatch.

Fix: in §11.2 specify that objectives 2..n are created `future` (matching existing semantics),
that creating the continuation request promotes objective n+1 `future → launching` in the same
transaction, and that an intermediate cloud delivery suppresses `moveMissionToReview`,
`mission_awaiting_review`, the `awaiting_approval` event and the run-queue enqueue. Add the
promotion and the suppression to §13 Service.

### 2.2 A continuation that never attaches is reported as `failed`, not `partial`

§8.4 expires any `launched` request unattached for two hours and marks the run `failed`. For a
continuation request (objective n+1 after n was delivered) that contradicts §11.3, where a run
that "ends with undelivered objectives" is `partial` and gets Resume. Relaunch ("a replacement run
… for the same objective") is also undefined once earlier objectives are delivered.

Fix: continuation requests that expire unattached produce `partial`, with Resume. Relaunch is
offered only for runs with zero delivered objectives.

### 2.3 Phase 2 depends on Phase 3 machinery

§8.6 says verification "uses the same attempt and rate-limit machinery" and consumes launch
codes, grants and the watchdog deadline. §17 ships the wizard with Verify in Phase 2 but puts the
fire worker, durable attempts, rate limiting and watchdog in Phase 3.

Fix: move `claudeRoutineClient`, the one-fire attempt fencing (§8.2 A2/B), rate reservations
(§8.5) and the verify deadline into Phase 2 as the shared fire core, with verification as its
first consumer. Otherwise Phase 2 must ship with Verify disabled.

### 2.4 Quiet watchdog and "blocked" over hosted MCP

The hosted MCP tool set has no heartbeat and no ask tool (`packages/contract/src/mcp-tools.ts`;
the lifecycle tools are attach, update, deliver). §8.4 says "a later heartbeat can restore
`attached`", and the launcher prompt says "if you are blocked, report it as blocked and stop"
without saying how.

Fix: count `update` calls as liveness too; have the launcher prompt require a progress update at
least every 30 minutes during long work (60 minutes of silence marks the run `partial` and
notifies the owner, which a long test run would trigger); and state that "blocked" over MCP means
`overlord_update_session` with phase `blocked`.

### 2.5 CLI session-key cache is per working directory

`cli/src/session-key.ts` keys the cached session key by `{ missionId, workingDirectory,
objectiveId }`. In a multi-repo cloud session the agent changes directory between repos, so
`ovld protocol update` or `deliver` run from a second repo cannot resolve the key.

Fix: the cloud instructions (§12.4 and the launcher prompt) must pass `--session-key` explicitly
on every call, or the exchange must cache the key at a session-wide location for cloud runs.

### 2.6 MCP blast radius is acknowledged but not bounded

Hosted MCP exposes owner-RBAC destructive tools to the cloud session
(`overlord_delete_missions`, `overlord_delete_objectives`, `overlord_create_project`,
`overlord_manage_run_queue`, …). The session processes untrusted repository content in auto mode.
§14 notes "MCP sessions act as the run owner, with the owner's normal RBAC" and stops there; the
CLI channel gets a request-scoped token, the default channel gets nothing equivalent.

Fix (recommended): a run-bound tool policy. Once a hosted-MCP session attaches with a launch
code, restrict that MCP session to lifecycle tools on the bound mission (attach, update, deliver,
changes, add/update artifact, load context) until final delivery. If deferred, list it under §15
Known limitations rather than §14.

### 2.7 Health gating for direct launches and Run now is undefined

§5.3 skips *scheduled* runs on `needs_attention`. §8.2's direct-launch path has no health check,
and §12.1 lists the target "when the project has a healthy routine" without defining healthy.

Fix: reject direct launches and Run now with `routine_unhealthy` when health is
`needs_attention`; allow `unverified` and `repos_out_of_sync` with a warning; define "healthy"
in §12.1 as "not `needs_attention`".

### 2.8 Idempotency keys collide on Relaunch and Resume

`idempotency_key` is unique per workspace (`idx_execution_requests_workspace_idempotency`). §8.2
fixes the scheduled key as `cloud_job:<jobId>:<fireAtIso>`, so a Relaunch or Resume of that slot
cannot reuse it, and the plan gives those paths no key.

Fix: key every request by run, e.g. `cloud_run:<runId>:<objectiveId>`, with the slot uniqueness
living on `cloud_job_runs (cloud_job_id, fire_at)` as §7.2 already says.

### 2.9 Disconnect must follow the `account_connections` state CHECKs

The table forbids hard semantics the plan implies: `state = 'disconnected'` requires
`credential_ciphertext IS NULL` and `disconnected_at`, and `connected` requires a ciphertext.
§5.1 says Disconnect "deletes the binding and its sealed token".

Fix: specify `connected → disconnected` with the ciphertext scrubbed (the existing provider
pattern), the `project_claude_routines.deleted_at` soft delete that frees the `(project_id,
user_id)` slot, and that the connection row is retained for audit.

### 2.10 New notification kinds need the preferences CHECK and UI

`notification_preferences_type_check` enumerates the allowed types. The six kinds in §12.5 need
that CHECK extended in both dialects (SQLite rebuild) and the preferences UI updated. §13 lists
"event kinds" only.

Fix: add the CHECK change to §13 Database, or map the six events onto existing types where the
meaning matches (`mission_failed`, `mission_awaiting_review`) and add only the routine and job
kinds.

### 2.11 Routines created inside a claude.ai Project behave differently

The routines guide says a task created in a claude.ai Project can continue a thread instead of
starting a new session, keeps that thread's permission mode, and does not load repository
skills. The plan assumes each fire is a fresh session with a fresh clone.

Fix: step 3 should say to create the routine outside a claude.ai Project, and §15 should record
the assumption.

### 2.12 Failed pushes at delivery are ambiguous

§10 says a rejected push "blocks the objective", while §6.1 tells the agent to deliver and
"include the git report even when a push failed". If the agent delivers with `pushed: false` on a
changed repo, the objective completes, the sandbox ends and the work is lost.

Fix: a changed repo with `pushed: false` must be reported as blocked, not delivered. If a
delivery arrives with one anyway, record the run `partial` with `push_failed`, show it on the run
card, and skip PR creation.

### 2.13 Provider rejections after a `200`

The routines guide lists runs that never start after the fire succeeds: the organization's
concurrent cloud-session cap, an unavailable environment, missing or expired GitHub access
(skipped for up to 72 hours, then the task turns off), a missing branch, a usage limit. The
watchdog catches all of these as `launched_unattached`, but §5.2 and §8.4 only mention three
causes.

Fix: enumerate the causes in the `run_unattached` notification and add the 72-hour GitHub
disconnect to §15 (after it the routine is paused, which the fire reports as `400`).

### 2.14 `{date}` has no timezone for manual-only jobs

`cloud_jobs` has no timezone column; `schedules.timezone` exists only when the job is scheduled.

Fix: define the fallback (owner profile timezone, else UTC).

## 3. Editorial

- §5.2 step 1: `useCreateProjectResource` takes the project id and returns a mutation whose body
  is `CreateProjectResourceBody { sourceUrl, resourceKey, isPrimary, … }`
  (`webapp/web/lib/queries/projects.ts:235`), not `useCreateProjectResource({ sourceUrl, … })`.
- §4.1 / §12.1: say which resource becomes `resolved_resource_id` on a direct launch (the first
  checked routine resource, primary first) since eligibility only requires that *a* primary
  resource exists, not that it is GitHub-backed.
- §8.4: the "generic 15-minute sweep" is two TTLs: 15 minutes for launched-but-unattached and 10
  minutes for `launching` (`execution-requests.ts:45, 56`). Cloud requests sit in `launching` for
  the 30-second fire plus any deferral, so the `launching` exclusion matters as much as the
  `launched` one.
- §13 Database: the `account_connections` provider and format CHECK changes also need a SQLite
  table rebuild, as the 2026-10-05 migration did.

## 4. Verified as written

- §3 platform facts match the docs on 2026-10-26: endpoint, `anthropic-version: 2026-10-21`
  (any version from 2023-06-01 accepted, beta header optional), token prefix, 65,536-character
  text limit, `<routine-fire-payload>` wrapping, error table including `400` for a paused routine
  and `503 overloaded_error`, 30 fires/hour per routine shared with web Run now, 100 API fires/hour
  per account, no idempotency key, connectors routed through Anthropic's servers.
- `account_connections_scope_check` allows NULL `organization_id` for every provider except
  `knowledgebase`, and `idx_account_connections_profile_live` keys on `server_url`, so one row per
  routine per user is valid. The key ring falls back to the platform key for a provider with no
  dedicated env key (`backend/connections/keyring.ts:107`).
- `execution_request_grants` is hash-only with `expires_at`, `consumed_at`, `revoked_at`.
- `schedules` is workspace-scoped, so `cloud_jobs.schedule_id` can reference it directly.
- `enqueueWorkerJob` dedupes on one JSON field (`dedupeBy.field`).
- Protocol attach already accepts `--execution-request-id`, and `linkExecutionRequestToSession`
  already enforces `launching` / `launched` plus the single-link guard, as §9.3 assumes.
- `created_by_kind = 'automation'` is a closed-vocabulary value that fits verification runs.
