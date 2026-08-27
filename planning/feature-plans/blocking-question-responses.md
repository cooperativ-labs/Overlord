# Blocking Question Responses (coo:833)

**Status:** design. Superseded in §3 by [blocking-question-responses-implementation.md](./blocking-question-responses-implementation.md), which adopts Latch v2 `send_message` as the sole injection path (option D) and makes non-Latch sessions read-only; §1-2 remain the gap analysis and option survey.
**Contract reviewed:** `CONTRACT.md` version 128.
**Builds on:** [agent-interaction-acp.md](./agent-interaction-acp.md),
[agent-session-module.md](./agent-session-module.md), `connectors/HARNESS-MATRIX.md`.

## 1. The gap, precisely

Two independent "question" systems exist today and they are not connected:

| Path | Writes | Rendered by | Answerable? |
| --- | --- | --- | --- |
| `ovld protocol ask` → `askQuestion()` (`packages/core/service/protocol.ts:2003`) | `mission_events` row `type='ask', phase='blocked'` + `mission.blocked` webhook + `agent_question` notification | `activity-feed/BlockingQuestionCard.tsx` (feed), `LiveActivityFeed.tsx`, mission status `blocking_question`, iOS `MissionChatFeed` | **No.** The feed card's "Answer" button only opens the mission panel. There is nothing there to answer. |
| Agent Session Exchange `POST /api/agent-session-channels/v1/requests` (`kind='question'`) | `agent_requests` row with options, `allowsFreeText`, revision, waiter lease, window | `agent-session/BlockingQuestionCard.tsx`, `StructuredChoiceCard.tsx` (web) and `AgentSession/BlockingQuestionCard.swift` (iOS) via `useResolveAgentRequest` → `POST /api/agent-requests/:id/resolve` | **Yes** — full input form, option buttons, CAS on revision, "Respond in terminal" release, lost-race handling. |

Nothing ever creates an `agent_requests` row of kind `question`: `cli/src/agent-session/request.ts` only decodes `kind: 'permission'` from harness hook payloads. So the answerable card (already built for web and iOS) is dead code for the `ask` use case, and the `ask` use case has no input surface.

Second half of the gap — **injection**. After `ovld protocol ask` returns, the skill tells the agent to *stop*. The harness turn ends, the process sits idle at its native prompt. Every live inject path in the matrix (`inject.midTurn`/`turnBoundary`/`nextTurn`) is hook-driven, i.e. it can only run *while the harness is calling us*. An idle harness never calls a hook, so even a perfectly recorded answer has no delivery vehicle. The capability descriptors for Claude/Codex/Pi explicitly park session-input injection on `latch-engine` ("must be a native Latch v2 Conversation Hub client"), and contract v108 retired `latch send`. Cursor's `followup_message` and OpenCode's `prompt_async` are the only fixture-proven inject paths, and Cursor's fires only from its `stop` hook.

## 2. Options for injecting the answer

| # | Mechanism | Works when harness is… | Connectors | Verdict |
| --- | --- | --- | --- | --- |
| A | **`ask` blocks and returns the answer on stdout** (the ask command *is* the waiter: creates the `agent_requests` row, holds the lease, long-polls, prints the resolution as the tool result) | mid-turn, inside the `ovld` tool call | **All six** — a shell tool call is the one thing every harness has | **Recommended primary.** Harness-agnostic, zero hook work, answer lands as a tool result the model reads immediately. Same pattern as `request.ts` already uses for permissions. |
| B | Stop-hook long-poll (`Stop` returns `decision:block` / Cursor `followup_message` with the answer) | at the turn boundary right after ask | Claude, Cursor, Codex(Stop) | Only extends A by one hook timeout (~60 s default). Not a delivery path for answers that arrive minutes later. Skip. |
| C | OpenCode `prompt_async` via the sidecar (`cli/src/agent-session/sidecar.ts`, `inbox.ts` `injectViaPromptAsync`) | idle **or** mid-turn | OpenCode only | Already fixture-proven. Use as the idle-fallback for OpenCode by routing the resolution through `session_inputs` → sidecar. |
| D | Latch v2 Conversation Hub (persistent terminal owns the pty; write the answer as a user turn) | idle | any harness launched under Latch | The contract's designated long-term answer for idle sessions, but requires building a native v2 hub client (WebSocket, revisioned). Out of scope here; note as phase 3. |
| E | Headless resume (`claude -p --resume <native_id> "<answer>"`, `codex exec resume`, `cursor-agent --resume`) using `native-session.ts` `externalSessionId` | idle | Claude, Codex, Cursor | Spawns a second process on the same session while the interactive one may still be open — races the terminal and Overlord's session-key binding. Reject. |
| F | pty keystroke injection (osascript / tmux send-keys) | idle | terminal-launched | Scraping-class hack, forbidden by agent-interaction-acp §1.3. Reject. |

**Decision:** A, with C as the OpenCode-specific idle fallback and D as the eventual idle path for callback harnesses. A also converts the "blocked" state from a dead end into a first-class exchange request, which is what the ACP plan intended (`agent_requests.kind='question'` exists for exactly this).

Why A is safe despite blocking a tool call: `request.ts` already proves the pattern — the waiter renews a lease; if the process dies, the server releases the request to the terminal on its own. The one new problem is *duration*: a human may take hours, and shell tools have timeouts (Claude Bash max 10 min, Codex/Cursor similar). Handle it with a resumable wait rather than an indefinite one (§3.2).

## 3. Design

### 3.1 `ask` creates an answerable request (backend + core)

`askQuestion()` keeps everything it does today (mission event, webhook, notification, blocking status) and additionally creates an `agent_requests` row through `createRequest()` in `packages/core/service/agent-session/requests.ts`:

- `kind='question'`, `summary=question`, `allowsFreeText=true`, `options` from a new optional `--options-json '[{"optionId":"a","label":"…"}]'` flag (`kind='choice'` when free text is explicitly disabled with `--no-free-text` and options are given).
- `windowExpiresAt=null` (a blocking question has no harness deadline — unlike permissions there is no native prompt waiting to take over).
- The `mission_events` row's `payload_json` records `{ agentRequestId }` so feed/mobile cards can deep-link to the answerable card, and the request's `details_json` records `{ missionEventId }` the other way.
- Precondition: the protocol session must have a bound channel (`agent_sessions.channel_id`). Overlord-launched sessions always do (runner exports `OVERLORD_SESSION_CHANNEL_*`). For manual sessions without a channel, `ask` falls back to today's behavior and prints a warning that the answer cannot be delivered automatically.

Authorization stays as is: humans resolve via the existing `POST /api/agent-requests/:id/resolve` with resource-derived RBAC; the adapter never resolves.

Resolution of a `question` must also close the blocked state: `resolveRequest()` for `kind='question'` appends a `mission_events` row `type='answer'` (summary = answer text / chosen label, payload `{ agentRequestId, resolvedBy }`), clears `blocking_question` for the mission, and flips the session phase `blocked → execute`. This makes the answer visible in the feed and activity history regardless of whether injection succeeds.

### 3.2 `ask` waits for the answer (CLI)

`ovld protocol ask` gains `--wait <seconds>` (default 540 — under every harness's shell timeout) and prints, on stdout, one of:

```
ANSWER: <text or option label>              # resolved: agent continues immediately
PENDING: run `ovld protocol await-answer --request-id <id>` to keep waiting
```

Plus a new `ovld protocol await-answer --request-id <id> [--wait <s>]` that re-enters the same lease/poll loop. Both share the loop already in `cli/src/agent-session/request.ts` (extract `waitForResolution()`); the only difference is the credential — ask runs under the session key rather than a hook's channel token, so add a human-auth/session-key variant of `/requests/:id/lease` (or let the CLI resolve the channel credential from the persisted attach state, which `bind.ts` already stores for manual attach).

Skill text change (`connectors/core/overlord-mission/SKILL.md` + adapter renders): *"If blocked, call `ovld protocol ask …`. The command waits for the reply and prints it; if it prints PENDING, run the printed `await-answer` command and keep waiting. Do not deliver while a question is pending."* This is a connector-version bump (`connector-versions` skill).

Idle fallback (turn ended without the answer, e.g. agent ignored PENDING or the process was killed): the lease lapses → server marks `released_reason='timeout'`, the request stays **open and answerable** (unlike permissions, there is no native prompt to hand back to), and the answer is enqueued as a `session_inputs` row. Today only OpenCode (`prompt_async` sidecar) and Cursor (`followup_message` on its next `stop`) can drain that queue; Claude/Codex/Pi mark it `Unsupported` and the card shows "Answer recorded — agent will see it when it next calls Overlord" (the next `attach`/`heartbeat`/`load-context` from that session returns pending answers in its JSON, which the skill instructs the agent to read). Latch v2 hub (D) replaces this later.

### 3.3 UI: one answerable component everywhere

- **Web mission panel** — `agent-session/BlockingQuestionCard.tsx` already renders `kind='question'` from `GET /api/agent-requests?objectiveId=`. No change beyond hiding the countdown badge when `windowExpiresAt` is null and softening "Respond in terminal" to "Dismiss to terminal" only when the channel reports `terminal.concurrentAnswer` (not the case for callback harnesses; hide it otherwise).
- **Web activity feed** — `activity-feed/BlockingQuestionCard.tsx`: when `ActivityFeedQuestionItemDto` carries `agentRequestId` (additive contract field, from the event payload), embed the same form inline (reuse `useResolveAgentRequest`) instead of only "Answer → open panel". Same for `LiveActivityFeed.tsx` `event.type === 'ask'`.
- **iOS** — `AgentSession/BlockingQuestionCard.swift` already exists and resolves through the same route; `MissionChatFeed.swift` needs the same additive `agentRequestId` link. Deliver from the OverlordMobile repo.
- **Notifications** — `agent_question` push already exists; add the request id to the deep link so the notification lands on the form.

### 3.4 Contract impact (proposal, bump to 129)

Additive only:
- `ActivityFeedQuestionItemDto.agentRequestId?: string | null`; `MissionEventDto` `type` gains `'answer'`.
- `AgentRequestDto.windowExpiresAt` becomes nullable for `kind='question'|'choice'` (verify the shared contract already allows null; the web card handles `null`).
- New protocol subcommand `await-answer`; `ask` gains `--wait`, `--options-json`, `--no-free-text`, `--json`.
- `POST /api/agent-requests/:id/resolve` unchanged. New session-key-auth lease/read for the CLI wait loop under `/api/protocol/...` (or reuse channel credential — decide in implementation).
- Capability matrix: flip `answer.structuredQuestion` to `supported` for every adapter via the `ovld`-tool path (new capability row `answer.protocolQuestion` is more honest, since the native `Elicitation`/`ToolRequestUserInput`/`ctx.ui.select` surfaces remain unverified). Fixture: the CLI wait loop resolving a question.

Modules affected: core service (`protocol.ts`, `agent-session/requests.ts`), backend routes, CLI (`protocol` commands, `agent-session/request.ts`), connectors core skill + all six adapters (skill text, version bump), webapp (3 cards), iOS (2 files), database (no schema change — `agent_requests` already carries every column needed), MCP (`overlord_ask` should mirror `--wait` if exposed).

## 4. Suggested objectives

1. Core + backend: `askQuestion` creates the `agent_requests` row; `resolveRequest(question)` emits `answer` event, clears blocked state, enqueues `session_inputs`. Tests.
2. CLI: `ask --wait`, `await-answer`, shared wait loop; skill text + connector version bump; capability descriptor fixture.
3. Web: feed/live-feed inline forms via `agentRequestId`; panel card tweaks. iOS: same, from OverlordMobile.
4. Idle delivery: pending-answer echo on `attach`/`heartbeat`; OpenCode `prompt_async` drain; later, Latch v2 hub client for callback harnesses.
