# Mission Deliveries section: current state, then drill-down

**Status:** proposal, revised 24 Oct 2026. No implementation. Wireframes on the
design canvas "Mission Detail Layouts" (boards "Web · Deliveries section" and
"iOS · Deliveries section"; the earlier full-panel boards remain as Appendix A).
**Scope:** one new mission-level section on both clients: web
`webapp/web/components/MissionPanel.tsx` (between the objectives section and
Artifacts) and iOS `Overlord/Views/MissionDetail/MissionDeliveryCardView.swift`
(replacing the flat DELIVERIES stack, moved above Artifacts). The objectives
section is not redesigned.
**Model:** the single "feed post" per ticket from the earlier Overlord
(ovld.ai, "remember agent intent"): one updated-in-place post with a headline
and impact badge, a ticket summary, a stat row, an objectives table, action
required, decision cards with alternatives and rationale, and tickets created.
**Companions:** `coo-879-objective-centric-mission-panel.md` (objective rows
hold their own evidence on the web), `rich-delivery-messages.md` (delivery
report shape, async composition), `deferred-work-objective-enrichment.md`,
`coo-963-human-actions-rail.md` and the v150 removal of the rail,
`feed-page-functionality.md` (the v1 feed generator this section borrows from).

---

## 1. The gap

| | Web panel | iOS |
| --- | --- | --- |
| Where deliveries live | Inside the expanded objective row (coo:879). Latest open, older collapsed. | Flat DELIVERIES section, newest first, all collapsed, after terminal session, notes and artifacts. |
| Mission-level state | None. | None. |
| Open actions and risks across deliveries | None. Each delivery card lists its own; a risk from delivery 1 and its fix in delivery 3 never meet. | None. |
| Progress | None beyond the status pill. | None beyond the status pill. |

The reader can answer "what did objective N produce" but not "where is this
mission now and what do I owe it". The v1 feed post answered that for a ticket
in one card. This proposal brings that card back as a mission section and uses
the individual deliveries as its drill-down.

## 2. The section

One section, two layers. Layer 1 is one post for the whole mission, kept
current. Layer 2 is the list of deliveries, newest first, each expanding to the
delivery card both clients already render.

```
▌DELIVERIES · 4                                     updated 2h ago · composed
┌──────────────────────────────────────────────────────────────────────────┐
│ Rate limiting is in behind a flag; staging deploy waits on two env vars  │ ← headline + impact badge
│                                                              Significant │
│ Ordering, the accordion and the docs are delivered and reviewed. Rate    │ ← mission summary, current
│ limiting is running on mnop and waiting on a question about the window.  │    state (2–4 sentences)
│ Two environment variables still block the staging deploy.                │
│ 4 deliveries · 46 files · 2 actions · 1 risk · 2 decisions   ui backend  │ ← stat row + tags
│ OBJECTIVES                                        3 of 6 delivered       │
│  ✓ abcd  Design objective ordering          12 files   2d          ⌘    │ ← mini table; a row filters
│  ✓ efgh  Implement evidence accordion       30 files   1d · run 2  ⌘    │    the delivery list below
│  ✓ ijkl  Write docs                          4 files   3h          ⌘    │
│  ◉ mnop  Add rate limiting                   6 files   live · ? 1  ⌘    │
│  ○ qrst  Wire counters into dashboard        next up                     │
│  ◌ uvwx  Backfill counterparties             queued                      │
│ ACTION REQUIRED · 2                                                      │
│  ☐ Set GEMINI_API_KEY on Railway   BLOCKING   environment     ⟶ efgh    │ ← open human actions,
│  ☐ Run migration 20261021 on staging          database        ⟶ abcd    │    blocking first
│ RISKS · 1                                                                │
│  ⚠ react-router-dom 6.30 carries two advisories; fix needs v7  accept ⟶ efgh
│ DECISIONS · 2                                                            │
│  ▸ Single-open accordion            Alternatives: always multi-open      │ ← tradeoffs, title line,
│  ▸ Safety ref before hard reset     Alternatives: rely on reflog         │    expand for rationale
│ CANDIDATES · 3                                                           │
│  ↳ Classify the remaining 60 unassigned journal moves  [+ Objective] [+ Mission] [×]
│  ↳ Add a rate-limit dashboard panel (suggested)         [+ Objective] [×]│
│ SPAWNED  coo:1201 Checkpoint retention policy · coo:879.yz01             │ ← promotions already made
└──────────────────────────────────────────────────────────────────────────┘
 All · Actions · Risks · Decisions                          filter: none
 ▣ 2h   ijkl  Write docs                            +1 action           ▸ ← delivery list, newest
 ▣ 1d   efgh  Implement accordion · run 2           1 risk · 2 decisions ▾   first; a row expands
      ┌ existing delivery card: markdown, follow-up actions, tradeoffs,  ┐    to the existing card
      │ known risks, deferred work, assumptions, full text              │
      └─────────────────────────────────────────────────────────────────┘
 ▣ 2d   abcd  Design objective ordering             +1 action           ▸
 ▣ 3d   efgh  Implement accordion · run 1           superseded by run 2 ▸
```

### 2.1 Layer 1: the mission post

Everything in the post is derived from the deliveries plus the operator's
resolutions, and every item is a pointer to the delivery it came from
(expands that row in layer 2 and scrolls to it).

- **Headline and impact.** One sentence naming what changed most recently and
  what is blocking, with an impact badge (`minor | notable | significant`) as in
  the v1 post. Phase 1: the lead sentence of the newest delivery and no badge.
  Phase 2: composed.
- **Mission summary.** Two to four sentences of current state: what is true
  now, what is running, what is blocked. The thing neither screen has today.
  Phase 1: lead sentence of each objective's latest delivery, newest first,
  capped at three. Phase 2: composed, with the operator's resolutions as input
  so done actions are not restated.
- **Stat row and tags.** Deliveries, files (distinct changed paths across the
  mission), open actions, open risks, decisions. Tags from the mission.
- **Objectives mini table.** One line per objective in display order: state
  glyph, key, title, file count, time (or live / next up / queued). This is the
  progress element and it is why the section can sit *below* the objectives
  section without repeating it: the objectives section is where you edit the
  plan; this table is the ledger of what the plan produced. Clicking a
  delivered row filters layer 2 to that objective. Running rows show the
  blocking marker (amber `? 1`). Re-runs show `run N`. A header count
  (`3 of 6 delivered`) replaces any percent.
- **Action required.** Open human actions from the latest delivery of every
  objective, blocking first, with category, command / verify / link on expand.
  Phase 1 read-only; phase 2 done / dismissed, mission scoped (section 4).
- **Risks.** Open known risks, deduped by text. Phase 2: accept / mitigated and
  supersession (a later delivery that addresses a risk marks it struck through
  with the reference, reopenable).
- **Decisions.** Tradeoffs across all deliveries as the v1 decision cards:
  decision title, alternatives, rationale. Collapsed to the title line and
  alternatives; expand for rationale and impact. Decisions are the one list
  that should not shrink over time: they are the mission's memory.
- **Candidates.** Deferred work items with the existing promote / dismiss
  controls, plus (phase 2) objectives the composer suggests from the current
  state. Accepting one creates a future objective; the objectives section above
  grows, and the mini table shows the new queued row.
- **Spawned.** Missions and objectives already created from this mission's
  deferred work (`outcome` / `outcomeRef` on the resolution), as the v1
  "Tickets created" line.
- **Empty state.** A mission with no deliveries renders the section as one
  line: the objectives mini table only (`0 of 2 delivered`), no post body.

### 2.2 Layer 2: the delivery list

- Newest first, one line per delivery: glyph, relative time, objective key,
  objective title (`· run N` when re-run), a count summary (`+1 action`,
  `1 risk · 2 decisions`), chevron. A superseded run is dimmed and labelled.
- Filter chips: All · Actions · Risks · Decisions, plus the implicit objective
  filter set by the mini table. Chips hide deliveries that carry none of the
  chosen kind.
- Expanding a row renders the existing card unchanged
  (`DeliverySummaryCard` on web, `DeliveryPresentationView` on iOS). The
  latest delivery is open when the section first renders and the mission is
  in review; otherwise all rows are closed.
- On the web the server caps deliveries at 200 newest; the list shows the cap
  notice as the iOS section does today.

### 2.3 Relationship to the objectives section

- **Web.** Objective rows keep their evidence stack (coo:879) in phase 1, so a
  delivery is reachable from both places. The mission post is the mission
  reading; the objective body is the provenance reading. If the duplication
  proves noisy, phase 2 reduces the objective body's DELIVERIES rule to a
  one-line pointer ("1 delivery · open in Deliveries") and keeps file changes,
  session and attachments in the row. That is a question for the PM (section
  6), not a decision here.
- **iOS.** The flat DELIVERIES section is replaced by this one and moves above
  Artifacts. Objective rows are unchanged. Tapping a mini-table row scrolls to
  and filters the delivery list; tapping a delivery expands it in place, as the
  cards do today.
- **Position.** Directly below the objectives section on both clients, inside
  the same surface colour, before Notes. The alternative (after Notes, before
  Terminal sessions / Artifacts) keeps the current Notes position but puts the
  mission's state under a private scratchpad; recommended against.

### 2.4 Platform differences

| | Web (420px drawer) | iOS |
| --- | --- | --- |
| Post | Full, one card. Decisions collapsed to titles. | Full, one card. Action required / Risks / Decisions / Candidates as a horizontally swipeable row when more than three items, with page dots. |
| Mini table | Full width; click filters layer 2. | Rows tappable; the file count drops at narrow widths. |
| Delivery list | Rows expand in place to `DeliverySummaryCard`. | Rows expand in place to `DeliveryPresentationView`, as today. |
| Filter chips | Below the post. | Segmented control below the post. |

## 3. Why this shape for progress

- The mini table is the ledger: the user said progress on earlier objectives
  matters but their detail does not. A line per objective with files and time
  gives the sense of accumulation; the delivered glyphs fill top to bottom as
  the mission proceeds. The count in its header is segmented, never a percent,
  because future objectives are open-ended.
- The stat row grows with every delivery (files, decisions) while the action
  and risk counts shrink as the operator resolves them. Two numbers going up
  and two going down is the shape of a mission converging.
- Decisions accumulate and never close. Actions and risks close. Candidates
  turn into objectives. Each list has one lifecycle, so the post gets shorter
  as the mission gets healthier, and the reader learns to trust its length.
- The headline is what a teammate reads in three seconds; the summary is what
  the reviewer reads in thirty; layer 2 is what the engineer reads in three
  minutes. Same section, three depths.

## 4. Data and contract impact

### Phase 1: no contract change

- Everything in the post derives client-side from
  `GET /api/missions/:id/deliveries` (both clients already load it) and the
  objectives on `MissionDetailDto`: latest delivery per objective for actions
  and risks; all deliveries for decisions; `deferredWorkItems` with their
  resolutions for candidates and spawned; distinct `FileChangeDto.filePath`
  for the file count (web already loads file changes; iOS loads them for its
  FILE CHANGES section).
- Deferred-work promotion reuses
  `PUT /api/deliveries/:deliveryId/deferred-work/:actionId/resolution` (v147,
  v150).
- Blocking marker from the open ask / structured-choice requests the web row
  already tracks; iOS has the same agent-request feed for its question cards.
- Headline and summary deterministic as described. No impact badge.
- Human actions and risks read-only.

### Phase 2: one contract bump

1. **Mission delivery post.** `GET /api/missions/:id/delivery-post` returns
   `MissionDeliveryPostDto { status: 'deterministic' | 'pending' | 'composed' | 'fallback'; headline; impact: 'minor' | 'notable' | 'significant' | null; markdown; tags: string[]; suggestedObjectives: { id; text; sourceRef }[]; superseded: { kind: 'risk' | 'human_action'; itemId; byDeliveryId }[]; basedOnDeliveryIds; generatedAt; model? }`.
   Stored in `mission_delivery_posts` (one row per mission, revisioned),
   recomposed by `worker_jobs` type `overlord.mission.delivery-post.v1`,
   enqueued on every delivery commit and on every resolution change, debounced.
   Update-in-place semantics as the v1 generator had per session. Emits
   `entity_changes(entity_type = 'mission_delivery_post')`. Same bounded,
   redacted inputs and provenance rules as delivery compose, plus the
   resolution rows; a suggested objective must cite a deferred-work item, a
   risk, or a summary sentence. Deterministic fallback when no provider.
2. **Action and risk resolutions.** The v150 route accepts only
   `deferred-work-*` ids. Widen it to
   `PUT /api/deliveries/:id/items/:itemId/resolution`, id prefix selecting the
   kind; the deferred-work path stays as an alias. Human actions already have
   stable ids (`human-action-N`, `rule-action-N`) and take
   `{ status: 'done' | 'dismissed' }`. Known risks need ids: `DeliveryDto`
   additively gains `knownRiskItems: { riskId; text; resolution }[]` beside the
   existing `knownRisks: string[]`, with
   `{ status: 'accepted' | 'mitigated' | 'dismissed' }`. Mission scoped; the
   cross-workspace collection removed in v150 does not return.
3. **Suggestion acceptance.**
   `POST /api/missions/:id/delivery-post/suggestions/:id/accept` creates the
   future objective and records the outcome, mirroring deferred-work promotion.
4. **Seen stamp.** `missions.deliveries_seen_at`, set when the section is
   shown, projected as `MissionDto.hasUnseenDelivery` beside
   `hasUnseenBlockingQuestion`, for a "new" dot on list rows and a board-card
   indicator.
5. **Agent surface.** `overlord_load_mission_context` / Protocol `load-context`
   additively include the post's `markdown` and open items, so the next agent
   starts from the mission's state without re-deriving it from
   `overlord_list_deliveries`.

Module impacts: Database (migration: `mission_delivery_posts`, resolution
`kind`, seen stamp), Core (post projection, risk ids, resolution kinds),
Automations (post compose job and prompt), REST (three routes, two DTO
additions), Protocol / MCP (context enrichment, additive; connector version
bump), Web and Mobile (consumers). Auth, Runner, Desktop, CLI retain their
interfaces (CLI may add `ovld mission post` later).

## 5. Build order

1. Web: the section with phase 1 data, below objectives, above Notes.
   Components: `MissionDeliveriesSection` (container), `MissionDeliveryPost`
   (layer 1), `MissionDeliveryList` (layer 2, wrapping `DeliverySummaryCard`),
   `lib/mission-delivery-post.ts` (pure derivation, unit-tested: latest per
   objective, dedupe, counts, filters).
2. iOS: replace `MissionDeliveriesSectionView` with the same two layers; move
   above Artifacts; derivation in `OverlordCore` so the watch and widgets can
   reuse the headline later.
3. Phase 2 backend: resolutions, then the composed post, then suggestions,
   then the seen stamp.
4. Then revisit the duplication question (2.3) with usage in hand.

## 6. Open questions

1. Position: directly under the objectives section (recommended) or after
   Notes? The second keeps Notes where it is today.
2. Web duplication: keep the delivery card inside the objective row as well,
   or reduce the row to a pointer once the section ships?
3. Was the per-action done / dismissed state unwanted when v150 removed the
   rail, or only the cross-workspace collection? Action required stays
   read-only unless the decision comes back mission scoped.
4. Composed post (Gemini, one job per delivery, same pipeline as delivery
   compose) or deterministic only?
5. May the composer mark an earlier risk or action as superseded by a later
   delivery (struck through, reopenable), or must a human always close items?
6. Impact badge: worth keeping from v1, or noise?
7. Suggested objectives: live only in the post until accepted (recommended)
   or auto-created as future objectives with a marker?
8. How much of the post should an agent see through `load-context`?

---

## Appendix A: the full-panel layout considered first (23 Oct)

The first draft proposed re-laying both screens into three regions: a
mission-level **Brief** above the objectives (objective rail, counts, state
paragraph, Needs you / Risks / Candidates), the objectives **Plan** with
one-line delivered and queued rows, and **Evidence** under each objective
(web accordion; a pushed objective screen on iOS). The boards "Web panel ·
Layout A", "iOS mission · Layout A", "iOS objective screen", "iOS · Layout B
(tabs)" and "Progress presentation ideas" on the canvas show it.

It was set aside in favour of the section above because it redesigned the
objectives section and the iOS navigation at the same time. What carries over:
the open-item lists with one lifecycle each, the pointer-to-delivery rule, the
segmented count instead of a percent, the composed state paragraph with
provenance, supersession, the seen stamp, and the agent-facing context. The
objective rail (idea A) and the iOS objective screen are not part of this
proposal; the mini table does the rail's job inside the post.
