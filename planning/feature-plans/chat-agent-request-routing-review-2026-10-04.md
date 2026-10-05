# Chat assistant plan review — coo:1108.h3fs

Reviewed 2026-10-04 against the current 496-line
[plan](chat-agent-request-routing.md), contract version 151, repository code,
the mobile push consumer, and Google's current Gemini documentation.

The direction is sound. Gemini first, explicit client-side Create, a separate
private event stream, and a shared mobile stream client resolve the largest
earlier concerns. Five refinements remain. Phase A can proceed, but the first
three should inform the schema and adapter contract before Phase B is finalized.
The architecture plan itself was not edited.

## 1. High — notifications need a conversation subject, not just two catalog entries

**Plan:** sections 5.3, 10, 12, and Phase E; especially lines 163–170 and 382–383.

The milestone requires notifications during research, before any mission exists.
The current notification pipeline cannot represent that subject:

- `packages/core/service/notifications/notifications.ts:20` requires workspace
  and mission IDs and derives the recipient from the mission's assigned owner.
- `database/sqlite/migrations/20260809120000_notifications.sql:6` requires both
  references; the Postgres migration has the same constraint.
- `backend/push-notification-dispatcher.ts:46` rejects jobs without a mission ID,
  and its presentation/payload is mission/objective-specific.

Adding two catalog types alone therefore cannot deliver this journey. It also
needs a decision about notification history, unread counts, routing, and how an
organization-scoped conversation reaches a currently workspace-scoped job path.

**Refine:** define an owner-addressed conversation notification subject and its
durable dispatch path. Reuse device registration, APNs transport, and preferences;
explicitly extend or adapt storage, recipient resolution, presentation, and mobile
deep links. Do not manufacture a mission or select an arbitrary workspace. Include
these changes in the Phase A contract/schema work, even if the UI lands in Phase E.

**Acceptance:** a new thread with no missions sends an answer-needed notification,
then a completion notification, to its owner; a cold-start tap opens that thread.

## 2. High — normalized events do not specify enough state to restart a Gemini tool loop

**Plan:** sections 5.1–5.4 and 10; lines 120–131, 177–179, and 310–312.

The plan promises provider-independent durable state and recovery from normalized
messages, evidence, and tool receipts. It does not choose the Gemini API or define
a provider checkpoint. The existing integration uses `models.generateContent`
(`automations/src/title-summarizer/gemini-client.ts:48`). For that API, Gemini 3
function-call continuation requires retaining the original thought signatures and
part structure; missing required signatures causes a 400. An in-memory SDK history
does not survive a worker restart. [Google: thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).

Google's streaming Interactions examples instead continue with an interaction ID
and a function-call ID. Adopting that path also needs an explicit reconciliation
with the plan's no-provider-storage-dependency requirement.
[Google: streaming interactions](https://ai.google.dev/gemini-api/docs/streaming).

**Refine:** choose the API in Phase A and define adapter-owned durable checkpoint
data, separate from user-visible events. Preserve the metadata required by that
API, or deliberately start a fresh generation from authorized observations rather
than replaying an incomplete provider turn. Specify which recovery path is used.

**Acceptance:** restart the backend after a real Gemini function call and tool
result, then successfully continue with sequential and parallel tool calls. A fake
runtime test alone cannot prove this boundary.

## 3. High — revocation must cover derived text and event replay

**Plan:** sections 8–10; lines 258–263, 287–290, and 337–340.

Rechecking an evidence reference does not remove facts already copied into an
assistant message, thread summary, tool receipt, proposal, or persisted event.
For example, a user researches project A, loses access, and later resumes the
thread or creates an existing proposal in project B. The listed Create checks
validate destination permissions and assignments but do not explicitly validate
the proposal's source dependencies. The private stream being owner-scoped does
not itself enforce changing source access.

**Refine:** define source-dependency tracking for derived content. Before provider
input, snapshots, event replay, and Create, reauthorize the relevant source set.
For the prototype, conservative invalidation of an entire affected block, summary,
or proposal is sufficient; exact sentence-level redaction is unnecessary. Define
how Knowledgebase revocation is detected and fail closed when current source
authorization cannot be established. A live attempt using revoked context also
needs an invalidation rule.

**Acceptance:** revoke access after research but before replay and Create. Neither
path exposes the cached restricted text or publishes it to another project, and
the next provider request excludes it. This is about future server reads and
writes; it cannot retract content already shown to a user.

## 4. Medium — an open stream is not proof that the user saw a notification

**Plan:** section 5.3, lines 168–170, and the push acceptance test in section 14.

The suppression rule is based on the owner receiving the thread's stream. When a
phone backgrounds or loses connectivity, the backend may still have an apparently
open socket when the run completes. A stream in an unfocused web tab has the same
problem. Suppressing the push at that moment can lose the only alert, contrary to
the background-phone acceptance criterion. Socket liveness alone cannot implement
the promised distinction.

**Refine:** use explicit foreground-thread presence with expiry and an acknowledged
event cursor, and retain a durable notification candidate until the relevant event
is acknowledged or a grace period expires. Specify multi-device suppression and
dedupe by run/question transition, so a later question is not collapsed as a retry
of an earlier one. Recheck that a queued question is still unanswered at dispatch.

**Acceptance:** background or disconnect immediately before completion while the
server socket remains open; the owner still receives one notification. An active
client that acknowledges the event suppresses it.

## 5. Medium — leaving the agent unassigned conflicts with the reused create service

**Plan:** section 9.2, lines 280–283, and the service-reuse promise in section 9.3.

The plan permits an unjustified agent assignment to remain empty. In
`packages/core/service/missions.ts:428–439`, both an omitted agent and an explicit
null select the project's saved launch preference for draft/future objectives.
The unchanged service can therefore persist an agent/model that the proposal
showed as unassigned. The same drift can occur if the preference changes between
proposal preparation and Create.

**Refine:** distinguish human ownership from agent assignment. Either resolve and
show the concrete project default in the versioned proposal, asking when no
justified selection exists, or add a supported explicit-unassigned policy to the
creation service and its contract. Validate the persisted assignment against the
confirmed revision. Passing null does not currently request that policy.

**Acceptance:** use a project with saved agent/model preferences and a proposal
without an agent. Creation must match the displayed decision, including after the
preference changes.

## Checks that do not require another architecture change

- The cross-workspace transaction wrapper is plausible: the database adapter
  supports ambient transactions and nested savepoints. Existing conformance tests
  cover these primitives (`database/src/client.postgres-conformance.test.ts:133`).
  Keep the plan's composed rollback and concurrent-Create tests; this review did
  not execute the proposed wrapper.
- The diff declaration is correctly described as unimplemented. The concrete
  reusable collection code is `local-target/commit-message-diff-git.ts`, used by
  commit-message generation. Its existing `git-run.ts` subprocess helpers are not
  yet the bounded, cancellable, filtered inspection promised by the plan; reuse
  must include the planned hardening.
- Google's current model page confirms the stable identifier
  `gemini-3.8-flash` and function-calling support. Phase A still needs a live call
  using the deployment's credentials and installed SDK.
  [Google: Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
- The private event-channel exception is identified in the proposal. Its wording
  that it “is recorded” in the contract should become “will be recorded”: the
  current contract and backend guide have not adopted that exception yet.

## Validation limits

This was an architecture and source review. No product code, contract, or original
plan was changed. No provider request, Knowledgebase authorization, database test,
or physical-phone test was run. The findings identify decisions and coverage to
add to implementation; they do not claim the proposed feature was exercised.
