# ADR 0094: Answer control-plane requests from Overlord; approvals only by the session owner

Date: 2026-11-20
Status: accepted
Contract version: [179.10.0](../CHANGELOG.md#179100---2026-11-20)
Supersedes: none (amends ADR 0065 for requests on control-plane channels)
Contract impact: minor

## Context

ADR 0065 made Overlord's answer to an agent question a two-step fact: the answer is recorded,
then delivered by typing it into the agent's Latch session. Permission requests could not be
answered from Overlord at all (`410 session_controls_gone`): hook adapters hold no decision, so a
permission prompt stays with the harness.

ADR 0091 and 0092 added a different kind of session. A Codex objective in app-server mode is
driven by a supervisor that holds a credentialed `control_plane` channel, opens a card for each
Codex approval or question, and waits on the card with a waiter lease. Codex holds the approval
until some client answers it. The supervisor could already apply an answer it read back through
its lease, but no human route could record one, so web and mobile showed nothing actionable and
the only place to answer was the attached Codex TUI. Routing a question answer through Latch
would also have typed it into that TUI as well as answering the JSON-RPC request.

Two security facts shape who may answer. Answering a command or patch approval runs code on the
machine of the member who launched the session. And `session:attach`, the resolve route's
permission, is held by every default role (`MEMBER` grants `session:*`), so permission alone would
let any workspace member approve commands on a colleague's machine.

## Decision

1. **A delivery mode for control-plane requests.** A request on a `launch_kind = 'control_plane'`
   channel projects `delivery.mode = 'control_plane'` while it is open and the channel is live
   (`preparing`, `online`, `degraded`). Otherwise it is `read_only` with `request_closed` or the
   new `channel_ended`. Every other request keeps the ADR 0065 projection.
2. **Recorded here, applied by the supervisor.** `POST /api/agent-requests/{id}/resolve` records an
   answer to a control-plane `question`, `choice` or `permission` with no Latch delivery. The
   supervisor reads the resolution through its waiter lease and answers the harness, then records
   the request's application. `delivery.stage` is `recorded` until that observation, then
   `confirmed` (`emitted` or `applied`), `failed` (`not_applied`) or `unconfirmed` (`unknown`).
   `/redeliver` refuses every control-plane request: there is no Latch attempt to repeat.
3. **Approvals are owner-only.** A `permission` request on a control-plane channel may be answered
   only by the member who created the channel (`created_by_workspace_user_id`, the launching
   member). Anyone else sees it `read_only` with the new reason `not_session_owner`, and resolve
   answers `403 not_session_owner`. Questions and choices keep the workspace-wide rule.
4. **Only the card's own options.** A permission answer is exactly `{ optionId }` (web, mobile) or
   `{ decision }` (`ovld requests resolve --decision allow|deny`) naming one of the request's options
   (`allow`, `deny`), stored as `{ optionId }`: no text and no other fields, so no client can smuggle a
   standing grant (`400 invalid_resolution`). The supervisor still maps `allow` to `accept` and
   never sends `acceptForSession` or policy amendments.
5. **Inputs stay closed.** `POST /api/agent-session-inputs` still answers 410 for every channel. A
   follow-up, steer or interrupt is typed in the attached TUI.

## Consequences

- The web app renders an open approval as a blocking card with Allow once / Deny, and after an
  answer shows the recorded decision and whether the supervisor applied it. A non-owner sees the
  card read-only with the reason. Verified live on Codex 0.171.0 (coo:1325.tg2w): command and patch
  approvals answered from the web app while the Codex TUI was attached.
- The `question-answer-double-delivery` hazard of the `codex-app-server` adapter is closed: a
  control-plane answer is never typed into a terminal.
- A person at the attached TUI and a person in Overlord can both answer; Codex takes the first
  answer and the supervisor closes the other card as resolved elsewhere (ADR 0091).
- Mobile renders cards from the same DTO; it shows an approval answerable only once it handles the
  `control_plane` mode, and until then treats it as read-only.
- Same-user processes, including commands the agent itself runs, can still reach the owner's
  `ovld` login on disk. That boundary is the person's own OS account and is documented as an
  accepted hazard (`same-user-agent-reaches-credentials`).
