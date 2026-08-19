# NLP mission-management interface — MCP readiness review

Mission: **coo:781** · Objective: **coo:781.6zvj** · Reviewed 2026-08-19 · Contract v92

## Verdict

**The MCP is not yet robust enough to back the proposed chat interface.** It is a
solid *agent-execution* surface — attach, update, deliver, record work — because
that is what it was built for. It is a weak *product-management* surface. Three
classes of problem block the objective as written:

1. **Cross-workspace search is architecturally impossible today**, not merely
   unimplemented. Every MCP request resolves to exactly one workspace: the
   caller's *oldest* membership — even though the token itself records the
   workspace that was active at approval, which auth then discards.
2. **Search relevance fails on realistic vague input** in ways that are measured,
   not hypothetical — including a ranking bug where mission chatter beats an exact
   title match, and a display-id lookup that returns the whole workspace.
3. **The verbs the chat interface needs mostly do not exist over MCP.** You cannot
   launch, schedule, re-status, re-assign, tag, or cancel anything from MCP. Those
   all exist in REST; none are exposed. Most importantly, *"begin executing this
   objective" — the headline interaction in the objective — has no path at all.*

None of this is deep. The service layer already does the hard parts
(`launchObjective` resolves its own workspace and checks membership;
`createProjectFromProtocol` already demonstrates multi-workspace resolution).
The work is mostly surfacing and one real relevance fix.

---

## What works today

The hosted MCP (`mcp/tool-catalog.ts`) exposes **14 tools** over **27** protocol
subcommands:

| Working well | Notes |
| --- | --- |
| Mission lifecycle | attach → update → deliver, with change rationales and delivery evidence |
| Mission context read | `overlord_load_mission_context` returns objectives, history, artifacts, shared context — genuinely rich |
| Objective addressing | `coo:756.k7xm` display ids are a complete address; `missionScopeFlags` derives the mission. This is a real strength for NL — the agent can carry one opaque token through a conversation |
| Artifact create/update | with optimistic concurrency |
| `overlord_record_work` | one-call "log what we just did" — a genuinely good NL-shaped tool |
| Full-text index | `search_documents` covers mission titles, objective text, and event summaries, kept live by DB triggers on all three tables, with soft-delete cleanup. The plumbing is right |

The **index design is sound**. The problems are in the query layer, the scoring,
the result shape, and the missing verbs.

---

## Findings

Severity: **P0** blocks the objective · **P1** makes the chat interface feel broken ·
**P2** friction.

Findings marked *(measured)* were reproduced by running `searchMissions` against the
real seeded service harness (`createSeededServiceContext`). Probe scripts were
scratch-only and are not committed.

### P0-1 · Search cannot span workspaces, and never will without a change

`backend/auth.ts:150` — `ensureWorkspaceUser` resolves the request's workspace as:

```sql
SELECT wu.id, wu.workspace_id FROM workspace_users wu ...
 WHERE wu.profile_id = ? AND wu.status = 'active'
 ORDER BY wu.created_at ASC LIMIT 1
```

The caller's **oldest** membership, always. `searchMissions` then scopes every
query to `ctx.workspace.id` (`packages/core/service/missions.ts:845`).

Compounding this — and this is the sharper half of the finding — **the token is
stamped with one workspace and enforced against a different one.**

`user_tokens` has a `workspace_id` column, and `createUserToken` populates it with
whatever workspace was active at approval time (`backend/repository.ts:7656`):

```ts
const workspaceId = getActiveWorkspaceId();
```

`verifyUserToken` reads it back and returns it (`auth/src/auth/token.ts:145-149`),
along with `workspaceUserId`. The auth middleware then **discards both**
(`backend/auth.ts:210-214`):

```ts
const verified = await verifyUserToken(authDomainDatabase(), bearerToken);
setActiveProfileId(verified.profileId);
const membership = await ensureWorkspaceUser(verified.profileId);  // re-derives; verified.workspaceId unused
```

So for anyone in more than one workspace, the token row says workspace B while every
request it authorizes runs against workspace A. The OAuth consent screen implies a
scope the enforcement layer does not honour, and the two diverge silently. This is a
correctness/consent bug **independent of the NLP work** — but it is also why the
cross-workspace fix is cheap: the plumbing to carry a workspace through a token
already exists and is simply being thrown away.

Note the terminology, because it is easy to read backwards: *profile-scoped* describes
**authentication** — the bearer proves *who you are*, not *which workspace you are
acting in*. It does **not** mean queries span every workspace. Because the enforced
token names no workspace, the request must choose one, and it chooses exactly one.
Search gets narrower, never wider.

Finally, there is no `workspaceId` parameter anywhere in the MCP tool catalog except
`overlord_create_project`, and no tool to *list* the workspaces a user belongs to
(`list-organizations` exists in the protocol but is not exposed over MCP — and, per
its own comment, returns only the current workspace anyway).

So: a user in three workspaces asks ChatGPT "find my mission about the webhook rate
limiting" and gets results from one workspace, silently, with no indication the
other two were never searched.

> **Fix direction:** add `workspaceId` to `overlord_search_missions`, add an
> `overlord_list_workspaces` tool, and make the search service accept a workspace
> set. **The exact pattern already exists in the codebase** — the agent-request
> inbox (`createAgentRequestHumanRouter`, `backend/agent-session-routes.ts:632`)
> enumerates `callerWorkspaceMemberships()`, calls `requireWorkspacePermission`
> per workspace, *tolerates* per-workspace denials so one bad membership cannot
> fail the request, and then queries `WHERE workspace_id IN (...)`. Copy that.
> For writes, `resolveParentlessWorkspace` (`backend/protocol.ts:584`) supplies
> the complementary half, including the `workspace_selection_required` response
> shape — exactly the right ask-the-user affordance for a chat agent. Default
> should be *all* memberships for search (read-only, cheap) and *explicit
> selection* for writes.

### P0-2 · No objective-level search exists

The objective calls for finding *objectives* by vague description ("schedule the
one about the ingestion pipeline for tomorrow"). Objectives **are** indexed
(`entity_type = 'objective'`), but the index is only ever used to score their
parent mission. `searchMissions` returns `MissionSummary[]`, which carries no
objective data beyond `objectiveCount`.

To act on an objective the agent must: search → pick a mission → `load_mission_context`
→ scan objectives → guess. That is 2+ round trips per candidate mission, and it
fails outright when the matching objective lives in a mission whose title matched
nothing.

There is also **no objective query surface anywhere** — `/api/objectives` is
POST-only; listing is per-mission (`/api/missions/:id/objectives`) or a CSV export.

> **Fix direction:** `overlord_search_objectives`, returning objective display id,
> title, state, mission display id + title, project name. The index already has
> the documents; this is a new query and DTO, not new plumbing.

### P0-3 · The verbs a PM chat interface needs are absent from MCP

Every one of these exists in REST and is unreachable from chat:

| NL intent | Backing surface | On MCP? |
| --- | --- | --- |
| "Start running objective X" | `POST /api/objectives/:id/launch` | **No** |
| "Schedule this for tomorrow" | `PATCH /api/missions/:id` (`dueDatetime`) | **No** |
| "Make this recurring weekly" | `PUT /api/missions/:id/schedule` | **No** |
| "Move it to next-up / bump priority" | `PATCH /api/missions/:id` (`statusId`, `priority`) | **No** |
| "Assign to Sam" | `PATCH /api/missions/:id` (`assignedWorkspaceUserId`) | **No** (only settable at *create*) |
| "Tag these as tech-debt" | `PATCH /api/missions/:id` (`tagIds`) | **No** |
| "Cancel / delete that mission" | `DELETE /api/missions/:id` | **No** |
| "What am I working on?" | `GET /api/workspace/my-missions` | **No** |
| "What's happened lately?" | `GET /api/activity-feed` | **No** |
| "The agent is asking you something" | `GET /api/agent-requests` (already cross-workspace) | **No** |
| "Tell it to use Postgres instead" | *deliberately removed* — see note below | **No** |
| "Show me what changed" | `GET /api/missions/:id/file-changes` | **No** |
| "Reorder these objectives" | `PATCH /api/missions/:id/objectives/reorder` | **No** |
| "What projects do I have?" | — | **No such endpoint at all** |

Note the last two rows especially:

- **`overlord_attach_session` is not "begin executing".** It opens a session for the
  *calling* agent to do the work itself. A ChatGPT-hosted agent has no repo, no
  runner, no filesystem. "Start executing objective X" means enqueueing an
  `execution_request` for a runner — `launchObjective` — and that is not reachable.
  This is the single most important missing verb: the demo the objective describes
  ("asking the agent to begin executing a certain objective") **cannot be built today.**
  The permission already exists in the token scope (`execution_request:create` is in
  `MISSION_LIFECYCLE_GRANTS`); only the surface is missing.
- **There is no way to list projects.** `overlord_create_mission` states "Hosted MCP
  never chooses a project implicitly" and requires `projectId`, but nothing lets the
  agent enumerate candidates to offer the user. See P1-6.
- **Answering a blocked agent remotely was deliberately removed.**
  `POST /api/agent-requests/:id/resolve` and `/:id/release` now throw
  `session_controls_gone` (410): *"Harness permission and question prompts are
  presented from Latch observation."* Reading the request inbox still works — and
  already works across workspaces. So "tell the agent to use Postgres" is a
  **product decision to reverse, not a plumbing gap**, and it should be treated as
  such in Phase 3.

### P0-4 · "Schedule this for tomorrow" has no true backing concept

Worth flagging before it gets designed around. Two things exist and neither is
"run this at time T":

- `missions.due_datetime` — a **due** date. Descriptive, drives no execution.
- `schedules` — a **recurrence template** (`period_type` d/w/m, days-of-week,
  timezone) that duplicates a mission into a target status on a cadence.

Objectives have no scheduling fields at all. So "schedule objective coo:781.6zvj
for tomorrow morning" maps to *nothing* today; the closest honest translation is
"set the mission's due date to tomorrow", which will not launch anything.

> **Decision needed (see Open questions):** is scheduled execution in scope, or does
> "schedule" mean "set a due date and move to next-up"? This changes whether this
> is a surfacing task or a new scheduling engine.
> `planning/feature-plans/mission-scheduling-engine.md` already exists — worth
> reconciling against it before building.

### P1-5 · Relevance sums per-document scores, so chatter beats titles *(measured)*

`packages/core/service/missions.ts:887`:

```ts
existing.relevance += row.doc_score;   // summed across every matching document
```

A mission's score is the **sum** over all its matching documents. A long-running
mission accumulates dozens of `mission_events`, each an indexed document.

Measured: mission A titled *"Moonbeam telemetry overhaul"* vs. mission B titled
*"Unrelated logging cleanup"* with 25 progress events mentioning "moonbeam" in
passing. Query `moonbeam`:

```
results:            [ 'Unrelated logging cleanup', 'Moonbeam telemetry overhaul' ]
exact-title rank:   1   (i.e. second)
```

The existing test `'ranks a title match above an event-only match for the same term'`
passes only because it uses a *single* event. The invariant it claims to protect
does not hold at n=25 — and real missions have far more than 25 events.

This is the highest-leverage single fix in the review: an NL agent that picks
`results[0]` picks the chattiest mission, not the right one.

> **Fix direction:** aggregate with `MAX(doc_score)` plus a small bounded bonus for
> additional distinct matching documents (e.g. `max + 0.1 * ln(1 + others)`), rather
> than an unbounded sum. Add a regression test at n≈25 events.

### P1-6 · Vague queries OR-match everything, with no signal about where relevance ends *(measured)*

`buildMissionSearchMatch` splits on `[\p{L}\p{N}]+` and joins with `OR` / `|`, all
as prefix tokens. A conversational sentence therefore matches almost everything —
SQLite FTS5 has no stoplist at all, so `the`, `to`, `we` become live prefix terms.

Measured, 6 missions in the workspace:

```
query:  "that thing where we were going to stop the webhooks from firing too fast"
returns: all 6 missions      target rank: 0 (correct, but indistinguishable)
```

Ranking got it right. **The agent cannot tell**, because `MissionSummary` returns
no relevance score and no matched snippet. At the default `limit: 25` in a real
workspace, the model receives 25 titles with no way to know that #1 scored 40× #2.

Three compounding gaps:

- **No score, no snippet, no match reason** in the result DTO.
- **No `AND` / phrase mode** — the agent cannot say "these three terms must all appear".
- **Silent empty-query fallback.** `searchMissions` treats a query with no usable
  terms as "browse by recency" (`missions.ts:830`). Measured: query `"???"` returns
  the full recency list with **no flag distinguishing it from a real match set**.
  An NL agent will present those as answers.

### P1-7 · Display-id lookup returns the entire workspace *(measured)*

Users paste display ids constantly. `coo:781` tokenizes to `[coo, 781]` →
`coo* OR 781*`. Every mission in the `coo` workspace has `coo:NNN` in its indexed
`body_text` (the mission trigger indexes `title || ' ' || display_id`), so `coo*`
matches **all of them**.

Measured with 8 missions, querying the exact display id `local-workspace:6`:

```
results count:  8   (the entire workspace)
rank of exact:  1   (behind local-workspace:7)
```

The exact match did not even rank first.

> **Fix direction:** detect a display-id-shaped query (`^[a-z0-9-]+:\d+(\.[a-z0-9]+)?$`)
> before tokenizing and resolve it directly. `missionDisplayIdFromObjectiveRef` in
> `@overlord/contract` already parses the objective form.

### P1-8 · Results cannot be disambiguated for a human *(measured)*

`MissionSummary` is:

```ts
{ id, displayId, projectId, title, statusType, statusId, priority,
  createdAt, updatedAt, objectiveCount }
```

`projectId` is a raw UUID. No project **name**. No assignee. No due date. No tags.
No relevance. No snippet.

Measured — two projects, same mission title, query `"parser in latch"`:

```
[ { t: 'Fix the parser', p: '7d13267e-…' },
  { t: 'Fix the parser', p: 'b32cef18-…' } ]
```

The agent must either show the user a UUID or make N extra `resolve_project` calls.
And note "in latch" contributed nothing to matching — **project names are not
indexed**, so users cannot scope by project in natural language.

### P1-9 · The documented status filter silently matches nothing *(measured)*

`connectors/core/overlord-mission/SKILL.md:87` and `cli/docs/02-cli-first-product-surface.md:50`
both document:

```
ovld protocol search-missions --query "..." --status next-up,execute
```

But `--status` filters `missions.status_type`, whose CHECK constraint allows only
`draft | execute | review | complete | blocked | cancelled`. `next-up` is a
*workspace status key* (mapped to `type = 'draft'`), not a status type.

Measured: `statusTypes: ['next-up']` → **0 results**. `['next-up','execute']` → **0**.
`['draft']` → 1.

So the filter our own docs teach an agent to use returns nothing, silently. And
because workspace statuses are user-configurable and **not discoverable over MCP**,
an agent asked "what's queued up?" has no correct move.

### P2-10 · Mission body text is barely indexed

The mission trigger indexes `title || ' ' || display_id` **only**
(`database/postgres/migrations/002_initial_core.sql:982`). Never indexed:

- `missions.constraints_text`, `acceptance_criteria_text`, `output_format_text`
- `artifacts` content (plans, notes, decisions — often the richest description of the work)
- `deliveries` summaries (what actually shipped)
- `change_rationales` (`why`/`impact` — extremely queryable: "which mission touched the auth middleware?")
- `projects.name` / `description`
- Tag names
- Inbox items

For "take a bunch of user feedback and propose missions", the *dedupe* step —
"have we already got something covering this?" — depends almost entirely on
artifact and delivery text that is invisible to search.

### P2-11 · No semantic or fuzzy matching *(measured)*

Pure lexical prefix matching. Measured against a mission titled *"Speed up the
mission board load"*:

```
"latency"     -> []        "perf"        -> []
"kubernets"   -> []        "kuberentes"  -> []
```

The objective says "we can rely on the agent to translate the user's description
into search terms" — that is a reasonable bet, and it partly works (`"slow board"`
and `"board performance"` both hit). But it means **multi-query fan-out is
mandatory**, and today each query costs a round trip and returns an unscored list.
Either give the agent a batch-query tool, or add embeddings.

`pgvector` on Neon would make this straightforward for Cloud, but SQLite/Local
parity is a real constraint — the contract requires both editions. A pragmatic
middle path: keep FTS as the retrieval layer, fix scoring, and let the agent
issue 3–5 term variants in one batched call.

### P2-12 · Mission creation from chat is awkward

`overlord_create_mission` accepts **one** `objective` string. Creating "a mission
with four objectives" requires `create_mission` + `add_objectives` — two calls,
non-atomic, and a failure between them leaves a one-objective mission.
`ovld protocol create` already takes `--objectives-json` as an array; the MCP tool
just does not.

### P2-13 · `overlord_resolve_project` reads the *server's* filesystem

`discoverProject` with no `projectId` falls through to
`path.resolve(workingDirectory ?? process.cwd())` and walks up looking for
`.overlord/project.json` (`packages/core/service/projects.ts:838`). Over hosted MCP
there is no client cwd, so this resolves against **the backend process's own working
directory**. Harmless today (it will just find nothing), but it is a latent
information-disclosure path in a multi-tenant deployment and should be closed off
for the hosted surface rather than left to chance.

---

## Recommended plan

### Phase 1 — make search answer vague questions (P0-2, P1-5 … P1-9)

1. Fix relevance aggregation: `MAX` + bounded bonus, not `SUM`. Regression test at
   n≈25 events.
2. Short-circuit display-id-shaped queries to a direct lookup.
3. Extend the result DTO: `relevance`, `matchedIn` (`mission` | `objective` | `event`),
   `snippet`, `projectName`, `assignee`, `dueDatetime`, `tags`.
4. Return `{ results, mode: 'search' | 'recency-fallback', totalMatched }` so the
   agent knows when it got a fallback instead of a match.
5. Add `overlord_search_objectives` over the existing `entity_type = 'objective'` documents.
6. Add `mode: 'all' | 'any' | 'phrase'` and accept an array of query variants in one call.
7. Index mission `constraints_text` / `acceptance_criteria_text`, artifact content,
   delivery summaries, and change rationales. Add `project_name` as a denormalized
   indexed column on `search_documents`.
8. Fix the `--status next-up` documentation, and add a status-vocabulary read
   (`overlord_list_workspace_statuses`) so agents filter on real values.

### Phase 2 — cross-workspace (P0-1)

9. Add `overlord_list_workspaces`.
10. Accept `workspaceId` (and `workspaceIds`) on search tools; **default read
    queries to every active membership**, returning `workspaceId` + `workspaceName`
    per result.
11. Keep writes explicit — reuse the existing `workspace_selection_required`
    response rather than inventing a new affordance.
12. Honour `verified.workspaceId` (or deliberately drop the column) so the token's
    recorded workspace and the enforced workspace stop diverging. Then correct
    `mcp/docs/chatgpt-app-publication.md`, whose "workspace-scoped" claim is true of
    the stored row and false of what is enforced.

### Phase 3 — the missing verbs (P0-3, P0-4, P2-12)

13. `overlord_launch_objective` — wraps `launchObjective`. **The highest-value single
    addition in this review.** Needs an agent key and optional execution target, so
    it also needs `overlord_list_execution_targets` and an agent-catalog read.
14. `overlord_update_mission` — status, priority, assignee, tags, due date, project move.
15. `overlord_schedule_mission` — recurrence, wrapping `PUT /api/missions/:id/schedule`.
16. `overlord_list_my_work` — wraps `my-missions` + `activity-feed`.
17. `overlord_list_agent_requests` — surface "the agent is waiting on you" in chat.
    The read is safe and already cross-workspace. **Answering** from chat is a
    separate decision: it was intentionally removed (410 `session_controls_gone`,
    prompts now come from Latch observation), so re-introducing it needs product
    sign-off first. Recommend shipping the read now and treating the answer path
    as its own scoped question — it is the interaction that would make the chat
    interface feel *alive* rather than like a form, but it reverses a deliberate call.
18. `overlord_cancel_mission` (soft delete / cancel status). Mark `destructiveHint: true`
    — it would be the first tool on the surface that needs it.
19. Let `overlord_create_mission` take an objectives **array**.

### Phase 4 — the proposal workflow (the feedback-dump case)

20. `overlord_propose_missions` — accept a blob of user feedback, return *drafted*
    missions/objectives for confirmation **without writing**, each annotated with
    "similar existing work" from search. Then a confirm step writes them.
    Ask-before-write is what makes bulk creation safe in a chat surface, and it is
    also the only realistic defense against duplicating existing missions.

### Contract impact

Every phase touches `mcp` and `mcpToService` in `contract/components.yaml`, and
Phases 1–2 change `searchMissions`'s stable return shape. Concretely:

- **New MCP tools** — additive to the `mcp` component's stable surface; needs a
  contract version bump and a `mcp/README.md` reference-spec update.
- **`MissionSummary` extension** — additive fields are backward-compatible for
  `webapp/web/lib/api.ts`, `backend/index.ts` (`/api/missions/search`), and the CLI,
  but the `{ results, mode }` envelope in step 4 **is breaking** for
  `overlord_search_missions`, `GET /api/missions/search`, and
  `ovld protocol search-missions`. Version the envelope or add it as a sibling tool.
- **`search_documents` schema change** (step 7) — new indexed columns plus trigger
  rewrites in **both** `database/postgres` and `database/sqlite` migrations, and a
  backfill for existing rows. This is the largest single chunk of work in the plan.
- **Cross-workspace reads** (Phase 2) — the most sensitive change in the review.
  It widens what one MCP token can see, so it must be gated on real per-workspace
  RBAC (`requireWorkspacePermission` per workspace, as `createProjectFromProtocol`
  already does), never on the request's active-workspace default. Worth an explicit
  security-audit pass.
- **Local edition parity** — every tool must work against SQLite. This is what rules
  out an embeddings-only answer to P2-11.

---

## Natural-language interactions to design for

The objective asks for examples beyond the obvious. Grouped by what they demand of
the MCP; **bold** marks ones with no path at all today.

### Retrieval and recall

- "What was that mission where we decided not to use Redis?" — *needs decision/artifact text indexed (P2-10)*
- "Find everything touching the auth middleware." — **needs `change_rationales` indexed**
- "Which missions are blocked, and on what?" — **needs a blocked-reason read**
- "Show me anything Sam has in review." — **needs assignee filter + search**
- "Did we already build this?" (pasting a feature request) — *the dedupe case; needs P0-2 + P2-10*
- "What did we ship last week?" — **needs delivery search by date**
- "What's the oldest thing still sitting in draft?" — **needs sort-by-age**
- "Which missions have been open longest without an update?" — **staleness query; nothing today**

### Scheduling and sequencing

- "Schedule the ingestion objective for tomorrow morning." — **P0-4**
- "Push everything in next-up back a week." — **bulk date mutation**
- "Run these two objectives in parallel." — *`allowParallelObjectives` exists on the mission; not on MCP*
- "After the migration lands, start the backfill." — **dependency between objectives; no such concept in the schema**
- "Every Monday, create a mission to triage new feedback." — *recurrence exists; not on MCP*
- "Don't start anything new until the release is out." — **freeze/hold; no concept**

### Execution control

- "Start the auth refactor on my laptop." — **P0-3, plus execution-target selection**
- "Use Opus for this one." — *`model` / `reasoningEffort` exist on objectives; only `autoAdvance` + `instructionText` are editable over MCP*
- "Stop that run." — **no cancel-execution verb**
- "Rerun the failed objective." — **needs failure state + relaunch**
- "It's asking whether to use Postgres — tell it yes." — **read exists; answering was removed by design (P0-3)**
- "Auto-advance through the rest of this mission." — *`update_objective` handles one objective at a time; no mission-level toggle*
- "What's running right now, and how far along?" — **needs live session read**

### Authoring and decomposition

- "Turn this Slack thread into a mission." — *works, but one objective per call (P2-12)*
- "Break this into objectives for me." — *agent-side, but needs a propose-then-confirm mode (Phase 4)*
- "Split this mission — the API part goes in the backend project." — **cross-project move exists in REST only**
- "Add 'must not break the CLI' as a constraint." — **`constraints_text` unreachable over MCP**
- "Same as coo:412 but for the mobile app." — **clone-mission; no verb**
- "These three are really one mission." — **merge; no verb**

### Triage and portfolio

- "What should I work on next?" — **needs my-missions + priority + staleness**
- "Reprioritize: everything customer-reported goes to high." — **bulk update by tag**
- "How much is in flight per project?" — **aggregate counts; no endpoint**
- "Anything I own that's been in review more than three days?" — **needs status-age**
- "Archive everything complete from before June." — **bulk archive**

### The ones most likely to be overlooked

These are the interactions users *will* try, that nothing in the current design anticipates:

- **"Why did this fail?"** — reading delivery evidence (`knownRisks`, `humanActions`,
  `tradeoffsMade`) back conversationally. It is captured today and never read back
  over MCP. Cheap to add, high perceived intelligence.
- **"What do I need to do by hand?"** — aggregating `humanActions` across every recent
  delivery into one to-do list. This is arguably the single most useful thing the
  chat interface could offer, and the data already exists.
- **"Remind me about this tomorrow"** — a chat-native follow-up that is not a mission
  at all. Without an answer it becomes a junk mission. The `inbox` may be the right
  home.
- **"What changed since I last looked?"** — needs a per-user last-seen watermark.
  Nothing tracks this.
- **"Draft a standup update for me."** — read-only synthesis over the activity feed;
  probably the best first demo of the whole feature, and it needs only the feed read.
- **"Is anything about to conflict?"** — two objectives queued against the same
  `resource_key`. The 409 logic exists (`findConflictingActiveSibling`); surfacing it
  *before* launch is new.
- **"Who's touched this file recently?"** — `change_rationales` + `changed_files` are
  already per-file; this is a search away and a genuinely novel capability.
- **"Undo that."** — an NL surface that can create and mutate needs an undo story, or
  users will not trust it with writes. Nothing today is reversible.
- **"Just do it, don't ask me"** vs. **"check with me first"** — a per-conversation
  autonomy setting. Without it, every write needs confirmation and the interface
  feels slower than the board.
- **"Which workspace am I in?"** — until P0-1 lands, users in several workspaces will
  be confused by silently missing results, and the answer is not even the workspace
  they consented in. Even before the fix, the agent should be able to *say* which
  workspace it actually searched.

---

## Open questions

1. **Does "schedule" mean deferred execution or a due date?** (P0-4.) A real
   run-at-time scheduler is a substantially larger build than a date field, and
   `planning/feature-plans/mission-scheduling-engine.md` may already answer this.
2. **Should cross-workspace search be the default, or opt-in?** Defaulting to all
   memberships is better UX and a wider blast radius. Recommendation: default-on for
   reads, explicit for writes.
3. **Is embedding-based search acceptable given Local/SQLite parity?** If Local can
   ship a degraded lexical-only mode, `pgvector` on Cloud is straightforward.
   If strict parity is required, the answer is better lexical retrieval plus
   agent-side query fan-out.
4. **Should answering a blocked agent from chat be re-enabled?** It was removed on
   purpose in favour of Latch observation. A chat interface that can *see* a blocked
   agent but not unblock it is a worse experience than one that can do neither —
   this needs a deliberate answer, not a default.
5. **How much should the chat interface be allowed to mutate without confirmation?**
   This determines whether Phase 4's propose-then-confirm is the general pattern for
   all writes or only for bulk creation.

---

## Suggested follow-up objectives

1. Fix search relevance aggregation and add display-id short-circuit *(small, unblocks everything)*
2. Extend the search result DTO with project name, relevance, snippet, and match kind
3. Add `overlord_search_objectives`
4. Add cross-workspace search with per-workspace RBAC + `overlord_list_workspaces`
5. Add `overlord_launch_objective` with execution-target/agent discovery
6. Add `overlord_update_mission` (status, priority, assignee, tags, due date)
7. Widen the search index (mission text, artifacts, deliveries, rationales, project names)
8. Add an agent-request read tool so chat can surface blocked agents (answering is a separate product decision)
9. Design the propose-then-confirm bulk authoring flow
