# Cross-mission item closing and item discovery: design

Mission coo:1278. Revised by objective coo:1278.g0h3 against contract `176.1.0` and the
coo:1297 delivery workflow on 2026-11-18. This cross-mission feature remains design only.

This revision has **Contract impact: none**: it updates planning and draft objectives only;
no runtime, normative contract or interface changes. The implementation impact below remains major.

**Contract impact: major** (reasoning in section 6). All PM decisions were settled on 2026-11-18
(section 7).

## 0. What this builds on, and what has landed

Checked against the current source and coo:1297 delivery records on 2026-11-18.
The prerequisites below are implemented in the checkout; this is not evidence of deployment.
coo:1297’s release verification remains blocked pending its release gates (see
`delivery-process-release-verification.md`). Its changes must be included in the implementation
baseline and released through that coordinated cutover, not assumed to be in production.

| New baseline | Required integration |
| --- | --- |
| ADR 0075: durable finalization receipts | Preserve caller operation ids, immutable receipts, transactional handoff and replay before live-session validation. |
| ADR 0076: agent-only narrative publication | Both content and evidence bases govern inline prose; stale/missing prose accepts delivery and closes. Retry only the narrow publication, never closes or delivery. |
| ADR 0078: draft evidence and sealing | Discovery sees accepted live mission items only; drafts create no obligations, items or seen state. Preserve atomic sealing and batch replay. |
| Web/iOS whole-snapshot seen coverage | Extend existing `itemsSignature` / `items` group and three-watermark maximum; preserve narrative coverage. |

Existing item foundations:

| Prerequisite | State | Where |
| --- | --- | --- |
| `mission_items` table, closed `kind` / `status` / `resolved_by_kind` vocabularies, index `(project_id, status, kind)` | Landed (ADR 0060, contract v173) | `database/*/migrations/20261115120000_mission_items.sql`, `contract/data/README.md` |
| Old item storage dropped | Landed | `20261115160000_drop_mission_summary_item_storage.sql` |
| Core item service: `listMissionItems({ missionId \| projectId, ... })`, `closeMissionItem`, `restoreMissionItem` | Landed. `projectId` scope exists but has no caller yet | `packages/core/service/mission-items.ts` |
| Agent baseline at attach, `closeItems` at delivery | Landed | `packages/core/service/mission-summary-agent.ts`, `protocol.ts` |
| `mission-items` and `close-items` protocol commands, MCP `overlord_mission_items`, `overlord_close_items` | Landed (ADR 0073). Both require the item to belong to the session's own mission | `backend/protocol/session.ts`, `protocol.ts` (`readAgentMissionItems`, `closeAgentMissionItems`) |
| Person close and restore of any item, Resolved group with Restore on web | Landed. Close and restore need `mission:update`; neither schedules narrative composition (ADR 0076) | `backend/mission-item-resolutions.ts`, `webapp/web/components/mission-summary/MissionSummaryResolved.tsx` |
| Duplicate grouping of open items in the summary read | Landed (ADR 0074) | `backend/mission-summary.ts` |

What is missing for this mission: any read of open items across missions, any agent write to an
item of another mission, provenance that names the closing mission or session, and any signal on
the target mission that someone else closed one of its items.

Two facts from the current code shape the design:

1. **An agent close today records `resolved_by_objective_id` and `resolved_by_delivery_id`
   only.** A standalone `close-items` call stores a null delivery and never fills it in later.
   On the target mission, the web client maps the objective id to a display key using *that
   mission's* objectives (`mission-summary-derive.ts`), so an objective from another mission
   shows as "by an agent".
2. **Item decisions are independent of narrative.** ADR 0076 removed automatic narrative
   writers, including person close/restore enqueues. Item changes do not advance narrative
   evidence, invalidate publication opportunities or rewrite prose. Cross-mission decisions
   must preserve every target narrative field and publication row, including evidence revision.
3. **Client groundwork exists, server support does not.** The optional `itemsWatermark` and
   `items` coverage hook in web/iOS are inert until this mission supplies and renders them.
   ADR numbers 0075–0078 are already occupied; allocate the next unused ADR at implementation.

## 1. Product result

An agent working on mission A can see the open risks, human actions and suggestions on other
missions in the same project that its work is likely to have resolved. It can close any of them
as `done` or `dismissed` with a short reason. The target mission B shows the item under
Resolved, with the objective and mission that closed it, the reason and a Restore control. The
mission is marked as having news since the person's last visit. B's headline and summary are
left unchanged. The closing delivery on A lists what it closed elsewhere, so reviewers of A can
audit it.

## 2. Part 1: offering the right items

### 2.1 Size of the problem

With the open-item index, listing every open item in a project is cheap for the database. The
cost is the agent's context. An item is about 200 to 600 bytes as JSON: id, kind, text up to a
sentence or two, and for a suggestion `change`, `location` and `doneWhen`. Today's full-detail
`mission-items` page of 60 items is about 15–35 KB. A project with 500 open items is 9 such
pages and roughly 100–300 KB, which is too much to read before every delivery and mostly
irrelevant to the work done.

### 2.2 Options compared

| | (a) Project items command | (b) Match against the change ledger | (c) Index items in `search_documents` | (d) Candidates in attach or delivery response |
| --- | --- | --- | --- | --- |
| What the agent does | Calls `project-items` with optional `--kind`, `--query`, `--path` filters; reads compact rows | Nothing extra if built into (a) or (d); the server scores items against the objective's `changed_files` | Calls `search` with words it chooses; gets ranked items | Reads a short list it did not ask for |
| Build cost | Low. One core read over `(project_id, status, kind)`, one protocol command, one MCP tool | Low to medium. Path normalisation, a scoring function, golden tests | High. New closed `entity_type` value (`mission_item`) is a **major** change. Indexing on every insert, reconcile, close, restore and supersede; backfill; a new result shape in v3 grouped search, which today always anchors results on a mission | Low for the data; medium for the instructions and payload rules |
| Runtime cost | One indexed range scan; filtering in SQL (`LIKE` on `text`) or in core | Reads the objective's ledger (bounded) plus the project's open items, scores in core. Linear in open items | Constant per query; write amplification on every item write | Attach: one extra query per attach. Delivery: one per delivery |
| Payload | Compact row ~250–350 bytes; default 20 rows ≈ 5–7 KB; max 100 ≈ 35 KB | Same rows plus `match` (≤5 paths) | Same rows; a ranked page of 20 | Attach: grows every attach response, against ADR 0069 (compact attach). Delivery: small, but arrives after the session is delivered |
| Behaviour at hundreds of open items | Without a filter, the agent pages and runs out of context. With `--query` / `--path` it is good, but only when the agent guesses the right words | Ranked list stays fixed size. Precise for suggestions, which carry `location`; weak for risks and actions, which rarely name files. Blind when the ledger has a capture gap. Generic basenames (`index.ts`, `README.md`) cause false matches unless excluded | Good ranking for words in the text. No better than `LIKE` until there are thousands of items. Ranked search never proves absence | Attach: the work has not happened yet, so the list is guessed from the objective text and goes stale. Delivery: the session is already delivered and `close-items` refuses a delivered session, so the agent would have to resume follow-up to act |
| Failure mode | Agent does not call it, or filters badly | Ranks a relevant item low because its text names no file | Index drift; stale status in results | Noise in every session; closes made after delivery lose their link to the work |

### 2.3 Recommendation

**Build (a) with (b) inside it as the default ordering, and add a one-number hint to attach.**
Do not build (c) now. Do not put item lists in attach or delivery responses.

- One read command, `project-items`, returns compact open items of *other* missions in the
  session's project. By default it ranks by match against the objective's change ledger and any
  paths the agent passes. Matched items come first, then the newest unmatched items until the
  limit is reached. It is one call before delivery with a fixed-size answer, whatever the
  project's size.
- Attach carries `missionSummary.otherMissionOpenItems`, a count only (a few bytes). The
  instructions add the "check other missions' items" step only when the count is above zero, so
  projects with no open items pay nothing.
- (c) can be added later if projects reach thousands of open items. Nothing in this design
  blocks it.

### 2.4 `project-items` specification

```
ovld protocol project-items --session-key <key> [--mission-id <id>] [--objective-id <id>]
  [--kind risk,human_action,suggestion] [--query <text>] [--path <p1,p2>]
  [--include-own-mission] [--limit 20] [--offset 0]
```

MCP: `overlord_project_items` with `sessionKey`, `kinds`, `query`, `paths`,
`includeOwnMission`, `limit`, `offset`.

Rules:

- Requires a live attached session that matches the mission, as `mission-items` does, and
  `mission:read`. Scope is the session mission's `project_id` and workspace; the project-scope
  predicate applies. Delivered/ended sessions are rejected; ADR 0076’s ended-session exception belongs only to publication context/write commands, and receipt replay retains its own narrow exception.
- Returns only `open` items of live deliveries (`listMissionItems` semantics). By default it
  excludes the session's own mission, which the attach baseline already covers.
- `--kind` and `--path` are comma-separated (repository rule for list-valued flags).
- `--query` is a case-insensitive substring match over `text` and, for suggestions,
  `change`, `location` and `doneWhen`. It is at most 200 characters. It is a filter, not
  ranked search.
- Ranking (default): the match set is the objective's live `changed_files` paths (server
  ledger, same source as `objective-changes`) together with the `--path` values. Each path
  contributes:
  - the full repo-relative path (strong);
  - its directory prefixes with at least two segments (medium);
  - its basename, only if it is not in a fixed generic list (`index.ts`, `README.md`,
    `package.json`, `mod.rs`, …) (weak).
  An item scores on a suggestion's `location`, on any path-like token in `text` or
  `detail_json`, and on the mission title. The score is deterministic and has golden vectors
  (`contract/project-item-match-vectors.json`), because both the core function and a future
  local implementation must agree. Each row returns at most five matched paths.
- Bound: core reads at most 2,000 open rows per call, newest delivery first, and reports
  `scanTruncated: true` beyond that. Paging uses `offset` over the ranked list. As with
  `mission-items`, paging must restart after a concurrent write.
- Limit 1..100, default 20.

Response (`responseShapeVersion: 1`):

```json
{
  "projectId": "…",
  "excludedMissionId": "…",
  "total": 143,
  "items": [
    {
      "id": "<itemId>",
      "kind": "suggestion",
      "mission": { "displayId": "coo:1290", "title": "…" },
      "objective": "coo:1290.k2qa",
      "text": "Retry webhook dispatch on 429",
      "location": "backend/webhook-dispatcher.ts",
      "blocking": null,
      "reportedAt": "2026-11-16T…Z",
      "match": { "paths": ["backend/webhook-dispatcher.ts"], "strength": "strong" }
    }
  ],
  "limit": 20, "offset": 0, "nextOffset": 20, "truncated": true, "scanTruncated": false,
  "ledger": { "paths": 12, "captureGap": false }
}
```

`text` is truncated to 240 characters with `textTruncated: true` when cut. For full detail, the
agent reads the target mission’s items with existing authorized read commands; `--query` is a text filter, not an id lookup. `ledger.captureGap` tells the agent that ranking ran without its own file list, so it
should pass `--path`.

### 2.5 Instructions

The "Mission summary" block in `assembleAgentInstructions` gains, only when
`otherMissionOpenItems > 0`:

> Other missions in this project have N open items. Before you deliver, run `project-items` once.
> Close an item on another mission only if you verified in the code that your work resolved it
> or made it obsolete. Never close one because it looks similar. Give a reason that names what
> you changed.
> Close verified items with `close-items` while working or include them in delivery `closeItems`.
> Retain the delivery operation id for retries. If accepted delivery withholds prose, follow its
> publication instructions using fresh content/evidence bases; never resend closes to publication.

The `--connection-method mcp` variant names the MCP tools (ADR 0067).

## 3. Part 2: the cross-mission write

### 3.1 One close operation for any item in the project (settled, PM decision 2)

No new write command. The existing close paths accept items of any mission in the session's
project:

- `ovld protocol close-items` and MCP `overlord_close_items` (standalone, before delivery);
- `missionSummary.closeItems` on `deliver`, `record-work` and their MCP tools.

Entries keep their shape: `{ "id": "<itemId>", "status": "done" | "dismissed", "reason": "…" }`,
1..50 per call, reason required and at most 280 characters. Invalid input is 400 `invalid_input`
before any write.

Why one operation: the item id already identifies its mission, so making the agent pick a
command by the item's mission repeats what the server can look up. The rules that differ
(target permission, same project, restore protection, no compose on the target) depend on the
item's relationship to the session, not on which command was used. One function that branches on
that relationship has one validation, one warning model, one lock order and one provenance
writer, where two commands would have to be kept in step. Agents learn one call. Foreign ids can come from any authorized mission read; the explicit target permission and
same-project rule govern this intentional expansion of write authority.

What stays separate: discovery (`project-items`, section 2), and the narrative write. The
headline, summary and both `baseContentRevision` / `baseEvidenceRevision` checks only apply
to the session’s own mission. Publication accepts no `closeItems`.

Each entry is classified by its item's relationship to the session:

| Relationship | Rules |
| --- | --- |
| Own mission | Today's rules, unchanged |
| Other mission, same project | Section 3.4 authorization; restore protection (3.3); no compose and no summary write on the target (3.2) |
| Anything else (other project, other workspace, outside token scope, unknown id, deleted delivery) | `not_found`, never revealing existence |

Per-entry problems (one bad entry never fails the call):

| Problem | When | Shown to agent as |
| --- | --- | --- |
| `not_found` | As above | Warning |
| `not_open` / `superseded` | Already closed or superseded | Warning with current status and resolver |
| `restored_by_person` | Foreign item a person restored after an agent closed it (3.3) | Warning: only a person may close it now |
| `forbidden` | Foreign item, and the owner lacks `mission:update` in the project (3.4) | Warning; own-mission entries and the delivery proceed |

The `other_mission` skip is removed. Responses keep `closedItemIds` and `warnings` and gain
`targets: [{ missionDisplayId, closed }]`, listing missions other than the session's own.

**Where cross-mission closes should be sent.** Standalone `close-items` is useful as soon as
resolution is verified; delivery `missionSummary.closeItems` is equally valid. ADR 0076 accepts
closes when inline prose has stale content/evidence bases, lacks an evidence base, or is absent.
There is no delivery `mission_summary_conflict` resend rule. Keep `closeItems` nested for wire
compatibility. Required validation, draft CAS or authorization failures can still roll back an
unaccepted delivery; prose withholding cannot.

A lost delivery response is retried with the same operation id and semantic body, returning the
immutable ADR 0075 receipt without reapplying closes, linking items, sealing drafts or scheduling
handoff. An accepted delivery with an outstanding publication uses `delivery-summary-context`
and `publish-delivery-summary` with fresh bases and its own retained operation id. Publication
CAS retries contain prose only, have no arbitrary expiry, and never acquire foreign-item write
authority. No general `update-summary` command is introduced.

### 3.2 Write path (core)

The shared close step in `prepareMissionSummaryWrite` / `applyMissionSummaryWrite`
(`packages/core/service/mission-summary-agent.ts`), used by both `closeAgentMissionItems` and
delivery, changes as follows:

1. Resolve the mission and session as today. For `close-items` the session must be live, match
   the mission and not be delivered; a delivered session resumes follow-up first.
2. Load the entries' items and classify them (3.1). Out-of-scope entries become `not_found`.
3. If any entry targets another mission, check `mission:update` in the project once (3.4).
4. Before any mission-summary/publication/item row lock, acquire `lockMissionObjectiveQueue`
   for the complete affected mission set in ascending id order, including the source mission,
   explicit close targets and targets of prior session closes to be linked at delivery. Do not
   acquire the source first then sorted foreign targets: reciprocal A→B/B→A would deadlock.
   Pre-read only in authorized scope, then revalidate session, permissions, item relationship,
   restore state and the complete target set under locks; restart the transaction if the set
   changed. Integrate at the outer `deliverSession` / `closeAgentMissionItems` boundary, before
   `prepareMissionSummaryWrite`, not by taking foreign locks inside the already-locked close loop.
   For sessionless record-work the newly inserted source is private to its transaction; lock
   existing targets in sorted order before summary/item locks. Retain receipt replay and draft
   sealing inside the finalization boundary. Test reciprocal deliveries, standalone closes,
   restore races and concurrent linking on real Postgres.
5. `closeMissionItem` with `missionId` set to the item's mission and resolver
   `{ kind: 'agent', objectiveId, deliveryId, missionId, sessionId }`, where `deliveryId` is the
   delivery when closing inside `deliver` and null for `close-items`. The agent rule ("open only,
   reason required") already applies.
6. Append the `entity_changes` row for each item as today (the item's own `mission_id`, so the
   target's panel refreshes in real time). Attribution carries the token id and source `protocol`.
7. For a foreign target, do not lock or write its `mission_summaries` row or publication rows.
   Headline, summary, revisions (including evidence and published basis), freshness timestamps,
   status and outstanding publication opportunity remain unchanged. Neither agent nor person
   decisions enqueue narrative composition; do not reintroduce the retired worker.

### 3.3 Provenance on the row

Additive migration in both editions, `<ts>_mission_item_cross_mission_provenance`:

| Column | Type | Meaning |
| --- | --- | --- |
| `resolved_by_mission_id` | Id, nullable, FK `missions` ON DELETE SET NULL | Mission of the closing objective. Set for every agent close, own or foreign, so it survives the objective's deletion and lets the panel name the mission. Backfilled from `resolved_by_objective_id` for existing agent rows. |
| `resolved_by_session_id` | Id, nullable, FK `agent_sessions` ON DELETE SET NULL | Session that closed the item. Set for every agent close, standalone or at delivery. |
| `restored_at` | TimestampUTC, nullable | Last time a person restored the item after an agent closed it. Never cleared. |

CHECK: `resolved_by_mission_id` and `resolved_by_session_id` are null unless
`resolved_by_kind = 'agent'`.

**Delivery link.** The requirement is that provenance names the resolving delivery, but closing
happens before the delivery exists. Solution: in the `deliverSession` (and `record-work`)
transaction, after the delivery row is inserted and before receipt creation:

```sql
UPDATE mission_items
   SET resolved_by_delivery_id = :deliveryId, updated_at = :now, revision = revision + 1
 WHERE resolved_by_session_id = :sessionId
   AND resolved_by_delivery_id IS NULL
   AND status IN ('done', 'dismissed')
   AND resolved_by_kind = 'agent'
```

Each linked row appends a `mission_item` change. Link only on first acceptance; receipt replay does no writes. Sessionless record-work closes with its new delivery id directly and has no session history to link. This also gives ADR 0073's standalone own-mission
closures a delivery link, which they lack today. An agent that closes items and never delivers
leaves them linked to the objective and session only. That is visible as "closed by
coo:1278.rbag (not delivered)".

**Restore protection.** `restoreMissionItem` sets `restored_at` when the item was closed by an
agent. An agent of another mission is refused an item with `restored_at` set
(`restored_by_person`). Same-mission agents keep their current rights, and a person can still close it. This stops two
agents and a person passing an item back and forth.

### 3.4 Authorization

| Caller | Outcome |
| --- | --- |
| `project_automation` token | Denied before any write, like every session command (it holds no `session:attach` / `event:create`). `project-items` is added to the preset's protocol deny list (`close-items` is already denied) and stays off its REST allowlist. `project-items` would be a harmless read, but it needs a session key, which this preset can never have. |
| `mission_lifecycle` token | Allowed when the owner's role in the workspace grants `event:create` and `mission:update` (the preset includes `mission:*` and `event:create`) and the token consents to the workspace. |
| `full` token, signed-in CLI, hosted MCP OAuth | Owner's role in the workspace, intersected with consent. |
| Loopback local operator | As today. |

Checks, in order:

1. Gate permission `event:create` (`close-items`) or the delivery permission (`deliver`,
   `record-work`) through `requirePermission` on the session's mission, unchanged.
2. **Target permission `mission:update`** in the target's project, the permission a person needs
   for `PUT /api/mission-items/:id/resolution`, checked only when an entry targets another
   mission. Because targets must share the session's project, this is one check per call, not one
   per item. If it fails, every foreign entry is skipped with a `forbidden` warning; own-mission
   entries and the delivery itself proceed, so a missing permission never blocks a delivery.
3. **Same project only.** An item whose `project_id` differs from the session mission's
   `project_id` is `not_found` (PM decision 3, settled).
4. **Token project scope.** The request's project-scope predicate applies to the target's
   project. Today only `project_automation` carries a project selection, and it is already
   denied. Any future project-selected preset is bounded automatically, with an out-of-scope item
   reading as `not_found`.
5. The session's own `workspace_id` must equal the item's (always true when rule 3 holds; checked
   explicitly so isolation does not depend on rule 3).

No new permission constant and no new role grant. `contract/authorization.md` gets the
same-project rule, the target `mission:update` requirement and the `project-items` deny-list entry.

### 3.5 Target mission panel

Server (`GET /api/missions/:id/summary`, `MissionItemDto`):

- `MissionItemResolverDto` gains nullable `missionId`, `missionDisplayId`, `objectiveDisplayId`
  and `sessionId`, resolved server-side with live joins. The client therefore never needs the
  closing mission's objectives. `crossMission: boolean` is true when `missionId` differs from the
  item's mission.
- `closedItems` keeps its cap of 100, newest first. Cross-mission closes appear there like any
  other close.

Web and desktop (`MissionSummaryResolved.tsx`, `mission-summary-derive.ts`):

- Row: "Done by coo:1290.k2qa · *Webhook retry hardening*", with a link that opens the other
  mission, then the reason, then Restore. When the closing session has not delivered, the row adds
  "(not delivered yet)".
- Restore is the existing control and route (`DELETE /api/mission-items/:id/resolution`,
  `mission:update`). Restore changes live items only; it neither enqueues composition nor changes B’s narrative basis or publication opportunity (ADR 0076).
- The Resolved group header shows a "new" dot and "2 closed from other missions" when any
  cross-mission close is newer than the person's `seenAt`. The group opens automatically on the
  first visit after such a close.

iOS (OverlordMobile): the same resolver text and link in the summary card. Restore is out of scope
for the first iOS version, which stays read-only, consistent with coo:1260.

### 3.6 Seen watermark

The current ADR 0076 clients acknowledge a whole rendered snapshot. Preserve that algorithm:

- Server `itemsWatermark` is the newest `resolved_at` of this mission’s items closed by another
  mission’s agent, or null; use an indexed query and retain the existing live-source visibility
  rules. The server still needs this field; optional client decoding alone is not implementation.
- Extend `evidenceUpperBound` with that timestamp while retaining delivery/question and
  `narrative_changed_at` sources. `watermark` and `narrativeWatermark` keep their meanings.
- Use the existing `itemsSignature` argument and `items` coverage group, not a new `resolved`
  group. Signature covers displayed cross-mission decisions and their current provenance/status,
  so a changed row or newly linked delivery invalidates old coverage. Render the Resolved group
  before reporting coverage, and ensure the displayed group backs `itemsWatermark` despite caps.
- Acknowledge `max(watermark, narrativeWatermark, itemsWatermark)` only when the response and
  questions are fully loaded, every required group has its current signature covered, and every
  watermark is backed by displayed evidence. Rendering the Resolved header alone is insufficient
  if narrative, actions, risks or suggestions remain hidden. Preserve the visit baseline and
  remount behavior; errors or stale responses cannot acknowledge unseen evidence.
- Extend the existing shared derive fixtures and both web/iOS consumers with newer visible items
  plus older hidden narrative/actions, and the inverse, changed provenance, remount, capped rows
  and old-server missing-field cases. This changes a shared deterministic algorithm/fixture and
  therefore requires a **major**, not minor, contract increment under CONTRACT.md section 5.
- Older clients ignore the optional field and retain their existing markers. No cross-mission
  timestamps are folded into `watermark` to make unsupported clients acknowledge unseen rows.

Own-mission standalone closes (ADR 0073) are left out of `itemsWatermark`. They come from the
mission's own agent, and the next delivery moves `watermark` anyway (PM decision 5, settled).

### 3.7 Resolving mission

`DeliveryDto` gains `closedElsewhere: [{ itemId, kind, text, missionDisplayId, status, reason }]`,
at most 50, deterministically ordered. These are a live item-provenance projection of rows on other missions linked to the delivery by 3.3, not a mutation of the sealed source report or immutable finalization receipt. Restore/source deletion may remove a row; do not promise a permanent audit snapshot. Distinguish `done` from `dismissed` in row labels. The delivery card on
mission A shows them under "Closed on other missions" so A's reviewers can audit what their agent
did. The delivery summary text is unchanged.

## 4. Implementation objectives and order

Every phase lands its own contract, code, tests and generated artifacts together. Keep existing
objective identities and execution order: **pyw6 → 9zqn → agbz → kst1**. coo:1297’s implemented
baseline is prerequisite to all four; its release gates remain separate and are not cleared here.

1. **pyw6 — close path and provenance (major).** Sections 3.1–3.4 and 3.7: allocate the next unused
   ADR amending 0060/0073/0075/0076/0078 as applicable, additive migrations, authorization,
   globally ordered locks, standalone delivery linking, resolver/closedElsewhere DTOs, acceptance
   and replay integration. Generate APIs, bump with tooling, restamp manifests. Tests cover stale
   content, stale evidence, missing basis and absent prose accepting closes once; same-operation
   replay; publication retries never closing; atomic draft-seal failure; record-work without a
   session; target narrative/publication byte identity; restore protection and cross-project
   concealment; SQLite and real Postgres reciprocal lock races; token presets and CLI flow.
2. **9zqn — server watermark and web/desktop (major).** Sections 3.5–3.6: server read/seen bound,
   resolver rows, existing `items` coverage, three-watermark whole-snapshot acknowledgement,
   delivery projection. Update architecture/data/API/derive contract and fixtures together, new
   ADR where required, tooling bump, generated API and conformance manifests. Verify hidden-group
   age directions, remount, restore/link refresh and actual web/Electron rendering.
3. **agbz — iOS consumption (none).** Depends explicitly on pyw6 and 9zqn. Use the existing
   ADR 0076 freshness/seen implementation and reserved item hook; decode optional additions,
   implement rows/links and matching item coverage, consume shared fixtures. No Restore in v1.
4. **kst1 — discovery and agent guidance (minor).** Section 2, after pyw6/9zqn/agbz. Read only
   accepted live items, retain bounded ledger ranking/count, add command/MCP/connector guidance.
   Teach receipt retries and prose-only publication recovery, not obsolete delivery conflicts.
   Preserve opt-in report-draft guidance and compact attach. New matching vectors define a new
   algorithm; do not modify the existing shared seen algorithm in this minor phase.

Run affected suites and contract/API/conformance checks per phase. Combined acceptance: A finds
and closes B’s relevant item; B shows provenance, correct new/seen state and Restore; A’s delivery
links the close once; B’s narrative and publication basis remain byte-identical. A stale inline
proposal still accepts the delivery/close and can later publish prose without touching B. Draft
observations never appear in discovery or markers. Record automated, browser/Electron and
simulator/device evidence separately; do not infer deployed status.

## 5. Effect on every module

| Module | Change |
| --- | --- |
| Contract | New unused ADR (0075–0078 already allocated); `data/README.md` (three columns, delivery link rule, restore protection); `protocol-commands.yaml` and `protocol.md` (`project-items`; `close-items` and delivery `closeItems` accept other missions' items, the `other_mission` skip is removed; attach `otherMissionOpenItems`; instructions step); `authorization.md` (same-project rule, target `mission:update`, deny-list entry); OpenAPI additions; `project-item-match-vectors.json`; derive fixtures; major version, changelog, manifest restamp |
| Database | One additive migration in SQLite and Postgres with backfill; `@overlord/database` types; conformance tests |
| Core | Candidate read and ranking; relationship classification and foreign-target rules in the shared close step (`mission-summary-agent.ts`); resolver fields; `restored_at`; delivery link; attach count and instructions |
| Backend | Protocol dispatch for `project-items`; deny list for `project_automation`; summary route `itemsWatermark` and resolver display ids; `evidenceUpperBound`; delivery DTO `closedElsewhere` |
| Automations | No narrative writer or enqueue is reintroduced; retain report formatting and durable handoff |
| CLI | `project-items` command, flags and help; `close-items` help text; retain receipt retry identity and prose-only publication recovery |
| MCP | `overlord_project_items`; `overlord_close_items` and deliver/record-work descriptions; attach output field |
| Connectors | Restamped conformance manifests; core skill and `reference/cli.md`, `reference/mcp.md`; regenerated MCP tool list; version bump per `connector-versions` |
| Web | Resolved row with cross-mission link and "not delivered yet"; group new marker and auto-open; existing `items` coverage group with whole-snapshot acknowledgement; delivery card "Closed on other missions" |
| Desktop | Same as web (shared web bundle); no desktop-specific code |
| iOS (OverlordMobile) | Resolver text and link in the summary card; contract DTO fields; derive test vectors. No Restore in v1 |
| Docs | Agent protocol page; user docs paragraph on "closed from another mission" and Restore |
| Runner, auth package, webhooks | None. No new permission constant; webhooks carry ids only |

## 6. Contract impact: major, and why

Most of the change is additive: one new protocol command and MCP tool (`project-items`), three
nullable columns, optional response fields (`otherMissionOpenItems`, resolver display fields,
`itemsWatermark`, `closedElsewhere`, `targets`), and a looser seen upper bound. No closed
vocabulary gains a value; agent closes stay `resolved_by_kind = 'agent'`. `watermark` keeps its
meaning.

It is major because existing behaviour changes:

- `close-items` and delivery `closeItems` today skip an item of another mission with an
  `other_mission` warning (ADR 0060, ADR 0073, `protocol-commands.yaml`). They will close it.
- Agent writes are no longer confined to the session's own mission, which is an authorization
  change (CONTRACT.md section 5).

Compatibility: existing own-mission requests remain valid. Foreign ids can already be obtained through authorized reads; callers that relied on `other_mission` skips will observe changed behavior. Old CLIs and
connectors pass the payload through unchanged and keep working. Old iOS builds show
cross-mission closes as "by an agent" and never see the new marker. The increment needs the
owner's approval (CONTRACT.md section 7) and a restamp of every conformance manifest.

## 7. PM decisions (settled 2026-11-18)

All eight were decided as recommended, with decision 2 changed to the merged design.

1. **Discovery mechanism.** `project-items` with ledger ranking, plus a count in attach (2.3).
   Full-text indexing and pushed candidate lists are not built.
2. **One close operation.** `close-items` and delivery `closeItems` accept items of any mission in
   the project (3.1). No separate command. Cross-mission closes are sent with `close-items` before
   delivery or at delivery; accepted closes are never resent to a publication retry.
   `closeItems` stays inside `missionSummary`, and a summary-only write (`update-summary`) remains
   out of scope. Contract impact: major.
3. **Same project only.** Items in other projects read as `not_found`.
4. **Who may close across missions.** Any session whose owner has `mission:update` in the project;
   `project_automation` denied. No opt-in project setting.
5. **What moves the seen marker.** Only closes by another mission's agent (`itemsWatermark`, 3.6).
6. **Restore protection.** After a person restores an item, another mission's agent cannot close
   it again (3.3).
7. **Timeline event on the target.** None.
8. **Stale narrative on the target.** Accepted. Only an eligible target-mission agent publication
   can refresh prose; an item decision does not invalidate its narrative basis.

## 8. Risks

- **Wrong closes by confident agents.** Mitigations: verification wording in the instructions, a
  required reason, visible provenance with a link, the new marker, Restore and restore protection.
  Usage should be monitored after release: the share of cross-mission closes that people restore.
- **Ranking misses risks and actions that name no file.** `--query` and the newest-first fill
  partly cover this. Full-text search (option c) is the follow-up if misses become common.
- **Capture gaps empty the ledger.** The response flags `captureGap`, and the agent can pass
  `--path`.
- **Lock contention.** Closing across several missions locks each target's objective queue
  briefly, in a global order including the source; prior session-link targets also participate. Explicit closes are bounded by 50 entries per call; prior-session linkage can touch more rows/targets, so test and bound transaction cost without silently dropping links.
- **Item ids leaking across projects.** Every out-of-scope id reads as `not_found`, with tests for
  each token preset.
