# ADR 0065: An answer is recorded, then delivered, and the two are reported separately

- Date: 2026-11-16
- Status: accepted
- Contract version: 173.6.0
- Supersedes: none (extends ADR 0025)
- Amended by: 0104

## Context

ADR 0025 delivers a person's answer to a blocking question through the execution target's runner
and Latch's v2 Conversation Hub (`sendLatchMessage`). The mechanism existed, but answers did not
reach agents (coo:1283). Inspection on 2026-11-16 found these causes:

1. **No answerable request was ever opened.** `ovld protocol ask` created an `agent_requests` row
   only when the session had a bound session channel. Launch stopped minting channels in contract
   76, and nothing else creates one, so every ask produced a feed event with no request. The
   production inbox read held no `question` or `choice` request at all.
2. **The runner looked for the wrong gateway.** Discovery knew only `latch serve` on its default
   port with `$LATCH_HOME/serve.token`. With Latch Remote Access enabled, Latch's own supervisor
   runs the gateway on an ephemeral loopback port with its own token and holds the single
   Conversation Hub lock, so a second gateway on the default port cannot carry conversations.
3. **Recording an answer was reported as delivering it.** The resolve call returned
   `resolved: true` whatever happened next, could block for two minutes, and wrote later outcomes
   without an entity change, so an open client never learned them.
4. **Failure had no recovery and some failures were misfiled.** A request with a failed answer
   stayed `resolved` with no way to send again. A job no runner claimed stayed queued without a
   limit and would have been delivered whenever the runner next came online. A job a runner
   claimed and never completed was recorded as not delivered, although it may have been sent.
   Latch's `queued` receipt (accepted, held behind the agent's current turn) was read as
   unconfirmed.

## Decision

1. **The ask opens the request.** When the asking session has no channel, `ovld protocol ask`
   creates a correlation-only channel for it (`launch_kind = 'protocol'`, state `online`, no
   credential, no lease). Nothing can authenticate as it and the lost-channel sweep never ends it.
   Launch still mints no channel and attach still needs none. Answerability is decided per read
   from the Latch session (`AgentRequestDto.delivery`), never from the channel.
2. **Four facts, reported separately.** `delivery.stage` is `recorded`, `queued`, `dispatched`,
   `confirmed`, `unconfirmed` or `failed`. `application_state` keeps its closed vocabulary
   (`emitted`, `applied`, `not_applied`, `unknown`); the stage, attempt number, failure code and
   message are additive. Clients must not show success because `resolved` is true.
3. **Bounded wait.** Resolve and redelivery wait about 25 seconds. A job still unclaimed is then
   withdrawn by compare-and-set on `queued` and reported `failed` / `not_dispatched`: nothing was
   or will be sent. A job a runner holds is reported `dispatched`; its outcome arrives through the
   completion hook. Every delivery carries a five-minute deadline the runner enforces before it
   contacts Latch.
4. **Outcome mapping.** Latch `accepted` or `queued` is `confirmed`. `refused`, an unreachable
   gateway, an absent session and a withdrawn job are `failed`: the answer did not reach the
   agent. Latch `ambiguous`, a lost socket after the send, and a claimed job that expired without
   a report are `unconfirmed`. Each change appends one `agent_request` entity change
   (`changedFields: ['application_state']`); `revision` does not move.
5. **Recovery after a definitive failure.** `POST /api/agent-requests/:id/redeliver` sends the
   recorded answer again under `session:attach`. The answer cannot be edited, no second `answer`
   event is written, and the request stays `resolved`. Each attempt has its own idempotency key
   (`<request id>` for the first, `<request id>.<n>` after), because the queue and Latch both
   answer a reused key with the first outcome. `expectedAttempt` is the compare-and-set token,
   and starting an attempt increments the request's `revision`.
6. **Reconciliation after an unconfirmed delivery, never a blind resend.** Overlord never resends
   on its own. A person must pass `confirmUnconfirmed: true` after checking the session. The
   runner then asks Latch for the earlier attempt's retained receipt (`operation_status`, a lookup
   that never dispatches). Delivered: nothing is sent and the delivery becomes `confirmed`. Still
   in flight: nothing is sent and it stays `unconfirmed`. Refused or no receipt retained: the new
   attempt is sent.
7. **Ended and lost (ADR 0064).** A session whose last observed state is `exited` never receives
   an answer: resolve and redeliver answer 409 `request_not_deliverable`. `lost` is missing
   contact, so an answer is still attempted when the target is reachable and Latch's reply
   decides. An offline target refuses before anything is recorded or started.
   `delivery.sessionState` exposes the state.
8. **Gateway discovery.** The runner offers the standalone gateway and the Remote Link
   supervisor's gateway (`$LATCH_HOME/remote-access/runtime/remote-link-gateway-ready.json` and
   `remote-link-gateway.token`) and uses the first that serves the conversation endpoint. Both are
   accepted only on loopback. The token stays on the execution target: it is never sent to the
   backend, a client, a queue row or a log. An explicit environment override remains the only
   candidate when set.

## Consequences

- Concurrent submissions cannot duplicate an answer: the resolve compare-and-set admits one
  resolver, the attempt compare-and-set admits one redelivery, and one attempt is one queue job
  and one Latch operation.
- A delivery that completes after the HTTP call returned is visible without a reload on clients
  that reload agent requests on the `agent_request` entity type.
- The Remote Link file names are Latch's runtime layout. Latch documents them as the local
  discovery seam (`docs/INTEGRATIONS.md`); a change there must change this discovery too.
- A runner older than this version ignores `notAfter` and `previousOperationId`. The deadline is
  then enforced only by the withdrawal of unclaimed jobs, and a confirmed redelivery of an
  unconfirmed answer is sent without the receipt check.
- Supported harnesses are those with a Latch conversation connector that accepts `send_message`:
  Claude Code, Codex and Cursor. Other harnesses are refused by Latch and reported `failed`.
- No database migration. `agent_requests.details_json.delivery` holds
  `{ attempt, failureCode, failureMessage }`.

## Alternatives considered

- Making `agent_requests.channel_id` nullable: rejected. `AgentRequestDto.channelId` is a required
  string that shipped clients decode, so it would be a breaking change.
- Minting a credentialed channel at launch again: rejected. It restores a credential and a lease
  that nothing uses, and the lease sweep would close questions of a healthy session.
- Reopening the request after a failed delivery: rejected. The `answer` event, the
  `mission.unblocked` webhook and the session phase would have to be undone or repeated.
- Resending an unconfirmed answer automatically with the same operation id: rejected. Latch
  replays the first outcome only while it retains the receipt; after that the same id is new.
- A new runner capability for the receipt lookup: rejected. The allowlist is closed, and an
  optional input on `sendLatchMessage` keeps older runners working.
