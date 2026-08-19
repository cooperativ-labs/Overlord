# Cross-workspace access as a first-class model

Origin: **coo:781** review follow-up · Drafted 2026-08-19 · Contract v92

## The headline

**The data model is already cross-workspace. One piece of request state is not.**

Overlord does not need a new addressing scheme, a workspace list in the token, or a
redesign of RBAC. Almost every layer already does the right thing:

| Layer | Already cross-workspace? | Evidence |
| --- | --- | --- |
| **Identifiers** | **Yes** | `displayId = ${workspace.slug}:${sequence}` (`missions.ts:619`). Workspace slugs are unique per organization, so `coo:781` **names its own workspace**. Addresses are self-locating |
| **RBAC** | **Yes** | `actorCan(action, { workspaceId, workspaceUserId })` (`backend/rbac.ts:58`) takes the workspace as an explicit argument. The authorizer has no ambient state |
| **Entity-addressed protocol ops** | **Yes** | `protocolWorkspaceId` (`backend/protocol.ts:95`) derives the workspace from the referenced execution-request / session / objective / mission / project, constrained to `workspace_id IN (caller's memberships)`, and 409s on genuine ambiguity |
| **Parentless writes** | **Yes** | `resolveParentlessWorkspace` (`backend/protocol.ts:584`) returns `workspace_selection_required` listing candidates instead of defaulting |
| **Cross-workspace reads** | **Proven twice** | `listWorkspaceMyMissions` (`repository.ts:6188`) authorizes by `(workspace_id, workspace_user_id)` **pairs**; the agent-request inbox (`agent-session-routes.ts:632`) enumerates memberships, authorizes each, and tolerates per-workspace denials |
| **Request scoping** | **No** | `requestContext().activeWorkspace` — a single value, re-derived every request as the caller's **oldest** membership |

That last row is the entire problem. `activeWorkspace` is a **UI concept — the
workspace switcher — that leaked into the auth layer** and became the ambient default
for 48 `getActiveWorkspaceId()` call sites. Everything downstream inherited a
single-tenant assumption that the schema never had.

Note what this means practically: attaching to `coo:781` from an agent pod already
works regardless of which workspace is "active", because `protocolWorkspaceId` derives
it from the address. Searching for `coo:781` does not, because search has no address to
derive from and falls back to the ambient default.

---

## Answering the three questions

### 1. Should the login token include all of the user's workspaces?

**No. Never put the resource set in the token.**

This is the one place where the intuitive answer is the wrong one. Reasons, in order
of severity:

- **Tokens outlive membership.** OAuth MCP tokens live 90 days
  (`USER_TOKEN_TTL_DAYS`). Memberships change daily — people join workspaces, leave
  workspaces, get their role downgraded. A workspace list baked into a token is stale
  the moment it is minted. Stale in the permissive direction is a security bug; stale
  in the restrictive direction is a support ticket.
- **Revocation must be immediate.** Removing someone from a workspace has to cut off
  access *now*, not at next token refresh. That is only true if authorization reads
  `workspace_users` — the system of record — at request time.
- **It duplicates state that already has an owner.** Two sources of truth for "who can
  see what" will diverge, and the one in the token is the one nobody audits.

A token should carry **identity plus a capability ceiling** — which
`user_tokens` + `user_token_scopes` already do correctly via `mission_lifecycle`
scope grants. It should not carry the resource set.

> **Corollary — fix the existing divergence.** `user_tokens.workspace_id` is populated
> at creation (`repository.ts:7656`) and returned by `verifyUserToken`
> (`auth/src/auth/token.ts:145`), then **discarded** by `backend/auth.ts:210-214`,
> which re-derives from the profile's oldest membership. Today the token records
> workspace B while its requests run against workspace A. This is the P0-1 bug from
> the coo:781 review and it should be resolved as part of this work, not alongside it.

### 2. Should MCP authentication let the user select workspaces?

**Yes — but as a narrowing allowlist, never as the grant.**

The distinction is the whole design:

```
effective access  =  consented workspaces  ∩  live memberships  ∩  token scope grants
```

Consent **narrows**; it never widens. This is the standard pattern — GitHub App
repository selection, Slack per-workspace install, Google granular scopes — and it
gives exactly the properties we want:

- Removed from a workspace → access dies immediately, allowlist notwithstanding.
- Added to a new workspace → it does **not** silently appear in an existing MCP
  connection. Consent was never given for it. This is the property a
  membership-blind design gets wrong, and it is the one users notice.
- The consent screen becomes honest. Today it says "Overlord" and grants, in practice,
  whichever workspace happens to be oldest. After, it lists what the connection can
  actually reach.

Offer an explicit **"All current and future workspaces"** option alongside
per-workspace selection (GitHub's "All repositories" affordance). Users with one
workspace should never see a picker at all — resolve silently when
`memberships.length === 1`, exactly as `resolveParentlessWorkspace` already does.

**Fail closed:** an empty allowlist with `all_workspaces = false` means *deny*, not
*all*. This matters because it is the state a partially-migrated legacy token lands in.

### 3. What is the best practice here?

Three rules, in priority order:

1. **Authorization is evaluated per request against live membership.** Tokens
   authenticate; they do not authorize resource sets.
2. **The workspace is a property of the operand, not of the session.** Derive it from
   the entity being addressed. Only ask when there is genuinely nothing to derive from.
3. **Reads fan out, writes name their target.** A read across N workspaces is a union
   with per-workspace authorization. A write must be unambiguous or it must ask.

---

## The data-structure change

### Request context: replace the singleton with a set

```ts
// today — backend/db.ts:268
activeWorkspace: ActiveWorkspace | null;

// proposed
authorizedWorkspaces: Array<{ workspaceId: string; workspaceUserId: string }>;  // live, resolved once per request
resolvedWorkspace: ActiveWorkspace | null;                                      // per-operation, derived from the operand
```

`getActiveWorkspace()` stops meaning "the user's workspace" and starts meaning "the
workspace **this operation** resolved to". The 48 existing call sites keep working
unchanged for entity-addressed operations — `protocolWorkspaceId` already sets exactly
this. Only parentless operations need new code.

`authorizedWorkspaces` is the `(workspace_id, workspace_user_id)` pair list that
`listWorkspaceMyMissions` already builds by hand. Lifting it into request context makes
it available to search, the activity feed, and every future fan-out read, instead of
each one re-deriving it.

### Schema: one additive table, one column retired

```sql
-- Consent allowlist for a token. NOT a grant: it can only narrow live membership.
CREATE TABLE user_token_workspaces (
  token_id     text NOT NULL REFERENCES user_tokens (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (token_id, workspace_id)
);

ALTER TABLE user_tokens ADD COLUMN all_workspaces boolean NOT NULL DEFAULT false;
```

- **Retire `user_tokens.workspace_id`** from the enforcement path. It is currently
  written, read, and ignored. Either migrate it into `user_token_workspaces` as a
  single-row allowlist (the conservative migration — existing tokens keep exactly the
  access they were consented for) or drop it. Do not leave it half-wired.
- **Retire `user_tokens.workspace_user_id`** from enforcement for the same reason: a
  single membership id cannot represent a multi-workspace token. Attribution must
  resolve per workspace, and `resolveRequestActorForWorkspace` (`backend/db.ts:201`)
  already does this correctly.

Note the mirror of both migrations is needed in `database/sqlite/migrations` — Local
edition parity is a contract requirement.

### The operation taxonomy

This is the framing worth encoding in the contract, because it makes the correct
behavior of any new endpoint obvious:

| Kind | Example | Workspace resolution | Status |
| --- | --- | --- | --- |
| **Entity-addressed** | `load coo:781`, `launch coo:781.6zvj` | Derived from the entity, intersected with the authorized set | **Already correct** |
| **Parentless read** | search, my work, activity feed, agent requests | Fan out over the authorized set; **every result carries its `workspaceId` + `workspaceName`** | Two precedents, no general mechanism |
| **Parentless write** | create mission, create project | Must name one workspace; `workspace_selection_required` when ambiguous | **Already correct** |

The one non-obvious requirement is in the middle row: a fan-out read **must** label
every result with its workspace. Otherwise the caller — especially an LLM — cannot
disambiguate two same-named things, and cannot tell the user where the thing lives.
This is the same defect as P1-8 in the coo:781 review, one level up.

---

## Where the boundary should sit: the organization

Workspaces are not the outermost boundary — `workspaces.organization_id` is, and
workspace slugs are unique **per organization**
(`idx_workspaces_organization_slug`). Two consequences:

- **Within an organization, mission display ids are globally unambiguous.** `coo:781`
  names exactly one mission org-wide. This is why `protocolWorkspaceId`'s
  cross-workspace ambiguity 409 is essentially unreachable inside one org — it exists
  for the cross-org case.
- **Across organizations, they can collide.** Two orgs can each have a `coo` workspace.

So: **free movement across workspaces within an organization; explicit selection across
organizations.** That gives a principled, defensible place to stop fanning out, and it
matches what the product already does — `callerMembershipsInActiveOrganization`
(`repository.ts:6106`) is already the aggregation boundary for My Missions.

> **Related bug, same root cause one level up.** `getActiveOrganizationIdOrNull`
> (`backend/organizations.ts:113`) derives the organization from
> `getActiveWorkspaceIdOrNull()` — the oldest membership. So My Missions is silently
> pinned to the organization of your oldest workspace. Fixing `activeWorkspace` without
> also fixing this just moves the problem up a level.

---

## The mission-move constraint is already enforced, and for the right reason

The requirement that missions must not cross the workspace boundary is already met:
`updateMission` (`repository.ts:5390`) constrains a cross-project move to
`existing.workspace_id`.

Worth documenting *why*, because it means this is not a policy that could later be
relaxed by request:

- `display_id` is `{workspace_slug}:{sequence}`, allocated from a per-workspace
  `mission_sequences` counter.
- `idx_missions_workspace_display_id` makes it unique per workspace.
- Statuses (`workspace_statuses`) are workspace-shared, and `missions.status_id` FKs to
  `(workspace_id, status_id)`.

Moving a mission to another workspace would require **reissuing its display id**,
breaking every external reference to it: git branches, chat links, agent transcripts,
webhook payloads, and every `ovld protocol --mission-id` in someone's shell history.
The boundary is load-bearing on the identifier scheme, not a permission check. Say so
in the contract so nobody tries to "just add a move endpoint" later.

The right product answer for "this belongs in the other workspace" is **clone, with a
link back to the original** — new display id, explicit provenance, original preserved.

---

## Suggested sequencing

0. **Scope the realtime broadcast to the subscriber's workspaces** (Q4). Pre-existing
   cross-tenant metadata leak in Cloud, independent of everything below, and the surface
   that has to answer the same question this design answers. **Now tracked separately as
   mission coo:783** — not part of this work, but should land first.
1. **Fix the token/workspace divergence** — honour `verified.workspaceId` or retire the
   column. Small, independent, and it is a live consent bug today.
2. **Lift `authorizedWorkspaces` into request context** — resolved once per request from
   `callerWorkspaceMemberships`, with role loading batched into a single
   `(workspace_id, workspace_user_id) IN (...)` query (Q7). No behavior change yet.
   Pure groundwork.
3. **Re-point `getActiveOrganizationIdOrNull`** off the oldest-membership default.
4. **Convert the parentless reads to fan-out**, in this order: search missions
   (unblocks the NLP work), my-missions, activity feed. Each result gains
   `workspaceId` + `workspaceName`.
5. **Add `user_token_workspaces` + `all_workspaces`**, with the conservative migration
   from `user_tokens.workspace_id`.
6. **Add workspace selection to the OAuth approval page**, defaulting to the single
   workspace when there is only one.
7. **Expose it over MCP** — `overlord_list_workspaces`, plus `workspaceId` /
   `workspaceIds` on the search tools.
7a. **Add the Q5 search filters** — project, date range, resource — to the service layer,
   the MCP search tools, the CLI, and a filter footer that appears when the search bar is
   focused. These must land *after* the concurrent project-scoped mission statuses work
   (contract v93), which already changed how status filtering is addressed: status
   *types* stay workspace-invariant while status *names* are now project-defined.
8. **Document the taxonomy in `CONTRACT.md`** so new endpoints inherit the rule instead
   of re-deriving it.

Steps 1–4 deliver the cross-workspace search the NLP interface needs. Steps 5–7 are the
consent story and can ship after.

### Contract impact

- **`activeWorkspace` → `authorizedWorkspaces`** touches the request-context shape that
  48 call sites read. Additive if `getActiveWorkspace()` keeps working for
  entity-addressed operations, which it should.
- **Fan-out read DTOs gain `workspaceId` / `workspaceName`** — additive.
- **`user_token_workspaces`** — new table in both Postgres and SQLite migrations, plus a
  backfill.
- **Cross-workspace reads widen what one credential can see.** This is the change that
  warrants a dedicated security-audit pass: authorization must be per-workspace via
  `requireWorkspacePermission`, tolerating per-workspace denial (the agent-request inbox
  pattern), and must never fall back to the request's ambient default.

## Decisions

All open questions were answered on 2026-08-19. Q4 was spun out to its own mission.
The original question text and reasoning are preserved below under *Resolved questions*.

| # | Decision |
| --- | --- |
| **Q1** | **The organization is the hard stop.** No cross-organization fan-out. Display ids are unambiguous within an org and can collide across orgs |
| **Q2** | **Per-workspace limit = global cap ÷ number of workspaces in scope**, evenly divided (cap 30 across 3 workspaces → 10 each) |
| **Q3** | **Grandfather existing tokens to their recorded `user_tokens.workspace_id`** |
| **Q4** | **Spun out as its own mission — coo:783.** Pre-existing, independent, fix ahead of this work |
| **Q5** | **Do not normalize ranking. Add filters instead**, exposed to agents and users alike — project (default all), resource (default all), date range — with a filter footer that appears when the search bar is focused, and the same filters on the MCP and CLI search tools. **Revised 2026-08-19: recency is a ranking signal, not an eligibility gate** — see *What constrains results* below |
| **Q6** | **Remove `setActiveWorkspace`; replace with an explicit query parameter.** The frontend shows each workspace separately; `/inbox` and `/user` aggregate, as do several all-projects-across-workspaces lists. **On create, the workspace is derived from the project** |
| **Q7** | **Batching is fine** provided it matches the Q6 usage pattern |

### What Q5 changes about the design

Filters replace ranking normalization as the answer to "a big workspace crowds out a
small one". This is a better answer for the NLP interface than score tuning, because a
filter is something the agent can *reason about and re-issue*, whereas a ranking tweak is
invisible to it. Three consequences to design for:

- **The filters must be first-class on the MCP and CLI search tools**, not UI-only, so an
  agent translating a vague description can choose them deliberately — and can widen them
  when a narrow search comes back empty.
- **`resource` is not a mission column.** `resource_key` lives on `objectives`
  (`packages/core/types/db.ts:846`) and `project_resources`, never on `missions`. A
  resource filter on mission search therefore needs either a join through objectives or a
  denormalized `resource_key` on `search_documents`, which today carries no such column.
- **Resource keys are unique per project, not globally** (`idx` on
  `project_resources (project_id, resource_key)`), so keys like `primary` exist in every
  project. A cross-workspace resource filter matches by *key name* across projects, which
  is probably what a user means ("show me the mobile work") but should be stated
  explicitly rather than assumed.

### What constrains results *(Q5, revised 2026-08-19)*

The original Q5 answer set a default date range of the last 20 days. Measured against
this workspace's 699 missions, that default is wrong, and the more useful finding is
that the *column* matters more than the number:

| Window | Excluded by `created_at` | Excluded by `updated_at` |
| --- | --- | --- |
| 20 days | **66%** | 17% |
| 30 days | 45% | 6% |
| 60 days | 0% | 0% |

`created_at` p50 is 27 days; `updated_at` p50 is 0 days. Caveat: this workspace is 51
days old, and the sample is one workspace — the oldest-membership default, which is the
bug this design fixes.

Three arguments against a date default, in increasing order of importance:

1. **The two columns age differently.** `updated_at` is self-normalizing: it tracks
   activity rate, so the proportion it excludes stays roughly stable as the corpus grows.
   `created_at` is a window on a growing corpus, so it becomes monotonically more
   destructive — a 20-day `created_at` window that hides 66% today would hide ~95% in a
   year.
2. **A date filter does not solve the problem Q5 was asked about.** Q5 was "a big
   workspace crowds out a small one". A date window narrows *volume* uniformly across
   workspaces; it does not touch *skew*. The per-workspace quota (Q2) is the fairness
   lever. The date default is doing a different job than the one it was hired for.
3. **The error costs are asymmetric.** A too-wide result set is recoverable — with
   relevance scores, snippets, and project names in the DTO the agent can filter it. A
   too-narrow one is not: empty is indistinguishable from "does not exist", and the agent
   will confidently report that no such mission exists. On an NL surface, false negatives
   cost far more than false positives.

**Decision: recency becomes a ranking signal, not an eligibility gate.** A recency boost
in the score leads with fresh work without ever making old work invisible, which serves
the board and the agent equally. The date filter stays available as an explicit choice
for both users and agents.

**What constrains results, in priority order:**

1. **A relevance floor.** The genuinely missing piece, and the correct primary constraint
   for a search. Today's OR-combined prefix matching returns *everything* — a measured
   vague query returned 100% of the workspace with no threshold.
2. **Per-workspace quota** (Q2) — the fairness lever.
3. **Global cap** — context economy; roughly 25-50 rows.
4. **Recency boost** — ordering, never eligibility.
5. **Explicit filters** — when the user or agent actually asks.

The governing principle: **defaults should order, not hide.** This is also why
`complete`/`cancelled` should not be excluded by default, tempting as it is — "the
mission where we decided not to use Redis" is almost certainly complete.

**The change that de-risks the whole question:** return `appliedFilters` and
`totalMatchedBeforeLimit` in the search response. The hazard was never the *value* of a
default but the *invisibility* of it. An agent that can see "3 of 47 shown, date filter
applied" widens on its own, and the choice of default stops being high-stakes.

**If a date default is kept anyway:** put it on `updated_at`, not `created_at`, and use
90 days — it excludes nothing today, stays stable as the corpus grows, and still bounds
a pathological query.

### What Q6 changes about the design

Deriving the workspace from the project on create is a real simplification: it removes
workspace selection from the common write path entirely. `resolveParentlessWorkspace` is
then needed only for genuinely parentless creates — `create-project` itself and
account-owned inbox items — rather than for every mission write.

Note the current frontend state, which makes the `setActiveWorkspace` removal smaller
than it looks: `webapp/web/lib/api-base.ts` defines `readActiveWorkspaceId()` and it is
**never called**. The webapp persists an active workspace id to `localStorage`
(`persistActiveWorkspaceId`, three call sites in `queries.ts`) and never transmits it.
So there is no durable workspace switcher wired through to the backend today — dead code
on the client, oldest-membership default on the server.

---

## Resolved questions

The original questions and reasoning, retained for the rationale behind each decision.

### Q1 · Is cross-organization access in scope, or is the organization the hard stop?
Recommendation: **hard stop at the organization**, with explicit selection to switch.
Display ids are unambiguous within an org and can collide across orgs, so a cross-org
fan-out reintroduces the ambiguity the address scheme currently avoids.

### Q2 · Should a fan-out read cap results per workspace or globally?
A global `limit: 25` across 5 workspaces can silently starve four of them.
Recommendation: **per-workspace sub-limit plus a global cap, and an explicit truncation
report** so the caller knows coverage was incomplete rather than assuming it saw
everything.

### Q3 · How are existing tokens grandfathered?
Recommendation: **to their recorded `user_tokens.workspace_id`** — the conservative
reading of what the user consented to, even though it was never enforced. Migrating
them to "all workspaces" would silently widen access that nobody approved.

### Q4 · What does realtime subscribe to once reads are cross-workspace? *(blocking)*

This is the gap the original draft missed, and it turns out to matter twice over.

`streamRealtime` (`backend/index.ts:1179`) authorizes `PROJECT_READ` against
`getActiveWorkspaceId()` — the ambient default — and then calls
`realtime.addClient(res)` with **no per-client scoping**. `SELECT_CHANGES_SQL`
(`backend/realtime.ts:21`) reads `entity_changes` with **no `workspace_id` predicate**,
and `broadcast()` writes to **every connected client**:

```ts
private broadcast(event: string, data: unknown): void {
  for (const res of this.clients) this.send(res, event, data);
}
```

So today every authenticated SSE subscriber receives change metadata for **every
workspace in the deployment**: `entity_type`, `entity_id`, `operation`, `project_id`,
`mission_id`, `objective_id`, `changed_fields_json`, `occurred_at`. That is ids,
changed *field names*, and timing — not field values, and not titles or instruction
text. It is metadata rather than content, but in Overlord Cloud it is still
cross-tenant metadata leakage (the existence, shape, and activity pattern of other
tenants' work). Overlord Local is single-tenant, so it is unaffected.

This is **pre-existing and independent of this design** — it should be fixed on its own
merits and probably ahead of everything else here. But it is also squarely load-bearing
on this work: realtime is precisely the surface that has to answer "which workspaces'
changes does this client see?", and the current answer is "all of them, regardless of
membership."

Recommendation: filter `entity_changes` by the subscriber's `authorizedWorkspaces` at
send time (the same set this design introduces), and treat it as a security fix with its
own objective rather than folding it into the fan-out work.

### Q5 · How is ranking kept fair across workspaces of very different sizes?
`bm25()` / `ts_rank()` scores are computed per document against the whole index, so
they merge validly across workspaces — but a workspace with 10,000 missions will
crowd out one with 20 long before any limit truncates. This is distinct from Q2: Q2 is
about how many results survive, Q5 is about which ones rank. It bites hardest on
exactly the NLP use case, where a vague query already returns a wide, weakly-separated
set. Recommendation: measure first on real data; consider per-workspace score
normalization or interleaving only if the naive merge demonstrably starves small
workspaces.

### Q6 · What happens to the webapp's "current workspace" concept?
If `activeWorkspace` stops being request state, the mission board still needs to show
one workspace at a time. Does that become a client-side filter, an explicit query
parameter on board reads, or a stored per-user preference? Note there is no durable
switcher today — `setActiveWorkspace` is only called from a handful of
workspace-management flows, and the active workspace is otherwise re-derived per request
as the oldest membership. Recommendation: **an explicit query parameter on
board/project reads**, so the server never guesses and the URL is shareable.

### Q7 · What is the per-request cost of per-workspace authorization?
`loadActorRoles` (`backend/rbac.ts:21`) is one uncached DB round trip per
`(workspaceId, workspaceUserId)` pair, and the agent-request inbox pattern calls
`requireWorkspacePermission` in a loop — 10 workspaces means 10 role queries per
request. Resolving `authorizedWorkspaces` once per request (as proposed) fixes the
repetition within a request but not the per-workspace query. Recommendation: batch role
loading into one `WHERE (workspace_id, workspace_user_id) IN (...)` query when the
authorized set is built, and memoize it in request context. Worth doing as part of step
2 rather than after, since every fan-out read depends on it.
