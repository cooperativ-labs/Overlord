# coo:880 — Should Overlord ship as a Slack AI agent instead?

**Status:** decision record. Evaluation only; no implementation.
**Objective:** coo:880.4fgb · Evaluated 2026-08-31 · Contract v130
**Evaluates:** [Work with AI agents in Slack](https://slack.com/help/articles/33076000248851-Work-with-AI-agents-in-Slack)
against [coo-880-slack-mission-intake.md](./coo-880-slack-mission-intake.md).

## Verdict

**No. Do not replace the planned intake app with a Slack AI agent.** Ship the
intake app as specified, and add the agent container as a phase 2 on the *same
Slack app*, gated on coo:781/coo:784.

"Instead" is a false choice at the platform level. One Slack app manifest can
carry both: message shortcuts and slash commands are ordinary app features,
while the agent surface is a toggle under **Agents & AI Apps** that adds the
`assistant:write` scope and the split-view/DM container. Enabling the agent
neither removes nor degrades shortcuts. The real question is therefore
sequencing — where release 1's effort goes — and on that the answer is clear.

## 1. Why the agent surface cannot be first

### 1.1 The agent container is DM-scoped; our primary use case is channel-scoped

Slack's agent docs are explicit that agents operate in direct messages — "every
DM with the user is a thread" once the Agents feature is enabled. Channel
presence is @-mention only, and every container affordance (text streaming,
`processing`/`active`/`suspended` status, suggested prompts, session titles, the
Agents & tools sidebar) is a DM-session feature.

The job coo:880 exists to do is the opposite shape: turn *this message in
`#product`, optionally with its thread and permalink*, into a mission or an
objective. That is a **message shortcut** interaction — Slack hands the app one
message plus its channel context. An agent has no message-action context, and
reaching that content conversationally would require broad channel-history
scopes the intake plan explicitly refuses (§6.2: no "live Slack message history
merely because the app is installed").

Building the agent first would ship a chat box that cannot perform the capture
the mission was created for.

### 1.2 The conversational backend it needs does not exist yet — and we measured that

[nlp-mission-management-mcp-readiness.md](./nlp-mission-management-mcp-readiness.md)
(coo:781) already assessed a chat-driven mission-management interface and
concluded the MCP surface **"is not yet robust enough to back the proposed chat
interface."** Its three blocking classes apply verbatim to a Slack agent:

| Finding | Owner today |
| --- | --- |
| Cross-workspace resolution is architecturally single-workspace (every request resolves to the caller's *oldest* membership) | coo:784 |
| Search relevance fails on realistic vague input; mission chatter outranks exact title matches | coo:784.k8xe |
| "The verbs the chat interface needs mostly do not exist over MCP" — no launch, schedule, re-status, re-assign, tag, or cancel; *"begin executing this objective — the headline interaction — has no path at all"* | coo:781 |

A Slack agent is a second consumer of exactly that surface. Shipping it before
coo:781/coo:784 land leaves two bad options: front-run a known-weak retrieval
layer, or build a Slack-specific command path — which the intake plan (§7.1) and
the contract both forbid, since it establishes a second mission-writing path.

### 1.3 Slack's agent session model is lossy against ours

A Slack agent session is one interactive thread with a streamed reply, a status
indicator and a stop button. An Overlord mission is durable, multi-objective,
multi-repo, ledger-backed, and runs for hours on a laptop, an agent pod, or a
runner — largely without anything to stream.

Mapping missions onto agent sessions 1:1 discards objectives, which contract v130
has just made the unit of execution (coo:756, coo:879). Mapping them onto plain
messages discards the container's only advantage. The agent surface earns its
keep as a *supervision view over missions that already exist* — a phase-2 shape,
not a first release.

## 2. What the agent surface genuinely buys us, later

Three funded goals map onto it well, and none of them are intake:

- **Blocking-question answers (coo:833).** `agents.sessions.setStatus('suspended')`
  means precisely "user intervention needed before continuing," and a Slack
  thread is a natural answer input. coo:833 already chose option A — `ask`
  blocks and receives the answer through the agent-session exchange request — so
  Slack becomes another *renderer* of an `agent_requests` row alongside web and
  iOS, not a new injection mechanism. Highest value per unit of work.
- **Notification transport (coo:637).** The consolidation target is "one catalog,
  one server-side emit point, one durable notification row, several dumb
  transports." Slack is a textbook dumb transport, fed by `outbox_messages` from
  [mission-data-webhooks-api.md](./mission-data-webhooks-api.md). Note this
  **contradicts the intake plan's §1/§2 non-goal** ("It is not a notification
  channel"). That non-goal is correct for release 1 and should be re-opened
  deliberately at phase 2, not eroded silently.
- **Delivery review.** Delivery summaries are already narrative prose; rendering
  one in the container with an "Open in Overlord" link is a small increment.

## 3. The part actually worth reacting to: Slack Code channels

The strategically interesting item in the article is not the assistant pane — it
is **Slack Code channels**: temporary, *agent-created* channels for plans, diffs
and live previews, tracked with status in the Agents & tools sidebar. That is
functionally the run queue and delivery review Overlord already builds.

Two facts govern the response:

1. **Only an agent can open one**, through an API Slack has limited to launch
   partners (Anthropic, Cognition, GitHub, OpenAI, Vercel), with a stated
   intention to open it to other developers later. It is not available to us.
2. Overlord is an **orchestrator over** those same harnesses (Claude Code,
   Codex, Cursor, OpenCode, Pi), not a coding agent competing with them.

So there is nothing actionable now, and we should not architect toward it. It
does raise a positioning question worth answering deliberately when the API
opens: does Overlord's supervision surface eventually render *inside* Slack's
agent sidebar, or does Overlord stay its own console with Slack as intake and
notification? Track it; do not pre-build for it.

## 4. Costs and risks of switching

- **Plan requirement is unresolved.** Slack's developer docs state "developing
  and using some AI features require a paid plan"; the help article says agents
  are available on all plans. These conflict and must be verified before any
  commitment to the agent surface. Separately, **workspace guests cannot use AI
  apps or agents at all** — message-shortcut intake carries no such restriction.
- **Distribution gets heavier.** Listing as an agent pulls us toward
  AgentExchange, which now merges the Slack Marketplace and Agentforce
  ecosystems and requires Salesforce Partner Network membership, a business-plan
  submission, and a security review. The intake app can ship as an unlisted or
  internal install and skip all of it.
- **Scope is a strict superset.** An agent container needs streaming, session
  status, suggested prompts, stop handling, and an LLM loop with tool access — on
  top of everything the intake app needs anyway (OAuth install, identity link,
  workspace/project mapping, idempotency, RBAC). Nothing in the intake plan is
  saved by choosing the agent instead.

## 5. Recommendation

Keep the intake plan's §9 delivery sequence (steps 1-5) as release 1, unchanged.
Append:

6. **Phase 2 — agent container on the same Slack app**, gated on coo:781 and
   coo:784 landing the verbs and search quality: a DM assistant that answers
   "what's running," renders the blocking-question card, and surfaces
   deliveries. Requires re-opening the release-1 "no notifications" non-goal.
7. **Watch item** — Slack Code channel API general availability; re-evaluate
   positioning at that point.

Three cheap amendments to make now so phase 2 is not blocked:

- Reserve one app identity that can later carry both features. Do not ship a
  bot named for intake alone.
- Keep `submissionSource` at the specified closed vocabulary (`overlord | slack`).
  A future conversational surface is still the Slack surface; it needs no new value.
- Record the §2 "no notifications" non-goal as explicitly **release-1-scoped**.

**Contract impact:** none beyond what the intake plan already declares. This
decision requires no additional contract change or version bump.

## 6. References

- [Work with AI agents in Slack](https://slack.com/help/articles/33076000248851-Work-with-AI-agents-in-Slack) — surfaces, Agents & tools tab, admin controls, guest restriction.
- [Developing an agent](https://docs.slack.dev/ai/developing-agents/) — DM-only session model, `agents.sessions.setStatus`/`rename`, `chat.startStream`/`appendStream`/`stopStream`, paid-plan note.
- [Developing AI apps](https://docs.slack.dev/ai/developing-ai-apps/) — `assistant:write`, Agents feature toggle, `assistant_thread_started`, `assistant_thread_context_changed`, `message.im`.
- [Slack Code channels](https://slack.com/blog/news/slack-code-channels-for-agents) — agent-created temporary channels; launch-partner-only API.
- [Slack Marketplace app guidelines](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/) — review requirements.
