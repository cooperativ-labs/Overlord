# Mission Deliveries section: presentation spec

**Status:** specification, 24 Oct 2026. Derived from
`unified-mission-detail-layout.md` §2 and the canvas boards "Web · Deliveries
section" and "iOS · Deliveries section".
**Rule for this work:** additive only. Nothing else on the mission panel or the
mission detail screen changes: header, title, settings bar, objectives section,
draft and future composers, Notes, Terminal sessions, Artifacts, Activity,
File changes, Shared state all stay as they are. The one existing thing that
is replaced is the iOS flat DELIVERIES stack, because it *is* the deliveries
presentation. On the web the delivery cards inside objective rows (coo:879)
stay exactly as they are.
**Contract impact of phase 1:** none. Every value below is derived on the
client from data both clients already load.

---

## 1. Purpose

The section answers, for one mission, in this order of depth:

1. In three seconds: what changed most recently and what is blocking.
2. In thirty seconds: the current state of the mission, what a human must do,
   what is risky, what was decided, what could come next.
3. In three minutes: any individual delivery in full.

It is the mission-level reading of the deliveries. The objective rows (web)
remain the per-objective reading. The two share the same delivery card.

## 2. Placement

- **Web** (`MissionPanel.tsx`): a new block inside the supporting section,
  immediately above the `Artifacts` heading, below Notes and the Terminal
  sessions block. Same `space-y-3` rhythm and the same uppercase `h2` style
  as Artifacts and Activity. Nothing above or below it moves.
- **iOS** (`MissionDetailContentView.swift`): the new section view replaces
  `MissionDeliveriesSectionView` and renders immediately above
  `artifactsBlock`. The other blocks keep their order and content.
- The section is always rendered, including when there are no deliveries
  (see §7, empty state).

## 3. Anatomy

```
DELIVERIES · 4                                       updated 2h ago
┌ Mission post ─────────────────────────────────────────────────────┐
│ Headline                                              [impact]    │
│ Summary paragraph                                                 │
│ 4 deliveries · 46 files · 2 actions · 1 risk · 2 decisions  tags  │
│ OBJECTIVES                                      3 of 6 delivered  │
│   rows…                                                           │
│ ACTION REQUIRED · n                                               │
│ RISKS · n                                                         │
│ DECISIONS · n                                                     │
│ CANDIDATES · n                                                    │
│ SPAWNED …                                                         │
└───────────────────────────────────────────────────────────────────┘
[All] [Actions] [Risks] [Decisions]
delivery row ▸
delivery row ▾  → existing delivery card
delivery row ▸
```

Two layers. Layer 1 is one post for the whole mission. Layer 2 is the list of
deliveries. Every item in layer 1 that came from a delivery is a link to that
delivery in layer 2.

### 3.1 Section header

- Label `DELIVERIES · {total}` where `total` is `MissionDeliveriesDto.total`
  (the count before the 200 cap), uppercase, same style as the sibling
  headings.
- Right side: `updated {relative time}` from the newest `deliveredAt`. When
  any delivery's `report.presentation.status === 'pending'`, append
  `· adding details…` with the same spinner the delivery card uses.
- When `items.length < total`, a second line in muted text:
  `Showing the newest {items.length} of {total}` (the iOS section already
  has this string; reuse it on both).

### 3.2 Layer 1: the mission post

One bordered card (web: `rounded-xl border bg-(--color-surface-0)`; iOS: the
18pt-radius white card used by the other blocks). Sub-blocks are separated by
thin rules, each with a small uppercase label and a count. A sub-block with
zero items is omitted entirely. Order is fixed.

**Headline.** One sentence, bold, display font. Phase 1: the one-sentence
summary of the newest delivery, using the existing one-sentence helper
(`DeliverySummaryCard` preview on web, `MissionFeed.deliveryOneSentenceSummary`
on iOS). No impact badge in phase 1. The badge slot exists in the layout
(right of the headline) and stays empty.

**Summary.** Two to four sentences of current state. Phase 1: the one-sentence
summary of the *latest delivery of each objective*, newest first, at most
three sentences, joined with spaces. Objectives that are `executing` or
`pending_delivery` contribute one deterministic sentence appended last:
`{Objective title} is running.` or, with an open agent question,
`{Objective title} is waiting on a question.` This is the only generated
sentence; it comes from objective state, not from a model.

**Stat row.** Inline, muted, separated by middle dots, counts bold:

| Stat | Source |
| --- | --- |
| `{n} deliveries` | `total` |
| `{n} files` | distinct `FileChangeDto.filePath` across the mission (web: the file-change query the panel already runs; iOS: the file-change items the FILE CHANGES block already loads). Omit when the file-change list is unavailable. |
| `{n} actions` | open human actions (§4.2), coloured blue when > 0 |
| `{n} risks` | open risks (§4.3), coloured red when > 0 |
| `{n} decisions` | all tradeoffs across non-superseded deliveries (§4.4) |

Then the mission's tags (`MissionDto.tags`) as the small chips already used
on cards, right-aligned, wrapping under the stats on narrow widths.

**Objectives mini table.** Label `OBJECTIVES`, count on the right:
`{delivered} of {total} delivered`, where `delivered` is objectives in
`complete` and `total` is all non-deleted objectives of the mission. Never a
percentage. One row per objective in the same display order the objectives
section uses (web: `deriveObjectiveLifecycleView(...).orderedObjectives` then
the editable and future groups; iOS: executed list, then draft list, then
future list). Each row:

| Column | Content |
| --- | --- |
| Glyph | `complete`: green check. `executing` / `pending_delivery`: blue ring (not animated here; the objectives section already animates). `launching`: blue ring, dimmed. `draft` / `submitted`: hollow grey circle. `future`: dashed grey circle. |
| Key | `displayKey`, mono, muted. (Web only; iOS drops it for width.) |
| Title | `title ?? initialTitleFromInstruction`, one line, truncated. |
| Trailing | `complete`: `{files} files · {relative completedAt}` plus `· run {n}` when the objective has more than one run (§4.1). Active: `{files} files · live` plus the amber `? {n}` badge when the objective has an open question or structured choice (web: the same `useAgentSessionFeed` open-request selection the row uses; iOS: the pending agent-question cards the Activity block renders). `draft`/`submitted`/`launching`: `next up`. `future`: `queued`. |

A delivered row is a link: it sets the layer 2 objective filter to that
objective (§3.3) and scrolls the list into view. Active and planned rows are
not links. Rows for objectives with no delivery and no run are rendered
muted.

**Action required.** Label `ACTION REQUIRED · {n}`. Open human actions
(§4.2), blocking first, then newest delivery first, then report order. Each
item:

- Phase 1: a static bullet (no checkbox). Phase 2 adds the done checkbox.
- First line: `action` in medium weight, followed by a `BLOCKING` chip when
  `blocking === true`.
- Second line, muted: `category` (omit when `other`) and `reason` when
  present, separated by a middle dot.
- Expand (chevron or tap on the row) reveals `HumanActionDetails`: command
  as a mono block, `Verify:` line, link as an anchor or mono path. Same
  component the delivery card uses; iOS reuses the same rendering as
  `DeliveryPresentationView`'s follow-up actions.
- Trailing link: the objective `displayKey` with a chevron. Activating it
  expands the source delivery in layer 2 and scrolls to it.
- Cap at 6 items with `+ {n} more` expanding the rest.

**Risks.** Label `RISKS · {n}`. Open risks (§4.3). Each item: red `!` glyph,
the risk text, trailing objective key link. Phase 1 has no accept control.
Cap at 4 with `+ {n} more`.

**Decisions.** Label `DECISIONS · {n}`. All tradeoffs (§4.4), newest delivery
first. Each item is collapsed to two lines: `decision` in medium weight, then
muted `Alternatives: {alternativesConsidered joined by ", "}` (omit the line
when empty) followed by the objective key. Expanding shows `rationale` and,
when present, `Impact: {impact}`. Cap at 4 with `+ {n} more`. Decisions never
close; this list only grows.

**Candidates.** Label `CANDIDATES · {n}`. The deferred-work items of all
non-superseded deliveries whose `resolution` is `null`, newest delivery first.
Each item renders the existing `DeferredWorkItem` (web) /
`DeferredWorkItemView` (iOS) with its `+ Objective`, `+ Mission` and `Dismiss`
controls unchanged, plus a muted trailer `deferred · {objective key}`. Items
resolved from here update in place exactly as they do inside the delivery
card (same mutation, same realtime invalidation). Cap at 3 with
`+ {n} more`.

**Spawned.** Single line, label `SPAWNED`, listing the `outcomeRef` of every
deferred-work resolution with `outcome` set, across all deliveries, newest
first: missions first (`coo:1201`), then objectives (`coo:879.yz01`). Mission
refs link to that mission (web: `/user/missions/{id}`; iOS: push the mission).
Objective refs on this mission scroll to the objective row. Omitted when
empty.

### 3.3 Layer 2: the delivery list

**Filter chips.** `All · Actions · Risks · Decisions`. Single select, `All`
default. `Actions` keeps deliveries whose latest presentation has at least one
human action; `Risks` at least one known risk; `Decisions` at least one
tradeoff. An objective filter set from the mini table shows as a fifth,
removable chip `{displayKey} ×` and combines with the kind filter. Filters are
component state, not persisted.

**Rows.** Newest first by `deliveredAt`, ties by `id`. One line:

| Part | Content |
| --- | --- |
| Glyph | package icon (the one the delivery card uses) |
| Time | relative `deliveredAt`, fixed width |
| Key | objective `displayKey`, mono, muted (web) |
| Title | objective title; `· run {n}` when the objective has several runs |
| Counts | muted: `+{n} action(s)` (blue), `{n} risk(s)` (red), `{n} decision(s)`; only non-zero parts, joined by middle dots |
| Chevron | right when closed, down when open |

A superseded delivery (§4.1) renders at 60 % opacity with the counts replaced
by `superseded by run {n}`. Deliveries whose objective was deleted keep
rendering here with the title `Delivery` and no key (the web's Unassigned
evidence section continues to exist unchanged; duplication there is
acceptable in phase 1).

**Expansion.** Clicking or tapping a row toggles it. The expanded body is the
existing card body with no changes: `DeliveryPresentation` on web,
`DeliveryPresentationView` on iOS (pending spinner, markdown, follow-up
actions, tradeoffs, known risks, deferred work with controls, assumptions,
full-text accordion). Several rows may be open at once. The row header stays
visible above the body as the collapse control.

**Default open state.** When the section first mounts and the mission's
status type is `review`, the newest non-superseded delivery is open.
Otherwise all rows are closed. Activating a layer 1 link opens the target
row, closes nothing else, and scrolls so the row header is at the top of the
visible area; on the web the row gets the same `ring-2` highlight the
`?objective=` deep link uses, cleared on the next click.

**Deep link.** Web: `?delivery={id}` opens that row and scrolls to it, in
addition to the existing `?objective=`. iOS: the existing mission deep link
gains an optional `delivery` query parameter with the same effect.

## 4. Derivation rules

All rules are pure functions over `MissionDetailDto.objectives`,
`MissionDeliveriesDto.items`, and (for files) `MissionFileChangesDto.items`.
Web: `webapp/web/lib/mission-delivery-post.ts`, unit-tested. iOS: an
`OverlordCore` type `MissionDeliveryPost` with the same tests, so the watch
and widgets can reuse the headline later.

### 4.1 Runs and supersession

- A delivery belongs to the objective's **current run** when
  `objective.reopenedAt` is null or `deliveredAt >= reopenedAt`. Otherwise it
  is **superseded**. (Same boundary the web objective row uses.)
- The run number shown as `run {n}` is 1 + the number of superseded
  deliveries of that objective; a delivery in the current run shows the
  current run number, an earlier delivery its own.
- Superseded deliveries contribute nothing to layer 1 except the deliveries
  count and the file count.

### 4.2 Open human actions

- Take the **latest delivery of each objective** (newest `deliveredAt` in the
  current run). Only its `report.presentation.humanActions` count. Earlier
  deliveries of the same objective are ignored, matching the v136 rule that a
  re-delivery supersedes its predecessor's list.
- Phase 1 has no resolution state, so every such action is open.
- Dedupe across objectives by normalised `action` text (trim, lowercase,
  collapse whitespace); keep the newest.

### 4.3 Open risks

- Same selection as actions: latest delivery per objective,
  `report.presentation.knownRisks`.
- Dedupe by normalised text across objectives, keep the newest.
- Phase 1: every risk is open.

### 4.4 Decisions

- `report.presentation.tradeoffsMade` of **every** non-superseded delivery,
  not only the latest per objective: an earlier decision on the same
  objective is still a decision.
- Dedupe by normalised `decision` text, keep the newest.

### 4.5 Candidates and spawned

- Candidates: `deferredWorkItems` with `resolution === null`, non-superseded
  deliveries only.
- Spawned: every `deferredWorkItems[].resolution` with `outcome !== null`,
  all deliveries, newest first, deduped by `outcomeRef`.

### 4.6 Counts

- `delivered`: objectives with `state === 'complete'`.
- `total` objectives: all objectives on the mission.
- Files: distinct `filePath` over all file-change items, superseded included.

## 5. Behaviour

- **Realtime.** The section re-derives whenever the mission's deliveries,
  file changes, objectives or agent requests refresh; no new subscriptions.
  `delivery` and `human_action_resolution` entity changes already invalidate
  the deliveries query on the web; iOS reloads deliveries on the same
  notices it uses for the stack today.
- **Resolutions.** Promoting or dismissing a candidate from layer 1 or from
  an expanded card uses the existing deferred-work mutation; both places
  show the handled state from the same DTO after refetch.
- **Compose pending.** While any delivery is `pending`, the header shows the
  spinner (§3.1) and layer 1 derives from the deterministic presentation; it
  updates in place when the composed presentation arrives.
- **Performance.** Derivation is memoised on the deliveries, file changes and
  objectives arrays. At the 200-delivery cap this is a single pass; no
  per-delivery fetches.
- **Objective-row cards (web).** Unchanged. Expanding a delivery in layer 2
  does not open or close anything in the objectives section, and vice versa.

## 6. Loading and error states

- Deliveries loading, nothing cached: header label only, then a three-line
  skeleton in the post card.
- Deliveries error: header label, then the existing error sentence
  `Could not load objective evidence: {message}` (web) / the iOS error row,
  and no post card.
- File changes unavailable: omit the files stat and the per-row file counts;
  everything else renders.

## 7. Empty state

- No deliveries, no running objective: header `DELIVERIES · 0`, then the
  objectives mini table alone (`0 of {n} delivered`, every row planned), no
  headline, summary, stats or lists, no layer 2.
- No deliveries, an objective running: as above plus the running row with
  `live` and the one generated summary sentence (`{title} is running.`).

## 8. Accessibility

- The post card is a `<section>` with `aria-labelledby` on the headline.
- Sub-block labels are headings (`h3` on web; `.accessibilityAddTraits
  (.isHeader)` on iOS).
- Layer 1 links read as `{item text}, from objective {displayKey}`.
- Layer 2 rows are buttons with `aria-expanded`; the row text reads
  `Delivery for {objective title}, {relative time}, {counts}`.
- Colour is never the only signal: blocking has the chip text, risks the
  `!` glyph, superseded the label.

## 9. Platform notes

**Web.**
- New components under `webapp/web/components/deliveries/`:
  `MissionDeliveriesSection.tsx` (container, filters, list state),
  `MissionDeliveryPost.tsx` (layer 1), `MissionDeliveryList.tsx` and
  `MissionDeliveryRow.tsx` (layer 2, wrapping the existing
  `DeliveryPresentation`), `ObjectivesMiniTable.tsx`.
- `MissionPanel.tsx` gains one `<div className="space-y-3">` with the `h2`
  and the section, above Artifacts, passing the mission, `deliveriesQ`,
  `fileChangesQ`, objectives and the agent-request selector it already has.
- Reuse: `HumanActionDetails`, `DeferredWorkItem`, `Markdown`, the delivery
  one-sentence helper, the `ring-2` focus treatment, the `?objective=`
  scroll logic generalised to `?delivery=`.
- Width: works from 375 px; the stat row wraps, the mini table drops the
  file count under 400 px.

**iOS.**
- `MissionDeliveriesSectionView.swift` becomes the container. New:
  `MissionDeliveryPostView.swift`, `ObjectivesMiniTableView.swift`,
  `MissionDeliveryRowView.swift`. Reuse `DeliveryPresentationView`,
  `DeferredWorkItemView`, `MissionMarkdownView`.
- Layer 1's Action required, Risks, Decisions and Candidates render as a
  horizontally paging `ScrollView` of cards with page dots when the combined
  item count exceeds three; otherwise stacked vertically.
- Filter chips are a segmented `Picker`.
- Derivation lives in `OverlordCore` (`MissionDeliveryPost.swift`) with unit
  tests in `OverlordTests`.

## 10. Phase 2 (contract bump, separate objective)

Listed so the phase 1 layout leaves room; none of this is built now.

- Composed headline, summary and impact badge from a mission-level compose
  job, updated in place on each delivery and resolution; `MissionDeliveryPostDto`.
- Done / dismissed on human actions and accept / mitigated on risks, mission
  scoped, via a widened `/items/:itemId/resolution` route; risks get stable
  ids (`knownRiskItems`).
- Supersession of actions and risks by later deliveries (struck through with
  the reference, reopenable).
- Suggested objectives in Candidates with an accept route.
- `missions.deliveries_seen_at` and a `new` dot on rows.
- Post markdown and open items included in `load-context` for agents.

## 11. Acceptance (phase 1)

1. A mission with four deliveries across three objectives shows one post with
   a headline, a summary of at most three sentences plus the running sentence,
   correct counts, a six-row mini table, and the Action required / Risks /
   Decisions / Candidates blocks populated per §4.
2. Clicking an action's objective key opens the source delivery in layer 2
   and scrolls to it; the objectives section does not change.
3. Clicking a delivered mini-table row filters layer 2 to that objective; the
   filter chip removes it.
4. A delivery older than its objective's `reopenedAt` is dimmed, labelled
   superseded, and contributes nothing to the post except the two totals.
5. Promoting a candidate from layer 1 shows the handled state in layer 1 and
   in the expanded card without a reload.
6. A mission with no deliveries renders only the header and the mini table.
7. The `?delivery=` link opens and highlights the row.
8. Nothing above the section (header, objectives, draft, Notes, Terminal
   sessions) and nothing below it (Artifacts, Activity, Unassigned evidence,
   Shared state) changes in markup or behaviour; the web objective rows still
   render their delivery cards.
9. Unit tests cover §4.1 to §4.6 on both platforms.
