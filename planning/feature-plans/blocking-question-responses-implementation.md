# Blocking Question Responses — Implementation Plan (coo:833)

**Status:** ready to execute. Supersedes the "ask blocks and polls" design in
[blocking-question-responses.md](./blocking-question-responses.md) §3; that document's gap
analysis (§1) and option table (§2) still stand. **Contract:** 128 → propose 129.

## 0. Decisions

1. **Latch v2 is the injection path.** Latch's Conversation Hub
   (`Latch/schemas/remote-access/v2/conversation-protocol.schema.json`) exposes
   `WS /v2/sessions/{id}/conversation` with a client op
   `send_message { operationEpoch, operationId, text }` answered by
   `operation_result { status: accepted | refused | ambiguous }`, and a server-first state
   carrying `phase` (`starting|idle|working|awaiting_input|exited|unavailable`) plus
   `sendMessage { enabled, reason }`. An answer is delivered as a user turn — exactly how the
   harness expects input. Overlord builds no hook/inject path of its own.
2. **Answerable iff the session runs under Latch.** A blocking question whose session has a
   live Latch provider session gets the input form; any other session (manual attach, target
   without Latch, Latch session exited/lost) renders the question **read-only**. No polling
   fallback, no "recorded for later" queue. The agent-side skill stays "ask and stop".
3. **One write path, one transport, one local function.** Surfaces call
   `POST /api/agent-requests/:id/resolve`; the backend records the resolution and calls the
   `sendLatchMessage` capability through the local-target registry, which `RunnerQueueProvider`
   (Phase B) carries to the execution target that launched the session; the runner executes it
   with one local function that speaks to Latch on loopback and reports the outcome.

Corrections carried over from the previous draft that still apply: the human resolve/release
routes are retired to 410 `session_controls_gone` (`backend/agent-session-routes.ts:661-678`)
and must be re-enabled for question kinds; `AgentSessionActivity.tsx` is not mounted.

## 1. Data model (no new tables)

- `agent_requests` already carries `kind`, `summary`, `options_json`, `allows_free_text`,
  `revision`, `resolution_json`, `application_state` (`emitted|applied|not_applied|unknown`,
  requests.ts L60) and `application_observed_at`. Application state is reused verbatim as the
  delivery state: `emitted` when the capability call is queued, `applied` on Latch `accepted`,
  `not_applied` on `refused`/no-Latch, `unknown` on `ambiguous`.
- Session → Latch mapping already exists: the execution request records
  `providerSession.providerSessionId` when the runner launches under Latch
  (`packages/core/service/execution-requests.ts:998-1005`, `latch-launch.ts:198`), and
  `agent_sessions` links to its execution request/channel. Add a read helper
  `resolveLatchSessionForAgentSession({ ctx, sessionId })` → `{ targetId, providerSessionId } |
  null`. Nothing new is stored.
- `mission_events` gains type `'answer'` (additive).

## 2. Phase A — backend/core (est. 1.5 d)

**Files:** `packages/core/service/protocol.ts` (`askQuestion`, ~L2003),
`packages/core/service/agent-session/{requests,channels}.ts`,
`packages/core/service/execution-requests.ts`, `backend/agent-session-routes.ts`,
`backend/activity-feed.ts`, `packages/contract/src/index.ts`, `CONTRACT.md`.

1. **`askQuestion` creates the request.** Inside its transaction, after the `mission_events`
   insert: `getChannelForSession(sessionId)` (new; `bindChannelToSession` writes `session_id`
   at attach, channels.ts L300-341). If a channel exists → `createRequest({ kind, summary,
   options, allowsFreeText: true, sourceEventId: eventId, windowExpiresAt: null, details: {
   missionEventId } })`; write `{ agentRequestId }` into the event's `payload_json`. `kind` is
   `choice` only when `--no-free-text` and options are given. No channel → event only, as today.
   New CLI flags on `ask`: `--options-json` / `--options-file -`, `--no-free-text`, `--json`
   (`backend/protocol.ts:1074`, `cli/src/flag-registry.ts`, `protocol-help.ts`). Skill text
   unchanged.
2. **`AgentRequestDto.delivery`** (additive): `{ mode: 'latch' | 'read_only', reason: string |
   null, state: ApplicationState | null, observedAt }`. Computed in the human `GET
   /api/agent-requests` projection from `resolveLatchSessionForAgentSession` +
   `application_state`. `read_only` reasons: `no_latch_session`, `latch_session_exited`,
   `target_offline` (runner heartbeat stale), `request_closed`. This one field is what every
   card keys its form on — the client never re-derives Latch-ness.
3. **Re-enable `POST /:id/resolve`** for `kind ∈ {question, choice}` (restore the pre-v108
   handler from git history; keep `session_controls_gone` for `permission`/`retry`). Add the
   guard: refuse with 409 `request_not_deliverable` when `delivery.mode !== 'latch'` — the
   read-only rule is enforced server-side, not just hidden in the UI. Validation: `{ text }`
   needs `allows_free_text`; `{ optionId }` must be in `options_json`; both allowed. Leave
   `/:id/release` retired (a Latch-delivered question has no native prompt to release to).
4. **`resolveRequest` side effects** for question kinds, same transaction: `mission_events`
   `type='answer', phase='execute'` (summary = text or option label, payload `{ agentRequestId,
   optionId?, missionEventId }`); `agent_sessions.phase = 'execute'`; clear the
   `blocking_question` seen-marker; `enqueueWebhookEvent('mission.unblocked')`; set
   `application_state = 'emitted'`; then call `provider.sendLatchMessage(...)` via the registry (§3.6); a `LOCAL_TARGET_TIMEOUT` leaves the row `emitted` until the runner's completion lands.
5. **Delivery report-back.** No new route: the runner's `POST /api/runner/requests/:id/completed`
   already carries the `CapabilityResult`; `completeLocalTargetMutationRequest` gains a small
   post-hook that, for `capability === 'sendLatchMessage'`, calls
   `recordRequestApplication({ state, observedAt })` (requests.ts L471, exists) on the linked
   `agent_requests` row (id carried in the job input).
6. **Feed projection.** `toQuestionItem` (`activity-feed.ts:611`) adds `agentRequestId` and
   `delivery.mode`; `has_unseen_blocking_question` (`repository.ts:3683`) excludes asks with a
   later `answer` event for the same `agentRequestId`.
7. **Contract 129:** `ask` opens an `agent_requests` row; `AgentRequestDto.delivery`;
   `ActivityFeedQuestionItemDto.agentRequestId`/`delivery`; event `answer`; webhook
   `mission.unblocked`; human resolve restored for question kinds with the deliverability
   guard. Run `component-contract` first (Phase B carries its own contract items).
8. **Tests:** `agent-session.test.ts` (ask → request; resolve → answer event + phase + job
   enqueued; CAS conflict; read-only 409), `agent-session-routes.test.ts` (resolve 200
   question / 410 permission / 409 read-only), `activity-feed.test.ts`, `webhook-events.test.ts`.

## 3. Phase B — finish `RunnerQueueProvider` (est. 2 d)

`RunnerQueueProvider` (`packages/core/service/local-target/runner-queue-provider.ts`) is the
transport the registry picks for any reachable local target that is not the caller's own
device (`default-registry.ts:20-47`), and today it fails every capability with
`LOCAL_TARGET_UNREACHABLE`. The plumbing it needs already exists for two capabilities:

- **Queue:** `createLocalTargetMutationRequest` (`local-target-mutations.ts:121`) writes an
  `execution_requests` row with `requested_source='local_target_mutation'` and metadata
  `{ kind, capability, input }`; Postgres `NOTIFY` wakes the runner long-poll
  (`backend/execution/runner-queue-notify.ts`).
- **Runner:** `ovld runner once` claims via `POST /api/runner/claim`, detects the metadata
  (`cli/src/commands.ts:2066`), runs `executeLocalTargetMutation` on an `InProcessProvider`
  (`local-target-mutation-runner.ts`), and posts the `CapabilityResult` envelope to
  `POST /api/runner/requests/:id/completed` (`backend/execution/runner.ts:383`).
- **Store:** `completeLocalTargetMutationRequest` (`local-target-mutations.ts:204`) validates and
  persists the result on the request row.

Phase B generalises that path so every `LocalTargetCapabilities` method — and the new
`sendLatchMessage` — works off-device, then implements `RunnerQueueProvider` on top.

1. **Generic executor.** Replace the `switch (mutation.capability)` in
   `local-target-mutation-runner.ts` with dispatch over `CapabilityName` (`types.ts:413`):
   `provider[capability](input)`. Keep the existing `performBranchAction` worktree-path
   re-derivation as a per-capability pre-hook rather than a special case. Widen
   `LocalTargetMutationCapability` to `CapabilityName` and `LocalTargetMutationKind` to include
   `'capability_call'` for the generic case (existing `branch_action`/`worktree_purge` kinds
   stay for their activity-feed events).
2. **Non-mission jobs.** `execution_requests.mission_id`/`objective_id` are NOT NULL and
   `createLocalTargetMutationRequest` resolves an objective from the mission. Capability calls
   like `discoverLatch`, `readRepositoryTree`, `doctor` have no mission. Make both columns
   nullable for `requested_source='local_target_mutation'` (migration in both dialects, generated
   types via `kysely-codegen` skill); scope authorization by `project_id` + `execution_target_id`.
   Answer delivery *does* have a mission, so it is unaffected either way.
3. **Result await.** Add `waitForLocalTargetMutationResult({ ctx, requestId, timeoutMs })` in
   `local-target-mutations.ts`: poll the row (Postgres: LISTEN on a completion channel mirroring
   the claim notify; SQLite: bounded poll) until `status ∈ {completed, failed}` or timeout, and
   return the stored `CapabilityResult`. Timeout returns
   `fail('LOCAL_TARGET_TIMEOUT', …)` with the request id so callers can show "still running".
4. **`RunnerQueueProvider` proper.** Each capability method = `queue` (step B.0 helper, with
   `executionTargetId` from `target.executionTargetId`, idempotency key from a caller-supplied
   `operationId` when present) → `wait` (step 3) → return the envelope with
   `transport: 'runner_queue'`. Read-only calls default to a short timeout (10 s); mutations and
   `sendLatchMessage` accept a longer one via input. Remove the `UnavailableProvider` base.
5. **Runner-side rate/allowlist.** The runner executes only `CapabilityName` members; unknown
   names fail closed with `LOCAL_TARGET_UNSUPPORTED`. `launchAgent` stays on its dedicated
   launch path — exclude it from the generic dispatch so the two never race for one request.
6. **Backend wiring.** Backend callers that today special-case "co-located only"
   (`/api/missions/:id/branch/action` comment at `backend/index.ts:2280`, `resolveRemoteMutationTarget`
   in `local-target-mutation-queue.ts`) switch to `registry.resolveOrUnavailable(target)` and stop
   branching on transport. Answer delivery (Phase A.4) is then just
   `provider.sendLatchMessage({ providerSessionId, operationId: requestId, text })` followed by
   `recordRequestApplication` with the mapped state — no bespoke job kind.
7. **Contract:** new capability `sendLatchMessage`; `RunnerQueueProvider` promoted from stub
   (`LOCAL_TARGET_UNREACHABLE` no longer returned for reachable targets); nullable
   mission/objective on mutation requests; `LOCAL_TARGET_TIMEOUT` error code; completed route
   accepts any `CapabilityName`. Update `execution-target-identity.md` §"How we reach it".
8. **Tests:** `registry.test.ts` (resolves to a working provider), a round-trip test with a fake
   runner (`runner-claim-http.test.ts` pattern) for a read capability and for `sendLatchMessage`,
   migration test for nullable columns, timeout path, unknown-capability fail-closed.

Delivery order inside B: 1 → 3 → 4 first (mission-scoped calls work end to end, unblocking
Phase A.4), then 2 and 6.

## 4. Phase C — the local function (est. 1 d)

**Files:** `packages/core/service/latch-session.ts` (beside `inspectLatchSession`),
`packages/core/service/local-target/types.ts` + `in-process-provider.ts` +
`desktop-bridge.ts` (register `sendLatchMessage` for dev/in-process parity), `cli/src`.

`sendLatchMessage({ providerSessionId, operationId, text, waitForIdleMs = 30_000 })`:

1. Discover the gateway (`latch-discovery.ts` → `endpoints.conversation === true` required;
   contract `SUPPORTED_LATCH_PROTOCOL_VERSION` = 2).
2. Open `WS /v2/sessions/{providerSessionId}/conversation` on loopback with the gateway
   bearer; read the initial `snapshot` for `operationEpoch` and `state`.
3. If `state.sendMessage.enabled` → send `send_message`; await `operation_result` for
   `operationId`; return `{ status }`. If not enabled and `phase ∈ {starting, working}`, wait up
   to `waitForIdleMs` for a `state_changed` that enables it, then send; otherwise return
   `refused` with `state.sendMessage.reason`. `exited|unavailable` → `refused`.
4. Result maps to application state: `accepted→applied`, `refused→not_applied`,
   `ambiguous→unknown`. Never resend on `ambiguous`.
5. **Open dependency (Latch side):** confirm the grant `send_message` requires and that a local
   Overlord process holds it without taking the exclusive terminal attach
   (`ARCHITECTURE_RULES.md` "Conversation Hub is schema-first", `DECISION_EXCLUSIVE_ATTACH.md`).
   Verify against a fixture recorded from a real gateway before flipping any capability status.
6. **Tests:** fake WS gateway fixture covering idle/working→idle/exited/ambiguous; source guard
   that the client dials loopback only.

## 5. Phase D — UI (web 1 d, iOS 0.5 d)

**Web:** `agent-session/{AgentSessionActivity,BlockingQuestionCard,StructuredChoiceCard,
AgentSessionCardShell}.tsx`, `activity-feed/BlockingQuestionCard.tsx`, `LiveActivityFeed.tsx`,
`lib/{queries,api}.ts`, mission detail page.

1. Extract `QuestionAnswerForm` from the panel card (text input, option buttons, CAS/lost-race,
   error line). Render it **only when `request.delivery.mode === 'latch'`**; otherwise render the
   question read-only with a one-line reason ("This session isn't running in Latch — answer in
   the agent's terminal"). Remove "Respond in terminal" for question kinds; drop the countdown
   badge when `windowExpiresAt` is null.
2. After submit show delivery state from `delivery.state`: `emitted` "Sending to the agent…",
   `applied` "Delivered", `not_applied`/`unknown` with the reason. Poll/invalidate
   `keys.missionAgentRequests` plus feed and mission-status queries.
3. Mount `AgentSessionActivity` (questions/choices only) on mission detail, objective-scoped
   via `GET /api/agent-requests?objectiveId=`.
4. Feed + live feed: when `item.agentRequestId` is present, embed the same form/read-only
   block instead of the "Answer → open panel" button; render `answer` events as a resolved line.
5. **iOS (OverlordMobile, separate delivery):** `AgentSession/BlockingQuestionCard.swift`
   gains the same `delivery.mode` gate and state line; `Lib/MissionChatFeed.swift` links
   `agentRequestId`; push deep link lands on the card; `conformance-manifest.yaml` → 129.
6. **Tests:** `activity-feed-model.test.ts`, `missionCardState.test.ts` (blocked → executing
   after `answer`), form component tests (latch vs read_only, option vs text, 409 conflict).

## 6. Order, sizing, risks

| Phase | Est. | Depends on | Risk / note |
| --- | --- | --- | --- |
| A backend/core | 1.5 d | — | Reverses part of v108: cite the Latch-v2 rationale in the contract entry; permissions stay native. |
| B RunnerQueueProvider | 2 d | — | Generalises the existing mutation queue; unblocks all 17 capabilities for hosted/remote targets, not just delivery. Nullable mission columns need a two-dialect migration. |
| C local function | 1 d | Latch grant answer (§4.5) | Timing: agent still `working` after `ask` → bounded wait then `refused`; UI must show it. |
| D web + iOS | 1.5 d | A (can stub `delivery`) | Panel was unmounted at coo:815 — check its notes before re-mounting. |

~6 days total; B and C are independent, D-web can start against A's DTO. Suggested Overlord objectives: one per row,
`autoAdvance` B → A (A.4 needs B.4); C and D-web may start immediately.

Explicitly out of scope: any non-Latch delivery, permission prompts via `resolve_request`
(same function, later), Latch sessions on targets without a registered runner.
