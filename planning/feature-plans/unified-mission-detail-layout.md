# Unified mission detail: Brief, Plan, Evidence

**Status:** proposal, 23 Oct 2026. No implementation. Wireframes on the design
canvas "Mission Detail Layouts" (link in the session that produced this doc).
**Scope:** `webapp/web/components/MissionPanel.tsx` and
`OverlordMobile/Overlord/Views/MissionDetail/*`.
**Companions:** `coo-879-objective-centric-mission-panel.md` (web: objective rows
hold their own evidence), `coo-963-human-actions-rail.md` and
`human-actions-complete-and-actionable.md` (the cross-mission human-action rail,
removed again in contract v150 / coo:1098; the richer action shape stayed),
`deferred-work-objective-enrichment.md` (deferred work
items become objective-quality statements), `rich-delivery-messages.md`
(delivery report shape and async composition).

---

## 1. Where the two screens are today

| | Web mission panel (420px drawer) | iOS mission detail |
| --- | --- | --- |
| Grain | Objective is the container. Deliveries, file changes, sessions, earlier runs render inside the expanded objective row (coo:879). | Mission is the container. Objectives are a list at the top; DELIVERIES is a separate newest-first section further down, after terminal session, notes and artifacts. |
| Completed objectives | Edge-to-edge accordion rows, one open at a time, collapsed by default. Header carries key, title, state icon, evidence count badges. | Rows in one card with dividers. One-line title, expands to show instruction and attachments. No evidence inside. |
| Running objective | Row auto-opens once; body leads with session, blocking question, live file changes. Amber wash when blocked on a human. | Row tinted green/sky; the terminal session is a separate mission-level card below the objectives. |
| Draft / future | Editable cards in a gutter below the executed rows; future cards dimmed, collapsed until focused, drag-sortable; Promote / Run; "+ Add objective" last. | Same model: ghost card, draft composer card, future composer cards with drag handle, "Add objective" last. |
| Delivery card | Markdown, follow-up actions (read-only), tradeoffs, known risks, deferred work (promote to objective / mission / dismiss), assumptions, raw text accordion. Latest delivery open in complete mode. | Same sections, all cards collapsed by default, newest first across the whole mission. Deferred work promotion exists; follow-up actions read-only. |
| Mission-level progress | None. Status pill only. | None. Status pill only. |
| Mission-level open items | None. The cross-mission human-actions rail on `/feed` was removed in v150; only deferred work keeps a done/dismissed state. | None. |
| "What is the state now?" | Nowhere. The reader opens each objective, opens each delivery, and reconciles by hand. | Nowhere. The reader scrolls the delivery stack and reconciles by hand. |

Both screens answer "what did objective N produce" (web well, mobile adequately)
and "what just came in" (mobile well, web adequately). Neither answers "where is
this mission now, what do I owe it, what is risky, and what should come next".
That is the gap, and it is the same gap on both platforms, so one layout can
close it.

## 2. The three questions the screen has to answer

1. **Now.** What is the current state of the mission, what is running, what does
   a human have to do, what is risky, what has been deferred, and what should the
   next objective be. Must be readable in one glance without opening anything.
2. **Plan.** Which objectives exist, in which order, which are done, which is
   next, which are queued. Must stay editable: draft text, add future, reorder,
   promote, run, queue.
3. **Evidence.** For any one objective, what exactly happened: deliveries,
   sessions, file changes, earlier runs, attachments. Needed on demand, not on
   first paint.

Today both screens try to answer 1 by stacking 3. The proposal gives each
question its own region and makes the regions point at each other.

## 3. Proposed layout A (recommended for the first unified pass)

One scroll, three regions, same order on both platforms. Only the "evidence"
affordance differs: the web expands in place, iOS pushes a screen.

```
┌ header: key · title · project · status · due · (web: member, branch, timer) ─┐
│                                                                              │
│ ▌BRIEF                                                                       │
│  ●━━●━━●━━◉╌╌○╌╌○     4 delivered · 1 running · 1 next · 2 queued           │  ← objective rail
│  "Auth refactor is merged and deployed to staging. Rate limiting is         │  ← state paragraph
│   running now. Two env vars still need setting before production."           │     (composed; fallback: latest delivery lead sentence)
│  NEEDS YOU · 2            ☐ Set GEMINI_API_KEY on Railway    ⟶ coo:879.efgh │  ← open human actions, blocking first
│                           ☐ Run migration 2026…              ⟶ coo:879.abcd │     (phase 1 read-only; phase 2 done/dismiss)
│  RISKS · 1                ⚠ react-router 6.30 has 2 advisories ⟶ coo:879.efgh│  ← open known risks (accept / mitigated)
│  CANDIDATES · 3           ↳ Classify remaining 60 journal moves  [+ obj] [+ mission] [×]
│                           ↳ Apply Prettier repo-wide             [+ obj] [+ mission] [×]
│                           ↳ (suggested) Add rate-limit dashboard [+ obj] [×] │  ← deferred work + brief suggestions
│                                                                              │
│ ▌PLAN                                                                        │
│  ✓ abcd  Design objective ordering          2d · 1 📦 · 12 📄            ▸   │  ← delivered: one compact line
│  ✓ efgh  Implement accordion                 1d · 2 📦 · 30 📄            ▸   │
│  ✓ ijkl  Write docs                          3h · 1 📦 · 4 📄             ▸   │
│  ◉ mnop  Add rate limiting            live · claude · 14m   ? 1          ▾   │  ← running: open, session + question + live files
│     ┆ session card · blocking question card · live file changes              │
│  ┌ NEXT UP ─────────────────────────────────────────────────────────────┐    │
│  │ Wire the rate-limit metrics into the dashboard…           [▶ Run]    │    │  ← draft composer (unchanged)
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ⋮ qrst  Backfill counterparties for Q3                     (queued)         │  ← future: one line, drag handle, Promote
│  ⋮ uvwx  Upgrade react-router to v7                         (queued)         │
│  [+ Add objective]                                                           │
│                                                                              │
│ ▌CONTEXT                                                                     │
│  Notes · Artifacts · Activity · Unassigned evidence                          │  ← unchanged
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Brief

Mission-level, derived from the latest delivery of every objective plus the
operator's resolutions. It is the single place for "deep understanding of the
current state". Everything in it is a pointer: each item carries the objective
key it came from and opens that objective's delivery (web: expands the row and
scrolls; iOS: pushes the objective screen at the delivery).

- **Objective rail.** One node per objective in plan order. Filled = delivered,
  pulsing ring = running, hollow = next up, dashed = queued, amber dot overlay =
  blocked on a human, small stacked disc = re-run (earlier runs exist). Tapping
  a node jumps to the row in Plan. This is the "sense of progress" element: it
  grows as objectives are added and fills left to right as they deliver.
- **Counts line.** `4 delivered · 1 running · 1 next · 2 queued`. Not a percent:
  the future list is open-ended, so a percent would move backwards every time
  the operator adds work. Segmented counts never lie.
- **State paragraph.** Two to four sentences: what is true now, what is running,
  what is blocked. Phase 1 is deterministic (lead sentence of the latest
  delivery per objective, newest first, capped). Phase 2 is composed by the
  existing delivery-compose pipeline at mission level (section 7).
- **Needs you.** Open human actions across all latest deliveries, blocking first,
  with category chip and the command / verify / link details. Phase 1 is
  read-only (the v150 removal took the done/dismissed state away for reported
  actions). Phase 2 restores a done/dismissed decision, mission-scoped, on the
  existing `human_action_resolutions` table; resolved items drop out and a
  "show done" toggle reveals them struck through. See question 6: the rail was
  removed as a cross-workspace collection, and this proposal needs to know
  whether the per-action decision itself was unwanted or only the rail.
- **Risks.** Open known risks. Phase 1 read-only, deduped by text. Phase 2 gains
  accept / mitigated resolution and supersession ("resolved by coo:879.ijkl").
- **Candidates.** The next-objective bench: deferred work items (existing
  promotion flow: add objective, create mission, dismiss) plus, in phase 2,
  objectives the brief composer suggests from the current state. Accepting one
  creates a future objective, so the Plan region grows from the Brief region.
- **Collapsed state.** A mission with no deliveries shows only the rail and
  counts (one line). The Brief never pushes the draft composer below the fold on
  a fresh mission.

### 3.2 Plan

The objective list, kept, with two changes.

- **Delivered rows get one line.** Key, title, relative time, evidence badges,
  chevron. No second line of icons; agent and resource move into the expanded
  body. The user said progress on previous objectives matters but detail does
  not, so the row costs 40px, not 72px.
- **Future rows get one line too.** Drag handle, title (first line of the
  instruction), queue state, Promote on hover/swipe. The dimmed three-line
  composer card is reserved for the focused/editing state. Add objective and
  the draft composer stay exactly as they are; they are the parts that already
  work the same on both platforms.
- The running row and the draft composer are the only things open by default.

### 3.3 Evidence

Unchanged on the web: expanding a delivered row shows the coo:879 evidence stack.
On iOS, tapping a delivered row pushes an **Objective screen** with the same
stack (instruction, deliveries newest first with the latest open, file changes,
session, earlier runs, attachments). The mission-level DELIVERIES section is
removed; a delivery is always reached through its objective or through the
Brief's pointers. This is the one structural change on mobile and it is what
unifies the model: on both platforms the objective is the evidence container,
and the Brief is the mission-level reader.

Delivery cards also gain the `category` / `blocking` chips that the DTO already
carries but nothing renders, and in phase 2 the same done/dismissed control the
Brief shows for follow-up actions.

### 3.4 What is the same and what differs per platform

| | Web | iOS |
| --- | --- | --- |
| Brief | Full, above the objectives, inside the objectives surface colour. | Full, below the pill row. Needs-you / Risks / Candidates as a horizontally swipeable card row when more than three items, to save height. |
| Plan rows | Edge-to-edge accordion rows (as now). | Edge-to-edge rows with a disclosure chevron; push instead of expand. |
| Draft / future / add | Unchanged. | Unchanged. |
| Context | Notes, Artifacts, Activity, Unassigned. | Notes, Artifacts, Activity, File changes (until the objective screen exists), Terminal session card folded into the running row. |

## 4. Ideas for presenting delivery progress

The tension: a mission with six objectives and nine deliveries must still feel
like it is moving (every delivery is a win) while the reader must be able to
tell the current state from the history. The ideas below can be combined; A, C
and D are in layout A.

- **A. Objective rail.** Described above. Cheap, works at any width, doubles as
  navigation. Re-runs of an objective render as a second disc stacked behind the
  node so repeated effort is visible without lengthening the rail.
- **B. Delivery ledger.** A compact, chronological changelog inside the Brief:
  `2h · efgh · Implement accordion · +2 actions · 1 risk`. One line per delivery,
  newest first, five visible, "all 9" expands. It gives the mobile "what just
  came in" reading without un-nesting deliveries from their objectives, because
  each line is a pointer, not a card. Recommended as the second thing to add
  after the rail if the counts line proves too abstract.
- **C. Composed state paragraph.** The one element that converts a history into
  a state. The compose pipeline already has the inputs (summaries, risks,
  actions, rationales) and the guard rails (provenance, no invented actions).
  At mission level it also has the operator's resolutions, so it can say "two
  env vars still need setting" rather than listing four actions, two of which
  are done.
- **D. Open items with supersession.** Actions, risks and deferred work
  accumulate across deliveries. Showing all of them forever is noise; showing
  only the latest delivery's loses the earlier ones. Rule: an item is open until
  a human resolves it or a later delivery of the same mission explicitly
  addresses it (phase 2: the brief composer may propose "superseded by
  coo:x.y", shown struck through with the reference, reopenable by the human,
  never silently deleted).
- **E. Segmented bar.** The counts line rendered as a thin stacked bar (delivered
  / running / next / queued). Pairs with the rail on wide screens; on phones the
  rail alone is enough.
- **F. "Since you last looked."** Deliveries and brief items that arrived after
  the mission was last opened get a dot, using the same seen-stamp pattern as
  `blocking_question_seen_at`. Makes the Brief a diff, not just a snapshot.
- **G. Brief history scrubber.** Keep each composed brief; a slider shows the
  state paragraph as of each delivery. Fun for retros, not needed to ship.
- **H. Burn-down / percent.** Rejected: future objectives are open-ended, so the
  denominator moves and the number demoralises exactly when the operator plans
  more work.

## 5. Alternatives considered

- **Layout B: tabs (Now / Plan / History).** Now = Brief, Plan = objectives,
  History = chronological deliveries. Bounded height per tab, natural on iOS.
  Rejected for the first pass because it splits the single reading the user
  asked for and the web panel at 375px has no room for a tab strip above an
  accordion. Worth revisiting as the iOS divergence once the regions exist as
  components: the same three regions become three tabs.
- **Layout C: master/detail (rail on the left, Brief or objective evidence on
  the right).** Best scaling for long missions, needs a full-page mission view
  the web does not have. Keep for a future wide layout; the regions carry over.
- **Keep both philosophies, add only the Brief.** Smallest change, but mobile
  would still show deliveries twice (in the Brief pointers and the flat stack),
  and the two objective lists would keep diverging. The objective screen on iOS
  is the cost of unification and it is small (it is the web accordion body as a
  screen).

## 6. Interaction details worth deciding early

- Tapping a Brief item on the web opens the owning objective row (single-open
  accordion, scroll into view, ring highlight, as `?objective=` deep links do
  today) and expands the delivery that carries the item.
- Resolving a deferred-work item (phase 1) or a human action or risk (phase 2)
  anywhere (Brief, delivery card) updates everywhere: the realtime
  `human_action_resolution` change already invalidates the mission's deliveries.
- "Accept candidate" creates a `future` objective with the item text and the
  source objective's resource, records `objective_added` with the new display id
  (existing route), and the new row appears at the end of the queued list with a
  short highlight so the Plan visibly grows from the Brief.
- The rail node for the running objective is the only animated element on the
  screen (ring pulse). The row shimmer on the web can stay; iOS keeps the tint.
- Keyboard / VoiceOver order follows the regions: Brief items are a list with
  the objective key as the accessible name suffix.

## 7. Data and contract impact

### Phase 1: no contract change

- **Brief items** are derived client-side from `GET /api/missions/:id/deliveries`
  (both clients already load it): latest delivery per objective, human actions
  read-only, deferred work with its resolution from `deferredWorkItems`, known
  risks deduped by text.
- **Deferred-work promotion** reuses
  `PUT /api/deliveries/:deliveryId/deferred-work/:actionId/resolution` (v147,
  v150). Both clients already call it from the delivery card.
- **Counts and rail** come from the objective list already on
  `MissionDetailDto` (`objectiveCount`, `completedObjectiveCount` and
  `hasExecutingObjective` already exist on `MissionDto` for the board card).
- **State paragraph** is deterministic: lead sentence of each objective's
  latest delivery, newest first, capped at three.
- **Blocked marker** on a rail node and row comes from the open `ask` /
  structured-choice requests the web row already tracks (amber badge); the
  objective state vocabulary has no `blocked`, so nothing new is stored.
- **iOS objective screen** is view code only.

### Phase 2: contract bump (one version, listed per module)

1. **Mission brief.** `GET /api/missions/:id/brief` returns
   `MissionBriefDto { status: 'deterministic' | 'pending' | 'composed' | 'fallback'; markdown; openRisks[]; suggestedObjectives[]; superseded[]; basedOnDeliveryIds[]; generatedAt; model? }`.
   Stored in a new `mission_briefs` table (one row per mission, revisioned),
   recomposed by a `worker_jobs` type `overlord.mission.brief.v1` enqueued on
   every delivery commit and on every resolution change, debounced. Emits
   `entity_changes(entity_type = 'mission_brief')`. The composer gets the same
   bounded, redacted inputs as delivery compose plus the resolution rows; same
   provenance rules: a suggested objective must cite a deferred-work item, a
   risk, or a sentence in a summary.
2. **Action and risk resolutions.** The v150 route accepts only
   `deferred-work-*` ids. Phase 2 widens it to the other two kinds, mission
   scoped (no cross-workspace collection comes back): human actions already
   have stable ids (`human-action-N`, `rule-action-N`) and take
   `{ status: 'done' | 'dismissed' }`; known risks need ids, so `DeliveryDto`
   additively gains `knownRiskItems: { riskId, text, resolution }[]` next to
   the existing `knownRisks: string[]`, with
   `{ status: 'accepted' | 'mitigated' | 'dismissed' }`. Route:
   `PUT /api/deliveries/:id/items/:itemId/resolution`, id prefix selects the
   kind; the v150 deferred-work path stays as an alias. The migration that
   deleted non-deferred rows does not need reverting; new rows are written
   from the mission panel only.
3. **Suggested objectives acceptance.** `POST /api/missions/:id/brief/suggestions/:id/accept`
   creates the future objective and records the outcome, mirroring the
   deferred-work promotion route, so the client does not have to compose the
   objective payload.
4. **Seen stamp.** `missions.deliveries_seen_at`, set on panel open, projected as
   `MissionDto.hasUnseenDelivery` next to `hasUnseenBlockingQuestion`, feeding
   idea F and a board-card dot.
5. **Agent surface.** `overlord_load_mission_context` / Protocol `load-context`
   (`AttachResponse` already carries `previousObjectives` and `futureObjectives`
   but no deliveries) additively include `brief.markdown` and the open items.
   The brief is as useful to the next agent as to the human: it is the
   mission's current state in prose, with the open risks and the human actions
   still outstanding, without the agent calling `overlord_list_deliveries` and
   re-deriving it.

Module impacts: Database (migration: `mission_briefs`, `kind` column, seen
stamp), Core (brief projection, risk ids, resolution kind), Automations (brief
compose job and prompt), REST (three routes, two DTO additions), Protocol/MCP
(context enrichment, additive), Web and Mobile (consumers), Connector package
version bump for the richer context. Auth, Runner, Desktop, CLI retain their
interfaces (CLI may add `ovld mission brief` later).

## 8. Suggested build order

1. Web: Brief region (phase 1 data), one-line delivered rows, one-line future
   rows, category / blocking chips on follow-up actions.
2. iOS: objective screen; remove mission-level DELIVERIES; Brief region; one-line
   rows. At this point the two screens share one information architecture.
3. Backend phase 2: risk resolutions, then the composed brief, then suggestions.
4. Diversify: iOS tabs (layout B) if the single scroll proves long on a phone;
   web wide layout (layout C) when a full-page mission view exists.

## 9. Open questions

1. Should the state paragraph be composed by Gemini at mission level (cost per
   delivery, same pipeline as delivery compose) or stay deterministic? A
   deterministic brief is honest but reads like a list; a composed one reads
   like a status update but needs the provenance guard rails.
2. Do risks need a lifecycle (accepted / mitigated) or is "show the latest
   delivery's risks" enough? The lifecycle is what lets the Brief shrink over
   time.
3. Supersession: may the composer mark an earlier action or risk as addressed by
   a later delivery (shown struck through, reopenable), or must a human always
   close items?
4. On iOS, is a pushed objective screen acceptable, or must everything remain
   on one scroll? The pushed screen is what makes the two apps share a model.
5. Where should suggested next objectives live before acceptance: only in the
   Brief (recommended, keeps the plan human-authored) or auto-created as future
   objectives with a "suggested" marker?
6. The v136 rail let operators mark reported human actions done or dismissed;
   v150 removed the rail and that state together. Was the per-action decision
   itself unwanted (then "Needs you" stays read-only for good), or only the
   cross-workspace collection (then phase 2 restores it, mission scoped)?
7. Is the one-line delivered row enough, or do you want the agent and resource
   visible without expanding (second line, as today on the web)?
8. How much of the Brief should an agent see through `load-context`? All of it,
   or only the open human actions and risks?
