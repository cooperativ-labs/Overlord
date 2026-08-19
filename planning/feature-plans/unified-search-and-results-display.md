# Unified search across missions, objectives, and deliveries (coo:789.2nnh)

A design proposal, written against contract **v97**. No product code changed;
this document is the deliverable.

> **Revision 2.** The PM settled the four open questions this document
> originally left open, and one answer removed a whole limb of the design:
> **artifacts are dropped** — the index cost is not worth the return. Deliveries
> stay returnable, `notes_text` is indexed for every searcher with no visibility
> mechanism, `matches[]` remains the single source with no parallel id arrays,
> and the MCP tool keeps its name. Part 8 records the decisions and what each
> one cost. The reasoning that produced the original recommendations is left
> standing where it still holds.

The objective asks two questions and one follow-on:

1. Should the **query target** be objectives rather than missions, with the
   surrounding objectives contributing to score the way they do today for
   missions?
2. Or should missions, objectives, **and** artifacts all be returnable, with
   every result carrying enough ancestry (mission id, associated objective ids,
   associated artifact ids) for the caller to navigate to the right thing?
3. If (2), how should the results UI group and badge the kinds?

The answer to (2) is yes in shape and no in membership: the returnable set is
**objectives and deliveries**, not artifacts. Deliveries were not in the
objective's list and turn out to matter more than artifacts did — see Part 8.

Short answer: **(2), but grouped on the server rather than flat on the wire.**
The reasoning below matters more than the conclusion, because the difference
between "flat list the client regroups" and "grouped list the client renders"
is the difference between a UI requirement that is hard and one that is
impossible to get wrong.

---

## Part 1 — What actually exists today

Worth stating precisely, because two of the three things the objective proposes
are already half-built and one is entirely absent.

### The index is three trigger families over three tables

`search_documents` (`database/postgres/migrations/002_initial_core.sql:936`,
mirrored in the SQLite tree at `:918`) has
`entity_type text NOT NULL CHECK (entity_type IN ('mission', 'objective', 'event'))`
and is written **only** by database triggers:

| `entity_type` | Source           | `title` | `body_text`                     |
| ------------- | ---------------- | ------- | ------------------------------- |
| `mission`     | `missions`       | `title` | `title` then `display_id`       |
| `objective`   | `objectives`     | `title` | `title` then `instruction_text` |
| `event`       | `mission_events` | `NULL`  | `summary`                       |

Everything else is invisible to search: `artifacts`, `deliveries`,
`change_rationales`, `shared_context_entries`, and the mission's own
`constraints_text`, `notes_text`, and `output_format_text`. The prior assessment
(`nlp-search-sufficiency-assessment.md`, gap **G**) measured this and it is
unchanged.

### Ranking already aggregates the mission's children

This is the part the objective proposes and which mostly exists.
`searchWorkspaceMissions` (`packages/core/service/mission-search.ts:449`)
matches at the **document** level, then groups every matching document by
`mission_id` and scores the mission as
`max(docScore) + 0.1 * ln(1 + otherDocCount)` — MAX plus bounded corroboration.
Entity kind is weighted in SQL (`mission-search-sql.ts:71`): mission `3.0`,
objective `2.0`, everything else `1.0`. The term-coverage floor
`min(3, max(1, ceil(termCount / 2)))` is applied to the _concatenated_ haystack
of all of a mission's documents, so a query whose terms are spread across two
objectives still clears it.

So "make the query for objectives but let the surrounding objectives contribute
to scoring" is, as a _ranking_ statement, already the implemented behaviour. A
mission whose third objective is a bullseye is ranked by that objective.

### What is missing is the ability to return the child that matched

The aggregation is lossy in exactly one place. `matchedIn` records the _kinds_
of document that matched (`'title' | 'displayId' | 'objective' | 'event'`) and
`snippet` is drawn from the single best-scoring document — but the **identity**
of that document is thrown away. `RankedMissionHit` has no field for it, and the
SQL never selects `entity_id` at all.

That single dropped column is the whole feature. The caller is told "something
in this mission matched, here is a fragment of it" and then has to re-find it:
a human by opening the mission and reading, an agent by calling
`overlord_load_mission_context` and re-scanning. For an agent that is an N+1
over the result set, and it is why `nlp-search-sufficiency-assessment.md`
gap **F** ("no objective-level results") reads as a missing feature rather than
a missing field.

### Surfaces

- REST: `GET /api/missions/search` (frozen v1 array) and
  `GET /api/missions/search/v2` → `SearchMissionsResponseV2`.
- Protocol: `search-missions --response-version 2`, org-bounded fan-out with
  non-redistributed `floor(limit / workspaceCount)` quotas.
- MCP: `overlord_search_missions` (hosted `mcp/server.ts:172`, local shim
  `connectors/core/scripts/overlord-mcp.mjs:134`).
- Webapp: `MissionSearch.tsx` — a debounced combobox rendering
  `title` / `displayId • projectName`. It ignores `snippet`, `matchedIn`,
  `matchedTerms`, and `relevance` entirely; every affordance the ranking work
  added is currently invisible to the human user.

---

## Part 2 — The shape decision

### The two candidate shapes

**A. Flat heterogeneous list** (the objective's second idea as literally
phrased). `results` is a mixed array; each row is a mission, an objective, or a
delivery, self-describing via `entityType`, and every row carries `missionId`
plus arrays of associated child ids. The client groups for display.

**B. Mission-anchored groups.** `results` stays one row per mission — the same
`MissionSearchResultV2` fields — but each row gains a ranked `matches[]` array
holding the objectives and deliveries of that mission that matched, each with
its own id, display id, type, snippet, and score.

### Recommendation: B

Four reasons, in descending order of how much they should decide it.

**1. B can always be flattened; A cannot always be grouped.** Exploding a group
into rows is a one-line `flatMap`. Regrouping a flat list is only correct if the
parent is present — and under a `limit`, it frequently is not. A flat list
sorted by score will routinely return objective `coo:412.k7xm` at rank 4 while
mission `coo:412` fell to rank 31 and got cut. The UI requirement in the
objective — _"the result should show them as children of their respective
missions"_ — then forces the client either to render an orphan or to issue a
second fetch for the parent. Under B that failure mode does not exist by
construction. This asymmetry is the decisive argument.

**2. A dilutes the result set; B does not.** One busy mission with eight
matching objectives and five matching deliveries consumes thirteen of a
`limit: 25` flat list. Every other mission in the organization is crowded out by
a single mission's verbosity. Grouping makes verbosity free: it becomes richer
`matches[]` on one row instead of thirteen rows. It also keeps the existing
cross-workspace quota arithmetic (`allocateWorkspaceSearchLimits`) meaningful —
`limit` continues to mean "how many missions", which is what a per-workspace
quota is trying to allocate fairly.

**3. B keeps `totalMatchedBeforeLimit` honest.** Under A the number is
ambiguous — matched _what_? Under B it stays a mission count, and per-type
document counts are reported alongside it.

**4. B is additive to the existing DTO.** Every v2 field survives unchanged;
`matches[]` and `matchCounts` are new. A is a different response type.

### What B gives up, honestly

The natural phrasing of some queries is entity-listing: _"which objectives are
blocked"_, _"what tasks are queued"_. Under B the answer arrives as "these four
missions have blocked objectives, here they are" rather than a flat list of
seven objectives. For a human that is arguably the better answer — the mission
is the goal the objective serves, which is the point the objective itself makes.
For an agent it is one `flatMap` away. It is a real cost and it is small.

If a real query ever needs the flat wire shape, it is specified in **Part 9 —
Deferred** as `groupBy: 'none'`. It should be added as a _projection_ of the
same pipeline, never as a second pipeline.

### On the parallel id arrays — settled, no arrays

The objective proposes each result carry "array of associated objective ids,
array of associated artifacts". Under B that information is in `matches[]`, and
adding `objectiveIds: string[]` alongside it would duplicate state in a stable
interface — the classic source of the two fields drifting apart. **No parallel
arrays**; `matches` is the single source, with `matchCounts` for pre-truncation
totals.

The ambiguity this avoids is worth stating, because it survives into how
`matches` must be documented: the array holds the **matched** objectives, not
all of the mission's objectives. "All" is unbounded and is what `load-context`
is for. An agent that read an `objectiveIds` field as complete would confidently
answer a question about a mission from a third of its objectives. Naming the
field `matches` makes that misreading much harder, which is the second reason
not to add the arrays.

---

## Part 3 — Proposed design

### 3.1 Indexed vs. returnable

Two distinct vocabularies, and conflating them is the main trap.

| `entityType` | Indexed | Returnable as a match | Why                                               |
| ------------ | ------- | --------------------- | ------------------------------------------------- |
| `mission`    | yes     | yes (as the anchor)   |                                                   |
| `objective`  | yes     | **yes** (new)         | the prompt text; the thing the objective asks for |
| `delivery`   | **new** | **yes** (new)         | summary, follow-ups, `humanActions`               |
| `event`      | yes     | **no**                | corroboration only                                |
| `artifact`   | **no**  | no                    | dropped — see Part 8, decision 1                  |

Events stay corroborating-only deliberately. `mission_events.summary` is largely
machine chatter — _"Runner claimed execution request."_ — and a result row of
that is noise for a human and a token tax for an agent. It still contributes to
the mission's score, which is the job it already does well.

**Artifacts are not indexed at all**, so they contribute nothing — not a result
row, and not corroboration to a mission's score. That is stronger than the
event treatment and it is deliberate: a middle position where artifacts are
indexed but unreturnable would carry the whole index cost (they are the largest
text in the system) to buy only a ranking nudge. The objective floated "perhaps
mission artifacts, to contribute to result"; this is the one part of it not
carried forward. Part 9 records what to revisit if that proves wrong.

### 3.2 Index widening

Three changes to both migration trees (Postgres functions, SQLite triggers):

1. **Widen the CHECK** to `('mission', 'objective', 'event', 'delivery')`.
2. **Delivery trigger family** over `deliveries`:
   `body_text` = `summary`, `verification_summary`, `follow_up_notes`, plus the
   flattened `payload_json -> deliveryReport -> agentReport` string arrays
   (`humanActions`, `knownRisks`, `deferredWork`, `assumptions`,
   and `tradeoffsMade[].decision`). This is what makes
   _"what do I still need to do"_ findable, and it closes **P1-6** from the
   prior assessment in the same pass that **P0-2** makes it readable.
   Soft-delete and workspace-move handling mirrors the objective trigger exactly.
3. **Widen the mission document body** to include `constraints_text`,
   `output_format_text`, and `notes_text` — see 3.3 for what indexing the last
   one commits to.

One trigger family, one CHECK widening, one mission-document rewrite. Backfill
is a single `INSERT ... SELECT` over `deliveries` plus the mission rewrite. The
SQLite tree needs no FTS5 rebuild if the query joins `search_documents` by
`rowid` (see 3.6).

**Body truncation.** Truncate indexed `body_text` at 20,000 characters. With
artifacts dropped this is a guard rather than a live concern — a delivery
summary plus its `agentReport` is rarely close to the cap — but it bounds the
one row type that could grow without limit, and it costs nothing to write into
the trigger now. Consequence to state in the contract: a term appearing only
past character 20,000 of a delivery is not findable.

### 3.3 `notes_text` is searchable by everyone

`missions.notes_text` was added by `20260807120000_mission_notes_and_field_cleanup.sql`
as _"human-only mission notes that never enter agent context."_ This document
originally proposed a `search_documents.visibility` column so that agent
surfaces could not see notes-derived snippets. **That is dropped: `notes_text`
is indexed into the ordinary mission document body and is searchable by every
caller, agents included.**

The decision is the PM's and it is defensible — one index, one code path, and no
class of document that behaves differently depending on who is asking. But it
narrows what that column's original guarantee means, and the narrowing should be
written down rather than discovered later:

> `notes_text` is excluded from **agent context loading** — it does not appear
> in `load-context`, in the launch prompt, or in mission context handed to a
> running agent. It is **not** excluded from search. An agent calling
> `overlord_search_missions` can match on a note and receive a snippet of it.

Anyone typing into the notes field should understand it as private-from-context,
not private-from-agents. If that turns out to be the wrong reading of what users
expect, the fix is the `visibility` column described in Part 9 — additive, and
the retrofit is a backfill plus one predicate on the agent surfaces. What must
not happen is the half-state: indexing notes and _believing_ they are hidden.

### 3.4 Result types (contract, new module `packages/contract/src/search.ts`)

```ts
/** Document kinds that can be returned as a match. `event` is never returnable. */
export type SearchMatchEntityType = 'objective' | 'delivery';

/** Widened from MissionSearchMatchKind. */
export type SearchMatchKind =
  | 'title'
  | 'displayId'
  | 'objective'
  | 'event' // v2 vocabulary, unchanged
  | 'delivery'
  | 'constraints'
  | 'notes'; // new

export interface SearchMatch {
  entityType: SearchMatchEntityType;
  id: string;
  /** `coo:789.2nnh` for objectives; null for deliveries. */
  displayId: string | null;
  /** Objective title, or the delivery's first line. */
  title: string;
  /** Owning objective. Set for objectives (self) and for the objective a delivery closed. */
  objectiveId: string | null;
  /** ObjectiveState for objectives; null otherwise. */
  objectiveState: string | null;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultV3 extends MissionSearchResultV2 {
  /** True when nothing on the mission record itself matched — it anchors children only. */
  anchorOnly: boolean;
  /** Ranked, capped by `matchesPerResult`. */
  matches: SearchMatch[];
  /** Matching document counts for this mission, BEFORE `matchesPerResult` capping. */
  matchCounts: {
    objective: number;
    delivery: number;
    event: number;
  };
}

export interface SearchResponseV3 {
  version: 3;
  results: SearchResultV3[];
  appliedFilters: SearchAppliedFiltersV3; // v2 filters + entityTypes, objectiveStates
  /** Mission groups matched before `limit`. Same meaning as v2. */
  totalMatchedBeforeLimit: number;
  /** Matching documents by type across all eligible missions, before any cap. */
  entityCounts: Record<'mission' | 'objective' | 'delivery' | 'event', number>;
  workspaceCounts: MissionSearchWorkspaceCount[];
  /** True when the per-workspace candidate cap was hit; counts above are lower bounds. */
  truncatedCandidates: boolean;
}
```

`SearchResultV3 extends MissionSearchResultV2` is deliberate: a v2 consumer's
field access continues to typecheck against a v3 result, so the webapp and CLI
can migrate independently of each other.

### 3.5 Ranking

Group ordering is **unchanged from v2** — the same MAX-plus-bounded-corroboration
mission score, now computed over a wider document set. This is the "surrounding
objectives contribute" property the objective asks for, preserved rather than
reinvented.

Child ordering within a group is new:

```
childRelevance = docScore + CONTEXT_WEIGHT * missionScore    // CONTEXT_WEIGHT = 0.15
```

An objective sitting in a strongly-matching mission outranks an equally-scoring
objective in a weak one, but a bullseye child still leads its own group. The
constant mirrors the existing `RECENCY_FUSION_WEIGHT` idiom so there is one
tuning vocabulary rather than two.

Entity weights in `missionSearchDocScoreExpr` extend to:
`mission 3.0`, `objective 2.0`, **`delivery 1.5`**, `event 1.0`.
Deliveries sit below objectives deliberately: a delivery summary is a
retrospective narrative that restates the objective in looser words, so it
matches more broadly and should not outrank the instruction it describes. It
stays above `event` because it is authored rather than emitted.

**The coverage floor stays at mission level.** It is an eligibility gate on the
group's concatenated haystack, exactly as today. It is deliberately _not_
re-applied per child: a child of an eligible mission is returnable if it matched
at all. Re-applying it per document would silently drop the single-term
objective that made the mission eligible in the first place — the most confusing
possible outcome.

**Display-id short-circuit learns objectives.** Today
`parseMissionSearchQuery` strips `.2nnh` from `coo:789.2nnh` and returns the
mission (`mission-search-query.ts:132`). Under v3 it should return the mission
group **with that objective as its single match**, `matchedIn: ['displayId']`.
An agent handed an objective display id then gets the objective back, which is a
small fix with a large ergonomic payoff.

### 3.6 Query mechanics and a real perf caveat

The current query fetches **every** matching document with no `LIMIT` and
aggregates in JavaScript (`mission-search.ts:593`, grouped at `:615`). Widening the index by two
entity types and three text columns materially raises that row count, and it is
already unbounded.

**Proposal: bound the candidate fetch** at `ORDER BY doc_score DESC LIMIT 500`
per workspace. Consequence, and it must be reported rather than hidden: above
the cap, `totalMatchedBeforeLimit` and `entityCounts` become lower bounds, which
is what `truncatedCandidates: boolean` on the envelope is for. Silent truncation
that reads as a complete count is the failure mode the whole `appliedFilters`
design exists to avoid.

**SQLite:** `search_documents_fts` is an external-content FTS5 table carrying
only `title, body_text, mission_id UNINDEXED, entity_type UNINDEXED` — no
`entity_id`, so children cannot be identified from it. Do **not** add a column
(that forces a virtual-table recreate and rebuild). Instead join back:
`JOIN search_documents sd ON sd.rowid = search_documents_fts.rowid`. Postgres
already selects from `search_documents` directly and needs only the extra
columns in the select list.

### 3.7 New filters

Additive to the v2 filter set:

| Filter             | Type                                     | Purpose                                                                                                                    |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `entityTypes`      | `('mission'\|'objective'\|'delivery')[]` | which document kinds may produce a returnable match. Default: all three. `event` is not accepted — it always corroborates. |
| `objectiveStates`  | `ObjectiveState[]`                       | _"which objectives are blocked"_, _"what is queued"_                                                                       |
| `matchesPerResult` | `number`                                 | children per group. Default 3, max 10.                                                                                     |

When `entityTypes` excludes `mission`, the mission row still anchors the group
but is flagged `anchorOnly: true`. The anchor is never omitted — that is the
invariant that makes the UI requirement free.

---

## Part 4 — Surfaces

### 4.1 REST

New: **`GET /api/search/v3`** → `SearchResponseV3`.

Named `/api/search/v3`, not `/api/missions/search/v3`, because it is no longer a
mission-only read. `GET /api/missions/search` stays frozen at v1 and
`/api/missions/search/v2` is untouched — the shipped webapp and every released
CLI are v2 clients.

This is a **new version, not an additive v2 change**, and the reason is
semantic rather than structural: `entityTypes` and the widened index change
_which missions are eligible_. A mission whose only match is a delivery summary
or a `constraints_text` phrase would be returned by v3 and was never returned by
v2. Adding `matches[]` to v2 while
changing v2's result set is the kind of quiet behaviour change the contract's
version discipline exists to prevent.

Same UUID-only `projectIds` discipline as v2.

### 4.2 Protocol and CLI

- `search-missions --response-version 3` gains `--entity-types`,
  `--objective-states`, `--matches-per-result`.
- Add **`search`** as the canonical subcommand name, with `search-missions`
  retained as an alias. The read is no longer mission-only and the name should
  say so; keeping the alias costs one line in
  `cli/src/protocol-help.ts:25` and breaks nothing.

### 4.3 MCP — the first-class customer

**Keep the tool name `overlord_search_missions`.** The honest name would be
`overlord_search`, but a second entry in a 15-tool catalogue is a real cost for
a Flash-class model choosing between tools, and a rename costs recall from
models that have seen the current catalogue. One tool, widened description.

New parameters mirror 3.7. Two agent-specific additions:

**`detail: 'compact' | 'full'` (default `compact`).** MCP results are rendered
into the model's context as JSON text, and a full grouped result for 25 missions
with 3 children each is a large blob for what is often a navigational step.
`compact` caps `matchesPerResult` at 2, drops child `snippet`, and omits
`matchedTerms` and `createdAt`/`updatedAt` on children — enough to name the
objective and its display id, which is all the agent needs before calling
`overlord_load_mission_context`.

**Tool description rewrite.** Currently the description does not tell the agent
any of what it most needs to know. It should state:

- Results are **missions with the matching objectives and deliveries
  attached**; a match's `displayId` (`coo:789.2nnh`) can be passed straight to
  `overlord_load_mission_context`.
- `matches` holds only what **matched**, never the mission's full objective
  list. Use `overlord_load_mission_context` for the whole mission.
- **Artifacts are not indexed.** An artifact's text is unfindable here; read it
  with `overlord_load_mission_context` once the mission is located. Without this
  clause an agent that searches for a plan it published minutes earlier gets an
  empty result and concludes the plan does not exist.
- Compute absolute ISO bounds yourself; there is no relative-date parsing and no
  implicit window.
- Raise `limit` for broad cross-workspace questions; read `workspaceCounts`,
  `entityCounts`, and `truncatedCandidates` before claiming a list is complete.
- `mode: 'fallback'` in `appliedFilters` means the query contributed nothing and
  the results are a recency listing, not an answer.

That last group is **P2-8** from the prior assessment, still the cheapest item
on either document's list and still unshipped.

**What this fixes for the agent.** The N+1 disappears. Today: search → get 8
missions → `load-context` × 8 → scan each for the relevant objective. Under v3:
search → each result already names the matching objectives by display id →
`load-context` on the one or two that matter. For the objective's own example
query — _"follow-up tasks on NYCA missions for the last week"_ — deliveries
being both indexed and returnable means the follow-up text arrives **in the
search result**, which is the step `nlp-search-sufficiency-assessment.md`
recorded as having no path on any agent surface.

---

## Part 5 — Results UI

The current `MissionSearch.tsx` renders `title` and `displayId • projectName`
and discards `snippet`, `matchedIn`, `matchedTerms`, and `relevance`. Grouped
results need a real result list, and the same component can finally show the
evidence the ranking work has been computing all along.

```
┌─ Search: "unified search"  ──────────────────────────────── 6 of 18 ─┐
│                                                                       │
│ ⬢ MISSION   coo:789  Propose unified search across missions…          │
│             execute · Overlord · Cooperativ                           │
│                                                                       │
│    ◆ OBJECTIVE  coo:789.2nnh   Design Unified Search…    [executing]  │
│      …made the query for objectives, not missions, but used the       │
│      surrounding objectives for scoring like we do for missions…      │
│                                                                       │
│    ◆ OBJECTIVE  coo:789.k2p1   Implement grouped results  [future]    │
│      …return objectives and deliveries as children of their mission…  │
│                                                                       │
│    + 2 more matches in this mission                                   │
│ ─────────────────────────────────────────────────────────────────────│
│ ⬢ MISSION   coo:781  Assess NLP search sufficiency                    │
│             review · Overlord · Cooperativ                            │
│                                                                       │
│    ▤ DELIVERY   Assessed search against two named queries              │
│      …the agent cannot reach the data the questions are about…        │
└───────────────────────────────────────────────────────────────────────┘
```

Rules:

- **The mission row is always present**, even when `anchorOnly` — it is the
  group header and it is always selectable, navigating to the mission. This is
  the property server-side grouping buys and it is why the "children under their
  mission" requirement needs no client logic at all.
- **Badges name the kind** — `MISSION`, `OBJECTIVE`, `DELIVERY` — with a
  secondary chip for the objective's state (`executing`, `blocked`, …). Colour
  follows the kind, not the state, so the tiers stay scannable when a column is
  full of one status.
- **Children indent under their mission** and carry the highlighted snippet.
  `matchedTerms` drives the highlight — the field exists and has never been
  rendered.
- **Navigation.** A child navigates to the mission route with the child focused.
  The objective deep link already exists:
  `?objective=coo:789.2nnh`, parsed by
  `webapp/web/lib/mission-panel-search.ts` and validated on three routes in
  `router.tsx`. A delivery navigates to the objective it closed using that same
  parameter, so **no new route parameter is needed** — one of the small savings
  from dropping artifacts, which would have required a `?artifact=<id>` sibling.
- **Keyboard traversal walks the flattened visual order**, parents and children
  alike, one `↑`/`↓` step per visible row. This is why `matchesPerResult`
  matters: an uncapped group makes arrow-key navigation unusable.
- **"+N more matches"** uses `matchCounts` minus rendered, and expands in place.
- **Truncation is visible.** `truncatedCandidates` and the existing
  `workspaceCounts` should surface as a one-line footer, not be silently
  dropped as they are today.

The combobox dropdown keeps the same structure at reduced density (mission row +
at most one child). The full grouped list belongs on the `/search` results page
that `webapp/docs/ui/10-search-and-command-palette.md` already specifies and
which is not yet built.

---

## Part 6 — Contract impact

A **v98** contract bump. Changes required:

1. **New section** for `SearchResponseV3` alongside the existing
   _Mission search versioning_ bullet (`CONTRACT.md:724`): the returnable-vs-
   corroborating entity vocabulary, the grouped shape and the always-present
   anchor invariant, `matches` being matched-only rather than complete, child
   ranking with `CONTEXT_WEIGHT`, the mission-level coverage floor, the bounded
   candidate fetch and `truncatedCandidates`, and the 20,000-character index
   truncation.
2. **Amend the cross-workspace search paragraph** (`CONTRACT.md:160-168`):
   `limit` and the per-workspace quota continue to allocate **mission groups**;
   `matchesPerResult` is a separate, per-group cap and is not divided across
   workspaces.
3. **Database schema contract** (`database/docs/09-database-schema-contract.md`):
   the widened `entity_type` CHECK, the two new trigger families, the new
   and `notes_text` entering the mission document body (3.3), including the
   narrowed reading of that column's human-only guarantee.
4. **Surface registry**: `GET /api/search/v3`; protocol `search` as canonical
   with `search-missions` as alias; `overlord_search_missions` widened.
5. **Explicit non-changes**, worth stating so a future reader does not
   re-litigate them: `GET /api/missions/search` stays v1; `/api/missions/search/v2`
   is unchanged in shape _and_ in result set; `event` documents remain
   unreturnable; `MissionSearchResultV2`'s fields all survive into
   `SearchResultV3`.

Module impact: `database` (both trees), `packages/contract`, `packages/core`
(`mission-search*.ts`), `backend` (`index.ts`, `protocol.ts`, `repository.ts`),
`cli`, `mcp` + `connectors/core` shim, `webapp`. Desktop consumes the webapp
component and needs no independent change: deliveries reuse the existing
`?objective=` shell route.

---

## Part 7 — Phasing

Each phase is independently shippable and independently useful.

| Phase                        | Scope                                                                                                                | Effort | Unblocks                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| **1 — Index**                | CHECK widening, delivery trigger family, mission body widening (incl. `notes_text`), backfill, both trees            | M      | Nothing user-visible; everything below                    |
| **2 — Retrieval + contract** | v3 types, grouped service, child ranking, bounded candidate fetch, `/api/search/v3`, protocol `--response-version 3` | L      | Objectives and deliveries become findable and addressable |
| **3 — Agent surface**        | MCP parameters, `detail` mode, tool-description rewrite, protocol `search` alias                                     | S      | Removes the agent N+1; closes P0-2 / P1-5 / P2-8          |
| **4 — UI**                   | Grouped result list, badges, snippet highlighting, truncation footer, `/search` page                                 | M      | The human half                                            |

Phase 1 dropped from **L** to **M** when artifacts left the plan: one trigger
family instead of two, no new column, and a backfill over `deliveries` rather
than over `deliveries` and every artifact ever written.

Sequencing notes:

- **Phase 3 is small and high-value and should not wait for Phase 4.** Nothing
  in the agent surface depends on the UI, and the MCP tool description alone —
  buildable independently of everything else here — is the highest
  benefit-per-line item on this list.
- Phase 1 is the only phase with a migration and a backfill, and the only one
  that is hard to reverse. It is now a single trigger family plus a mission
  document rewrite, which is small enough to review in one sitting — the reason
  dropping artifacts was worth more than the retrieval it removed.
- Phase 2's bounded candidate fetch is worth landing even if v3 slips: today's
  unbounded fetch is a latent problem that index widening makes acute.

---

## Part 8 — Decisions and risks

### Decisions

The four questions this document originally left open are settled. Recorded with
what each one cost, so a later reader can tell a decision from an oversight.

**1. Artifacts are dropped from the plan.** _Rationale: too heavy on the index
for the return._ This is the largest change to the original proposal and it is
the right call on cost — artifacts carry the largest text in the system, and
they were the reason Phase 1 needed two trigger families, a 20,000-character
truncation policy that actually bit, an `artifactTypes` filter, an
`artifactType` field, a third badge tier, and a `?artifact=` route parameter.
Removing them takes all of that out and moves Phase 1 from L to M.

What it costs, stated plainly so nobody rediscovers it as a bug: a plan document
published with `add-artifact` — including this one — is **not findable by
search**, on any surface, and does not contribute to its mission's ranking
either. Missions whose durable output is an artifact rather than a delivery
summary will rank on their objective text alone. If that becomes the common
shape of Overlord's own work, revisit via Part 9.

**2. Deliveries are returnable.** Confirmed as recommended. This is what makes
_"what do I still need to do"_ answerable in one call and it closes the step
`nlp-search-sufficiency-assessment.md` recorded as having no path on any agent
surface. It also partly offsets decision 1: a delivery summary is often where a
mission's conclusion actually lives.

**3. `notes_text` is indexed for every searcher.** No `visibility` column, no
human-only document class. See 3.3 for what this narrows and for the additive
retrofit if it proves wrong.

**4. No parallel id arrays; the MCP tool keeps its name.** `matches[]` stays the
single source (Part 2), and `overlord_search_missions` is not renamed (4.3).
Both as recommended.

### Risks

- _Index growth._ Deliveries are numerous — roughly one row per delivered
  objective — though each is small. With artifacts out, `search_documents` grows
  by about one row per delivery plus the widened mission documents, which is a
  fraction of what the original plan implied.
- _Ranking regression._ Adding an entity type to an aggregation tuned on three
  will move results. The existing `missions.search-quality.test.ts` is the
  guardrail and should be extended with fixtures that assert v2's ordering is
  preserved when `entityTypes` is restricted to `['mission', 'objective']`.
- _Notes in agent snippets._ Accepted deliberately under decision 3, but it is
  still the item most likely to surprise a user, because nothing in the notes
  field's UI says "an agent can find this". Worth a word of microcopy there when
  Phase 1 lands.
- _Artifacts silently unfindable._ Under decision 1, an agent that searches for
  a plan it published minutes earlier gets nothing back and has no signal that
  artifacts are out of scope. The MCP tool description (4.3) should say so in
  one clause rather than leaving the agent to conclude the plan does not exist.
- _Snippet quality on truncated bodies._ A match past character 20,000 is not
  findable at all, so this is a findability limit rather than a snippet bug —
  but it will read as a snippet bug when someone hits it. Much less likely now
  that deliveries are the only long documents.

---

## Part 9 — Deferred

Specified so that adding them later is a decision rather than a redesign. None
of these are proposed for this pass.

**`groupBy: 'none'` — the flat projection.** `results` becomes a heterogeneous
array of rows, one per matching document, each carrying `entityType`, its own
identity, and full `mission` ancestry inline; sorted by `childRelevance`. It
must be derived by exploding the _same_ grouped candidate set, so scores stay
comparable and the per-mission cap still applies — one mission may not swamp a
flat page any more than it may swamp a grouped one. `totalMatchedBeforeLimit`
switches to a document count in this mode and `appliedFilters` must echo
`groupBy` so the caller can tell which number it is holding. Build it only when
a query genuinely needs it; the grouped shape flattens in one line.

**Artifacts, if decision 1 proves wrong.** The retrofit is one trigger family,
one CHECK value, one `artifactTypes` filter, an `artifactType` field on
`SearchMatch`, a badge tier, and a `?artifact=<id>` route parameter — all
additive, none of it disturbing the grouped shape, because `SearchMatch` was
designed with `entityType` as an open axis. The signal to watch for is users or
agents searching for text they know is in a plan artifact and getting nothing;
the honest tell is a support question phrased as "search is broken" rather than
"artifacts aren't indexed". Indexing artifacts as **corroborating-only** — score
contribution without result rows — was considered and rejected in 3.1: it pays
the full index cost for a ranking nudge.

**`search_documents.visibility`, if decision 3 proves wrong.** A
`text NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'human_only'))` column,
a backfill setting notes documents to `human_only`, and one predicate on the
agent surfaces. Additive; the retrofit is cheap. What is not cheap is the notes
already read by agents in the interval, which is why 3.3 states the narrowed
guarantee rather than leaving it implied.

**`change_rationales` and `shared_context_entries` as indexed documents.**
Both are authored text hanging off a mission and both would slot into the same
trigger pattern. Rationales in particular would make _"which mission touched
`api.ts` and why"_ findable. Left out here purely to keep Phase 1's migration
to a size that can be reviewed in one sitting.

**Semantic / vector retrieval.** Everything above is lexical. `search_documents`
already carries `content_hash` and `metadata_json`, which is where a chunk id
and an embedding reference would live. The grouped result shape is unaffected by
how candidates are retrieved, so this is a Phase 2 internal swap rather than a
contract change — worth noting precisely because it means the shape decision in
Part 2 does not need to anticipate it.

**Assignee and tag filters** (**P1-4** and **P2-7** from
`nlp-search-sufficiency-assessment.md`). Orthogonal to this proposal, still
unshipped, and _"what is on my plate"_ remains the most likely first query any
chat interface receives.

---

## Part 10 — Implementation plan

The phases below are the execution sequence for this proposal. Each is a
separate objective on `coo:789`, and must preserve v1 and v2 search behaviour
until v3 is explicitly requested. Complete them in order: later phases rely on
the index and grouped-retrieval invariants established earlier.

### Phase 1 — Widen and backfill the search index

**Outcome:** both database adapters maintain equivalent, bounded search
documents for missions, objectives, events, and deliveries.

1. Apply the contract-first changes required by Part 6 before implementation:
   bump the contract to v98 and document the new search vocabulary, index
   truncation, notes visibility decision, and v3 compatibility guarantees in
   the contract and schema documentation.
2. Add forward migrations in the Postgres and SQLite migration trees that widen
   `search_documents.entity_type` for `delivery`, update mission document
   bodies with constraints, output format, and notes, and add delivery trigger
   families. Preserve soft-delete and workspace-move behaviour.
3. Cap delivery `body_text` at 20,000 characters and flatten only the specified
   delivery-report fields. Do not index artifacts.
4. Backfill existing mission rewrites and delivery documents idempotently in
   both adapters.
5. Add adapter-level trigger/backfill coverage, including mutations, deletes,
   workspace moves, truncation, and parity between SQLite and Postgres.

**Exit criteria:** a clean database and an upgraded populated database produce
the same search-document state; v1/v2 search remains semantically unchanged;
the contract and schema docs describe every shipped index change.

### Phase 2 — Implement grouped v3 retrieval and API

**Outcome:** `/api/search/v3` returns mission groups with ranked objective and
delivery matches while retaining the v2 result shape and semantics intact.

1. Add the v3 DTOs and validators from Part 3 to `@overlord/contract`, then
   expose the new REST endpoint through the backend repository and protocol
   adapter using the contract-defined authorization and UUID-only REST project
   filtering.
2. Extend the search query to select each document identity, group returnable
   objective and delivery matches under their mission anchor, and preserve
   event documents as corroboration-only.
3. Implement the v3 filters (`entityTypes`, `objectiveStates`, and
   `matchesPerResult`), `anchorOnly`, match/entity counts, display-id objective
   short-circuiting, and the specified child-ranking formula.
4. Bound per-workspace candidate retrieval to 500 documents and accurately
   report `truncatedCandidates` and lower-bound counts. Join SQLite FTS rows
   back to `search_documents` rather than recreating its virtual table.
5. Add service, route, and cross-workspace tests for grouping, quotas,
   filtering, counts, truncation, ranking, and v2-ordering preservation when
   v3 is restricted to mission/objective documents.

**Exit criteria:** v3 can identify the exact objective or delivery that
matched, v1/v2 responses and eligibility are unchanged, and all v3 envelope
metadata is truthful when candidate truncation occurs.

### Phase 3 — Expose v3 through the agent surface

**Outcome:** agents can discover matching objectives and deliveries without
loading every returned mission, while existing tool callers remain compatible.

1. Add protocol v3 flags for entity types, objective states, and matches per
   result; make `search` the canonical protocol subcommand and retain
   `search-missions` as a compatible alias.
2. Widen `overlord_search_missions` rather than creating or renaming an MCP
   tool. Implement `detail: 'compact' | 'full'`, with compact as the default
   and the exact response reductions in Part 4.
3. Rewrite the MCP tool description to explain grouped/matched-only results,
   objective display-id navigation, artifact exclusion, explicit date bounds,
   completeness metadata, and fallback-mode semantics.
4. Keep the hosted MCP server and local connector shim in lockstep, update
   their conformance/version material as required, and add protocol/MCP tests
   for both detail modes and all new filters.

**Exit criteria:** an agent can receive a matching objective display id directly
from search, compact mode materially reduces payload without hiding navigation
information, and no existing `overlord_search_missions` invocation breaks.

### Phase 4 — Build the grouped human results experience

**Outcome:** people can see why a mission matched and navigate directly to the
matching child from a full `/search` page and the compact combobox.

1. Migrate search UI data loading to v3 and build the `/search` results page
   with mission anchors, indented objective/delivery matches, kind and state
   badges, snippets, matched-term highlighting, visible match expansion, and
   truncation/completeness messaging.
2. Preserve the established objective deep link for child navigation; delivery
   results navigate through their owning objective and introduce no artifact
   route parameter.
3. Make keyboard traversal follow the flattened visible order of mission and
   child rows, including expanded matches, with accessible labels and focus
   behaviour.
4. Keep the existing combobox as a compact representation (one child maximum)
   and add responsive, empty, loading, fallback, and error states.
5. Add component and end-to-end coverage for rendering, highlighting,
   navigation, expansion, keyboard behaviour, and incomplete-result notices.

**Exit criteria:** users can distinguish mission, objective, and delivery
evidence at a glance, open the correct child directly, and are never shown a
silently incomplete result set.
