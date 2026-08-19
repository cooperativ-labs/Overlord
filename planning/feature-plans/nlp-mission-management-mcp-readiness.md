# NLP mission-management interface — MCP readiness review

Mission: **coo:781** · Objective: **coo:781.6zvj** · Reviewed 2026-08-19 · Contract v92
Revision 2 — 2026-08-19, objective **coo:781.v8j3** · reconciled against contract **v95**

> **Read this first.** Six of the thirteen findings below are no longer this
> mission's work. They were spun out into **coo:784** (cross-workspace access) and
> **coo:783** (realtime feed scoping), and one more was fixed outright by the
> project-scoped statuses work in contract v93. The findings are **kept, not
> deleted** — the measurements in them are the evidence those objectives were
> scoped from — but each now carries a status banner naming where it went.
> See [Where each finding went](#where-each-finding-went).

## Verdict

**The MCP is not yet robust enough to back the proposed chat interface** — but
two of the three blocking classes are now funded work with objectives attached,
not open problems. It is a solid *agent-execution* surface — attach, update,
deliver, record work — because that is what it was built for. It is a weak
*product-management* surface. The three classes of problem, with their current
owners:

1. **Cross-workspace search is architecturally impossible today**, not merely
   unimplemented. Every MCP request resolves to exactly one workspace: the
   caller's *oldest* membership — even though the token itself records the
   workspace that was active at approval, which auth then discards.
   → **Now coo:784.** Contract v95 has already settled the model; four objectives
   implement it. Not this mission's work any more.
2. **Search relevance fails on realistic vague input** in ways that are measured,
   not hypothetical — including a ranking bug where mission chatter beats an exact
   title match, and a display-id lookup that returns the whole workspace.
   → **Now coo:784.k8xe**, which was scoped directly from the measurements below.
3. **The verbs the chat interface needs mostly do not exist over MCP.** You cannot
   launch, schedule, re-status, re-assign, tag, or cancel anything from MCP. Those
   all exist in REST; none are exposed. Most importantly, *"begin executing this
   objective" — the headline interaction in the objective — has no path at all.*
   → **Still coo:781, and now this mission's centre of gravity.** Neither spun-out
   mission touches it.

That reshapes the mission rather than shrinking it. What remains here is the
*product* surface — the verbs, the scheduling concept, the proposal workflow, and
the index widening coo:784 explicitly declined — sitting on top of a retrieval
layer somebody else is now fixing.

None of it is deep. The service layer already does the hard parts
(`launchObjective` resolves its own workspace and checks membership;
`createProjectFromProtocol` already demonstrates multi-workspace resolution).
The work is mostly surfacing.

### Where each finding went

| Finding | Owner now | Vehicle |
| --- | --- | --- |
| P0-1 · cross-workspace search | **coo:784** | `.0jkm` token consent schema · `.59fh` `authorizedWorkspaces` request context · `.hcve` OAuth consent + workspace discovery · `.j6tj` fan-out |
| P0-2 · no objective search | **coo:784.j6tj** | fan-out covers missions *and* objectives |
| P0-3 · missing verbs | **coo:781** | — untouched by either spin-out |
| P0-4 · no scheduling concept | **coo:781** | — product decision still open |
| P1-5 · `SUM` aggregation | **coo:784.k8xe** | `MAX` + bounded corroboration |
| P1-6 · no relevance floor, no fallback signal | **coo:784.k8xe** | floor + explicit fallback mode + `totalMatchedBeforeLimit` |
| P1-7 · display-id lookup | **coo:784.k8xe** | exact display-id short-circuit |
| P1-8 · undisambiguatable results | **coo:784.k8xe** | snippets, matched terms, project/workspace labels |
| P1-9 · status filter matches nothing | **shipped** | contract v93 (verified below) |
| P2-10 · index too narrow | **coo:781** | coo:784.j6tj *explicitly declined* denormalization |
| P2-11 · no fuzzy/semantic | **coo:781** | |
| P2-12 · awkward mission creation | **coo:781** | |
| P2-13 · `resolve_project` reads server FS | **coo:781** | |

**coo:783** (realtime entity-change feed scoping) came out of this review's
follow-up discussion rather than out of a numbered finding. Its first objective
has delivered; its follow-up `.qb33` will refactor onto `authorizedWorkspaces`
once coo:784.59fh lands. Nothing in it blocks the chat interface.

---

## What works today

The hosted MCP (`mcp/tool-catalog.ts`) exposes **15 tools** over **27** protocol
subcommands (14 at first review; `overlord_list_project_statuses` landed with
contract v93):

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

> **Status: moved to coo:784.** Kept here because it is the motivating evidence.
> Contract **v95** has settled the model: OAuth tokens bind to exactly one
> organization with either an explicit workspace allowlist or all-current-and-future
> consent, always intersected with live membership and per-workspace RBAC; request
> context resolves an immutable `authorizedWorkspaces` set by operation taxonomy;
> and *"no route may select the oldest membership."* Implementation is `.0jkm`
> (consent schema) → `.59fh` (request context) → `.hcve` (consent UI + discovery)
> → `.j6tj` (search fan-out).
>
> **One recommendation below is superseded.** This finding argued for honouring
> `verified.workspaceId` so the stamped and enforced workspaces stop diverging.
> coo:784 goes the other way and **retires** the singleton `workspace_id` /
> `workspace_user_id` fields from the enforcement path entirely — a single
> membership id cannot represent a multi-workspace token. Existing tokens backfill
> to exactly their recorded issuance workspace (the conservative reading of what
> was consented to). The divergence is closed by deleting one side, not by
> reconciling the two.
>
> **Documentation follow-up, retargeted.** Revision 1 recommended correcting
> `mcp/docs/chatgpt-app-publication.md:59` — *"Approval creates a workspace-scoped,
> 90-day `mission_lifecycle` token"* — as simply false. Under v95 it becomes
> **true but incomplete** rather than wrong: the token really will be scoped, to a
> consented workspace set within one organization. So it needs rewording, not
> deletion, and it should be reworded **when coo:784.hcve ships** — editing it now
> would describe behaviour that does not exist yet. Left unedited deliberately;
> flagged to coo:784 rather than fixed here.

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

> **Status: moved to coo:784.j6tj**, whose scope is *"cross-workspace mission and
> objective search fan-out"* — objectives are first-class there, not an add-on.
> The DTO work this finding asks for is coo:784.k8xe.

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
  agent enumerate candidates to offer the user. See Phase 1 step 8 and Open question 6.
- **Answering a blocked agent remotely was deliberately removed.**
  `POST /api/agent-requests/:id/resolve` and `/:id/release` now throw
  `session_controls_gone` (410): *"Harness permission and question prompts are
  presented from Latch observation."* Reading the request inbox still works — and
  already works across workspaces. So "tell the agent to use Postgres" is a
  **product decision to reverse, not a plumbing gap**, and it should be treated as
  such in Phase 1 step 5. *(Renumbered at revision 2; was Phase 3.)*

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

> **Status: moved to coo:784.k8xe**, which specifies *"MAX plus bounded
> corroboration document aggregation"* and a regression fixture at 25 events —
> scoped directly from the measurement below.

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

> **Status: moved to coo:784.k8xe.** Answered more thoroughly than this finding
> proposed: a *meaningful-term coverage relevance floor*, an explicit fallback
> mode, `appliedFilters`, and `totalMatchedBeforeLimit`. The governing principle
> coo:784 adopted is **defaults should order, not hide** — recency became a ranking
> boost rather than an eligibility gate, and complete/cancelled missions stay
> eligible by default, because on an NL surface an empty result is
> indistinguishable from "does not exist".

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

> **Status: moved to coo:784.k8xe** — *"exact display-id short-circuit"*.

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

> **Status: moved to coo:784.k8xe** (snippets, matched terms and kinds,
> project/workspace labels) and **coo:784.j6tj** (per-workspace counts). Note the
> v2 envelope is where these land: `GET /api/missions/search` is **frozen** as its
> v1 array shape, and `GET /api/missions/search/v2` returns
> `{ version: 2, results, appliedFilters, totalMatchedBeforeLimit, workspaceCounts }`.
> That resolves the breaking-change problem this review flagged — by versioning
> rather than by mutating the existing response.

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

> **Status: FIXED, shipped in contract v93** (project-scoped mission statuses).
> Verified end to end at revision 2: `searchMissions` applies the filter
> (`packages/core/service/missions.ts:784`), REST parses a `statusTypes` CSV
> (`backend/index.ts:1606`), the CLI sends it (`cli/src/commands.ts:1702`), and
> `overlord_search_missions` now documents the parameter as status **types**, not
> project-defined names.
>
> The remedy proposed below is also superseded: a workspace-level
> `overlord_list_workspace_statuses` is the wrong shape now, because statuses are
> **project**-scoped as of v93 — two projects in one workspace can label the same
> lifecycle differently. The shipped tool is `overlord_list_project_statuses`, and
> it is already in the catalog. Nothing left to do.

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

> **Status: stays with coo:781 — and this is a deliberate hand-back, not an
> oversight.** coo:784.j6tj explicitly chose to *"use existing `search_documents`
> `workspace_id`/`project_id` columns plus joins and an objectives `EXISTS` filter
> rather than premature name/resource denormalization."* So the labels and filters
> coo:784 needs are resolved by join, and the index itself is left unwidened.
> Indexing `constraints_text`, `acceptance_criteria_text`, artifact content,
> delivery summaries, and change rationales — the *coverage* problem, distinct from
> the *labelling* problem — is therefore still ours, and still the largest single
> chunk of schema work in this plan.

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

**Revised at revision 2.** The original plan had four phases. Phases 1 and 2 —
search quality and cross-workspace — are now coo:784's, so they are recorded here
as dependencies rather than as work. What is left is renumbered and reordered:
the verbs come first, because they are both the highest-value item in the review
and the only part of it nobody else is building.

### Phase 0 — dependencies (not this mission's work)

Tracked so the sequencing is legible, not to be executed here.

| Was | Now | Notes |
| --- | --- | --- |
| Steps 1–4, 6 — relevance, display-id short-circuit, result DTO, `{ results, mode }` envelope | **coo:784.k8xe** | delivered as the v2 envelope; see P1-8 banner |
| Step 5 — `overlord_search_objectives` | **coo:784.j6tj** | |
| Step 8 — status vocabulary | **shipped (v93)** | `overlord_list_project_statuses` |
| Steps 9–11 — list workspaces, `workspaceIds`, explicit writes | **coo:784.hcve / .knyf** | discovery service + CLI/MCP surfaces |
| Step 12 — honour `verified.workspaceId` | **superseded** | coo:784 retires the column from enforcement instead — see P0-1 banner |
| Step 7 — index widening | **stays here** → Phase 2 | coo:784.j6tj declined denormalization |

**Blocking order.** Phase 1 below does *not* depend on any of it — the verbs are
orthogonal to retrieval and can start immediately. Phase 3 (`propose_missions`)
*does* depend on coo:784.k8xe, because "similar existing work" is only trustworthy
once the relevance floor and exact-match precedence exist; proposing against
today's OR-matching search would surface noise as duplicates.

### Phase 1 — the missing verbs (P0-3, P0-4, P2-12) · *now the critical path*

1. `overlord_launch_objective` — wraps `launchObjective`. **The highest-value single
   addition in this review**, and the one interaction in the objective statement
   ("asking the agent to begin executing a certain objective") that has no path at
   all today. Needs an agent key and optional execution target, so it also needs
   `overlord_list_execution_targets` and an agent-catalog read.
2. `overlord_update_mission` — status, priority, assignee, tags, due date, project move.
   Status must be addressed by **type**, not by project-defined name (v93); resolve
   the target status through the mission's own project.
3. `overlord_schedule_mission` — recurrence, wrapping `PUT /api/missions/:id/schedule`.
   Gate on the P0-4 decision first.
4. `overlord_list_my_work` — wraps `my-missions` + `activity-feed`. Both are already
   cross-workspace by membership, so this one benefits from coo:784 but is not
   blocked by it.
5. `overlord_list_agent_requests` — surface "the agent is waiting on you" in chat.
   The read is safe and already cross-workspace. **Answering** from chat is a
   separate decision: it was intentionally removed (410 `session_controls_gone`,
   prompts now come from Latch observation), so re-introducing it needs product
   sign-off first. Recommend shipping the read now and treating the answer path
   as its own scoped question — it is the interaction that would make the chat
   interface feel *alive* rather than like a form, but it reverses a deliberate call.
6. `overlord_cancel_mission` (soft delete / cancel status). Mark `destructiveHint: true`
   — it would be the first tool on the surface that needs it.
7. Let `overlord_create_mission` take an objectives **array**.
8. A project listing read. `overlord_create_mission` requires an explicit `projectId`
   and nothing lets the agent enumerate candidates to offer the user. coo:784.knyf
   adds *workspace* discovery; project enumeration within those workspaces is still
   missing, and the two should be designed together to avoid two half-answers.

### Phase 2 — widen what is indexed (P2-10, P2-11)

9. Index mission `constraints_text` / `acceptance_criteria_text`, artifact content,
   delivery summaries, and change rationales. This is the coverage half of search,
   which coo:784 does not touch — it improves ranking and labelling over the
   documents that already exist, not the set of documents.
10. Revisit fuzzy/semantic matching (P2-11) **after** coo:784.k8xe lands, not before.
    The relevance floor changes the measurement baseline, so any judgement made now
    about whether fuzzy matching is needed would be made against a search engine
    that no longer exists. Local-edition parity (SQLite) still rules out an
    embeddings-only answer.

### Phase 3 — the proposal workflow (the feedback-dump case)

11. `overlord_propose_missions` — accept a blob of user feedback, return *drafted*
    missions/objectives for confirmation **without writing**, each annotated with
    "similar existing work" from search. Then a confirm step writes them.
    Ask-before-write is what makes bulk creation safe in a chat surface, and it is
    also the only realistic defense against duplicating existing missions.
    **Depends on coo:784.k8xe** for the reason given under Phase 0.

### Contract impact

**Revised at revision 2.** The heaviest item on the original list — the breaking
search-response change — is no longer a risk this mission carries.

- **New MCP tools** (Phase 1) — additive to the `mcp` component's stable surface;
  needs a contract version bump and a `mcp/README.md` reference-spec update.
  Every write verb also needs its `annotations` set honestly: `overlord_cancel_mission`
  would be the first `destructiveHint: true` tool on the surface, and
  `overlord_launch_objective` spends real compute, so it is not `readOnly` even
  though it mutates little.
- **The search-response envelope is no longer breaking, and no longer ours.**
  Contract v95 freezes `GET /api/missions/search` as its v1 array shape and adds
  `GET /api/missions/search/v2` alongside it, with `search-missions --response-version 2`
  on Protocol and a v2 mode on `overlord_search_missions`. The three consumers this
  review flagged — `webapp/web/lib/api.ts`, `backend/index.ts`, and the CLI — are
  unaffected until they opt in. Versioning rather than mutation was the right call
  and it has already been made.
- **`search_documents` schema change** (Phase 2, step 9) — new indexed columns plus
  trigger rewrites in **both** `database/postgres` and `database/sqlite` migrations,
  and a backfill for existing rows. **This is now the largest single chunk of work
  left in this plan**, and it is genuinely ours: coo:784.j6tj resolves labels and
  filters by join specifically to avoid touching the index, which leaves the
  coverage widening unclaimed.
- **Cross-workspace reads** — no longer this mission's contract surface. v95 already
  specifies the authorization model, and coo:784.m4da carries the dedicated
  cross-tenant security audit this review asked for. What remains here is a
  narrower obligation: **every new verb in Phase 1 must derive its workspace from
  its operand and assert membership in `authorizedWorkspaces`**, never read an
  ambient default. v95 states the rule as *"no route may select the oldest
  membership"* — new tools written against the old pattern would silently
  reintroduce the bug coo:784 exists to remove.
- **Status addressing** — post-v93, any verb that sets a status (step 2, step 3's
  `next_status_key`) must resolve it within the mission's **own project** and
  address it by type. A mission's `status_id` must belong to its own project.
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
- "Break this into objectives for me." — *agent-side, but needs a propose-then-confirm mode (Phase 3)*
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

**Revised at revision 2.** Two of the original five are now answered — by coo:784
rather than by this mission — and one has narrowed. Answered questions are kept
with their answers so the reasoning is not lost.

1. **Does "schedule" mean deferred execution or a due date?** (P0-4.) **Still open,
   and now the only blocking product decision left in this mission.** A real
   run-at-time scheduler is a substantially larger build than a date field, and
   `planning/feature-plans/mission-scheduling-engine.md` may already answer this.
   It gates Phase 1 step 3, so it wants an answer before the verbs are built rather
   than during.
2. ~~**Should cross-workspace search be the default, or opt-in?**~~ **Answered by
   contract v95, and more precisely than this question posed it.** It is neither a
   simple default nor a simple opt-in: effective access is OAuth **consent**
   intersected with **live membership** intersected with per-workspace **RBAC**,
   bounded by one organization. Consent is chosen at approval time — either an
   explicit allowlist or all-current-and-future within that org — so the user
   decides the breadth once, and revoking a membership narrows it immediately
   without touching the token. Aggregate parentless reads then fan out across
   whatever that set resolves to. The original recommendation (default-on reads,
   explicit writes) survives intact on the write side: parentless writes derive
   tenancy from their named project, and `resolveParentlessWorkspace` is retained
   only for `create-project` and `register-target`.
3. **Is embedding-based search acceptable given Local/SQLite parity?** **Still open,
   but deliberately deferred** — see Phase 2 step 10. Ask it again after coo:784.k8xe
   lands; the relevance floor and exact-match precedence change the baseline the
   question would be measured against. If Local can ship a degraded lexical-only
   mode, `pgvector` on Cloud is straightforward. If strict parity is required, the
   answer is better lexical retrieval plus agent-side query fan-out.
4. **Should answering a blocked agent from chat be re-enabled?** **Still open.** It
   was removed on purpose in favour of Latch observation. A chat interface that can
   *see* a blocked agent but not unblock it is a worse experience than one that can
   do neither — this needs a deliberate answer, not a default. Unaffected by either
   spin-out.
5. **How much should the chat interface be allowed to mutate without confirmation?**
   **Still open, and it grew.** It was originally a question about bulk creation.
   Now that Phase 1 is the critical path, it governs the whole write surface:
   `overlord_launch_objective` spends real compute and `overlord_cancel_mission` is
   destructive, so the answer determines their `annotations` and whether a
   per-conversation autonomy setting is needed at launch rather than later.
6. **New — does the chat interface need its own project-enumeration read, or does
   coo:784.knyf's workspace discovery cover it?** (Phase 1 step 8.) These are two
   halves of one answer and will be designed badly if designed apart: knowing which
   *workspaces* you may act in does not tell an agent which *projects* to offer when
   `overlord_create_mission` demands an explicit `projectId`. Worth raising on
   coo:784 before `.knyf` is built, rather than bolting a second discovery tool on
   afterwards.

---

## Suggested follow-up objectives

**Revised at revision 2.** The original list is superseded — items 1–4 and 7's
labelling half now belong to coo:784. What remains, in dependency order:

1. **`overlord_launch_objective`** with execution-target and agent-catalog discovery
   *(no dependencies; highest value in the review; start here)*
2. **Answer the scheduling question** (Open question 1) — a decision objective, not
   an implementation one; it gates item 4
3. **`overlord_update_mission`** — status by type resolved in the mission's own
   project, priority, assignee, tags, due date
4. **`overlord_schedule_mission`** — gated on item 2
5. **Read tools for chat context** — `overlord_list_my_work`, `overlord_list_agent_requests`
   (the read only; answering stays a separate product decision), and the project
   enumeration from Open question 6
6. **`overlord_cancel_mission`** and the objectives-array form of `overlord_create_mission`
7. **Widen the search index** — mission constraints/acceptance text, artifact content,
   delivery summaries, change rationales. *Largest remaining chunk; both migration
   trees plus a backfill*
8. **Design the propose-then-confirm bulk authoring flow** *(depends on coo:784.k8xe)*

---

## Revision history

- **Revision 1** — 2026-08-19, objective `coo:781.6zvj`, contract v92. Original
  review: 13 findings, four phases, 45 natural-language interactions.
- **Revision 2** — 2026-08-19, objective `coo:781.v8j3`, contract v95. Reconciled
  against the two missions spun out of revision 1. Six findings reassigned to
  **coo:784**, one (P1-9) confirmed fixed by contract v93 and verified end to end,
  P2-10 confirmed handed *back* to this mission by coo:784.j6tj's explicit decision
  not to denormalize. Plan reduced from four phases to three plus a dependency
  table; the verbs (P0-3) promoted to the critical path. Two open questions
  answered, one added. No product code changed in either revision.
