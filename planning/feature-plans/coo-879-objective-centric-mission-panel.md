# Objective-Centric Mission Panel

**Mission:** coo:879 (objective coo:879.hkpr)
**Status:** design proposal — nothing built yet
**Scope:** `webapp/web/components/MissionPanel.tsx` and the components it composes
**Companion:** `coo-756-objective-centric-execution.md` (the execution-side move to objectives that this panel redesign catches up with)

---

## 1. Problem

Execution is per-objective (coo:756), but the mission panel still reads mission-first. Below the objective list it stacks five mission-wide sections — Notes, Terminal session, Artifacts, Deliveries, Activity, File Changes — and the reader has to mentally join each delivery, session, and file change back to the objective that produced it (the delivery cards and Latch cards each print an objective chip precisely because the grouping is missing).

Target: **the objective row is the container for its own evidence.** A completed objective expands to show its delivery(s), then its terminal session, then its file changes. Mission-wide context (Notes, Artifacts, Activity) stays below the list.

---

## 2. Current state (verified)

### 2.1 Ordering — already what we want

`MissionObjectivesSection` renders `deriveObjectiveLifecycleView(...).orderedObjectives`, which comes from `sortObjectivesForMissionDisplay` in `automations/src/objective-manager/rules.ts`:

1. Base order: `position` → `createdAt` → `id` (`sortObjectivesByLifecycleOrder`).
2. Then grouped: **complete** (by `completedAt`, base order as tiebreak) → **executing/pending_delivery** (by `startedAt`) → **launching** (by `launchedAt`) → **draft/submitted** (base order) → **future** (base order).

The brief asks for "position, then completed_at, then created_at, matching what we show now". The existing comparator *is* that for the normal case, and it deliberately lets `completedAt` win over `position` inside the completed group so out-of-order runs (parallel objectives, run queues) read as a timeline. **Proposal: do not touch the comparator.** The redesign changes what each row contains, not where it sits. Missing timestamps sort last in their group and fall back to position, so legacy rows are unaffected.

### 2.2 Everything is already keyed by objective

| Evidence            | DTO                  | `objectiveId`       | Loaded today by                                   |
| ------------------- | -------------------- | ------------------- | ------------------------------------------------- |
| Deliveries          | `DeliveryDto`        | `string` (required) | `useMissionDeliveries(missionId)`                 |
| File changes        | `FileChangeDto`      | `string` (required) | `useMissionFileChanges(missionId)`                |
| Terminal sessions   | `TerminalSessionDto` | `string`            | `mission.terminalSessions` on `MissionDetailDto`  |
| Artifacts           | `ArtifactDto`        | `string \| null`    | `useMissionArtifacts(missionId)`                  |
| Agent session feed  | —                    | filter param        | `useAgentSessionFeed(missionId, objectiveId)`     |
| Attachments         | `ObjectiveAttachment`| `string`            | `useObjectiveAttachments(objectiveId)`            |

No new endpoints are required to group by objective: partition the mission-level query results client-side. Per-objective endpoints can come later as an optimisation.

### 2.3 What "Mark draft" does to a completed objective (backend `updateObjectiveTx`)

- Sets `state = 'draft'`, demotes any other draft to `future`, bumps revision.
- **Does not** clear `completed_at`, `started_at`, `launched_at`, `branch`, or `external_session_id`.
- **Does not** touch `deliveries`, `changed_files`, `artifacts`, `terminal_sessions`, or `execution_requests`.
- Blocks `complete → future` explicitly ("Completed objectives cannot be moved back to the future queue").
- On the next completion `completed_at` is **last-wins** (overwritten); `launched_at`/`started_at` are **first-wins** (kept from run 1).

So retention is already true at the data layer. The gaps are:

1. `DraftObjective` renders no history at all — a reverted objective looks brand new.
2. `shouldDiscardEmptiedObjective` (UI) soft-deletes a draft whose instruction text is cleared, unless it has attachments. A reverted draft with deliveries can be deleted by emptying the field, orphaning its history.
3. `ObjectiveMenuButton`'s "Mark draft" gives no hint that evidence is preserved.
4. Because `completed_at` is overwritten on re-completion, "run 1 vs run 2" must be derived from `deliveries.deliveredAt` / `sessionId`, not from objective timestamps.

---

## 3. Design options

### Option A — Evidence sections inside the objective accordion (recommended)

Keep the single flat objective list and the two card kinds we have (`ObjectiveCollapsibleItem` for executed, `DraftObjective` for editable/future). Expanding an executed objective reveals its evidence as a **flat, full-width stack** in a fixed order — **Instruction → Deliveries → Terminal session → File changes → Attachments** — separated by thin labeled rules (the `FileChangeResourceGroupHeader` pattern) that carry the counts. The rules are signposts, not accordions: primary evidence is never nested behind an inner collapsible; collapsing is reserved for secondary information (earlier runs, the reverted-draft history strip in §4.5). The header row gains compact count badges so a collapsed list still tells you which objectives have evidence.

- Pros: minimal navigation model change; the list stays a timeline; deep links (`?objective=`) already open the right accordion; reuses `DeliverySummaryCard`, `TerminalSessionCard`, `LiveFileChangeCard` unchanged.
- Cons: a long mission with several expanded objectives gets tall — mitigated by compact rows for secondary evidence (earlier runs), per-card collapsing that already exists on file-change cards, and "one open at a time" behaviour (see §4.4).

### Option B — Tabbed objective body

Same list, but the expanded body is a tab strip (Instruction · Deliveries · Session · Files) showing one pane at a time.

- Pros: bounded height per objective.
- Cons: hides the "delivery then session then files" reading order the brief asks for; tabs inside an accordion inside a scroll pane is a lot of chrome in a 375px-min panel; counts have to live in tab labels.

### Option C — Master/detail: objective list + selected-objective evidence pane

The objective list stays compact; selecting an objective swaps the region below the list to that objective's evidence. Notes/Artifacts/Activity move to a mission tab.

- Pros: cleanest scaling for missions with many objectives.
- Cons: breaks the "everything in one scroll" reading of the panel, needs selection state and a new layout, and leaves the mission-wide sections one click further away. Better suited to a future full-page mission view than to the side panel.

**Recommendation: Option A.** It honours the ordering and containment the brief specifies, keeps Notes/Artifacts below the list, and is mostly composition of existing components. Option C is worth revisiting when a full-width mission page exists.

---

## 4. Option A in detail

### 4.1 Panel layout (after)

```
┌ MissionPanelHeader ───────────────────────────────────────────┐
│ MissionTitle · MissionSettingsBar · Tags                       │
├───────────────────────────────────────────────────────────────┤
│ OBJECTIVES                                                     │
│ ┌ ✓ ⌘ Design objective ordering    coo:879.abcd  ▾ 1 📄 · 12 📁 ┐ │  ← complete, collapsed
│ ├ ✓ ⌘ Implement accordion          coo:879.efgh  ▴ 2 📄 · 30 📁 ┤ │  ← complete, expanded
│ │   Instruction                         ▸                      │ │
│ │   Deliveries (2)                      ▾                      │ │
│ │     ┌ DeliverySummaryCard (latest) ─────────────┐            │ │
│ │     └ DeliverySummaryCard (earlier, collapsed) ─┘            │ │
│ │   Terminal session                    ▾  ● running          │ │
│ │     ┌ TerminalSessionCard ───────────────────────┐           │ │
│ │   File changes (30)                   ▸                      │ │
│ │   Attachments (1)                     ▸                      │ │
│ ├ ◌ ⌘ Write docs                    coo:879.ijkl  ▾  live ─────┤ │  ← executing (shimmer)
│ └───────────────────────────────────────────────────────────────┘ │
│ ┌ DraftObjective (editable, next up) ─────────────────────────┐ │
│ └ … future objectives (sortable) …                            ┘ │
│ [+ Add objective]                                              │
├───────────────────────────────────────────────────────────────┤
│ NOTES                                                          │
│ ARTIFACTS            (mission-wide; each card shows objective chip) │
│ ACTIVITY             (mission-wide feed, Disconnect button)    │
│ UNASSIGNED EVIDENCE  (only if any delivery/file/session has no live objective) │
└ MissionSharedStateFooter ─────────────────────────────────────┘
```

Removed from the mission-level tail: **Terminal session**, **Deliveries**, **File Changes** — they move into the objectives. `AgentSessionActivity` (permission prompts/questions for the active objective) moves into the executing objective's body; the mission-wide `LiveActivityFeed` stays below.

### 4.2 Completed objective accordion — anatomy

Header (collapsed) — restructures today's `ObjectiveCollapsibleItem` header into three lines:

```
Implement accordion                                                          ▾
[✓] [agent] coo:879.efgh [✦] [📎]           2 📦 · 30 📄 · ⏱ 14m · ●  [⧉] [⋯]
🗂 webapp · ⏩ Auto-advance
```

- **Line 1 — title + chevron.** The title gets the full row width (truncation becomes rare); the chevron is the only other occupant.
- **Line 2 — informational icons.** Left: state icon (check / spinner / refresh), agent icon, display id, provenance sparkle, attachment clip. Right-aligned: the evidence badges — delivery count, file count, elapsed (`completedAt − startedAt`) when both exist — plus the Latch session dot (emerald = running, muted = exited, red = lost; only when a session exists) and the header actions (copy-session, force-disconnect while executing, kebab). Zero-count badges are omitted.
- **Line 3 — resource folder + queue status.** The resource label and auto-advance / run-queue indicator, as in today's secondary row, no longer indented under an icon column.

Body (expanded) — a flat, full-width stack. Sections are separated by thin labeled rules (line — `DELIVERIES · 2` — line, 10–11px uppercase, `fg3`), not by nested collapsibles; only secondary rows collapse:

1. **Instruction** — plain, exactly as today's expanded body: branch line, agent session id, `InlineEditField` (disabled). No wrapper to open, no indent.
2. **Deliveries (n)** — rule, then `MissionDeliveryList` filtered to this objective, newest first. The latest delivery is the open card; earlier ones are compact collapsed rows labelled *Run 1 of 2* using `deliveredAt` order (not objective timestamps, see §2.3 item 4) — the one place collapsing is used here, because earlier runs are secondary. Each delivery card keeps its existing verification/follow-up/report sections.
3. **Terminal session** — rule, then the card, full width. `TerminalSessionCard` for a `running` session; an exited session renders as the compact `OtherSessionRow`-style row instead of the full card. Multiple sessions (re-launches) render newest as the card/row and older ones as further compact rows. The objective chip inside the card becomes redundant and is dropped when rendered in-objective.
4. **File changes (n)** — rule (carrying the count), then the `LiveFileChanges` body filtered to this objective, flat and grouped by resource via `groupMissionFileChanges`. Long lists stay manageable because each `LiveFileChangeCard` already collapses individually — no extra section-level nesting.
5. **Attachments (n)** — as today, only when present.

Section order is fixed and mirrors the brief: delivery → session → files.

Empty states inside an expanded completed objective: "No delivery recorded" / "No terminal session" / "No file changes" as one-line muted italics, so a reader can tell "ran with no changes" from "still loading".

### 4.3 Executing / pending-delivery objective accordion

Same flat shell, different order — the live things come first:

1. **Terminal session** — leads the stack, full card, no rule above it.
2. **Agent activity** — `AgentSessionActivity` for this objective (questions, permissions), full width.
3. **File changes (n)** — rule with count and a `live` tag, then the flat live list (already SSE-invalidated).
4. **Deliveries** — shown only if a prior delivery exists (pending_delivery re-attach), as a compact collapsed row (secondary).
5. **Instruction** — last, plain text under its rule.

The shimmer sweep, spinner, and Force-disconnect affordance stay on the header exactly as today.

### 4.4 Interaction rules

- One executed objective open at a time by default (accordion semantics), so the timeline stays scannable. Shift-click (or a settings toggle) allows multiple. `?objective=` deep links open that objective and scroll it into view as today.
- The only per-section open/closed state is on secondary rows (earlier runs, individual file-change cards, the history strip); it lives in component state for the panel's lifetime, not persisted. Primary sections have no open/closed state — they are always rendered.
- Collapsed executed objectives still mount `LatchSessionTracker` for their running sessions (today's behaviour must survive: collapsed ≠ unwatched).
- Deliveries/file changes are fetched once per mission (existing hooks) and partitioned with a memoised selector; nothing is fetched per-objective on expand. If a mission grows very large, swap the selector for per-objective endpoints without changing the components.

### 4.5 Draft objective with history (the reversion case)

When a completed objective is set back to draft it renders as `DraftObjective` (editable instruction, toolbar, run button) **plus a read-only history strip** between the instruction body and the attachments/toolbar footer:

```
┌ DraftObjective ──────────────────────────────────────────────────────┐
│ Implement accordion                                                    │
│ …instruction text (editable)…                                          │
│ ┌ Previous runs ───────────────────────────────── 1 delivery · 30 files ▸ ┐ │
│ │  (expanded)                                                         │ │
│ │  Run 1 · completed 30 Aug 14:02 · 14m · claude-fable-5             │ │
│ │    Delivery ▸   Terminal session (exited) ▸   File changes (30) ▸  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ 📎 attachments · [agent ▾] [model ▾] [⏩] [Run ▸]                       │
└────────────────────────────────────────────────────────────────────────┘
```

- Condition for the strip: the objective has ≥1 delivery, file change, or terminal session (derived client-side from the partition; optionally a `hasHistory` hint on `ObjectiveDto` later).
- The strip reuses the exact sub-section components from §4.2, so evidence renders identically whether the objective is complete or draft.
- Instruction editing stays enabled (state is draft), and re-running produces a new delivery that will appear as *Run 2* once the objective completes again.
- Same strip applies to `submitted`/`launching` objectives that carry history.

### 4.6 Guard rails for retention

1. **Discard guard** — extend `shouldDiscardEmptiedObjective` (or the caller in `DraftObjective`) to refuse self-deletion when the objective has history (`deliveryCount > 0 || fileChangeCount > 0 || sessionCount > 0`), the same way `attachmentCount > 0` already does. Clearing the text then just leaves a blank draft.
2. **"Mark draft" copy** — `ObjectiveMenuButton` confirms with: *"Returns this objective to Draft so it can be edited and run again. Its deliveries, file changes, and terminal session are kept as previous runs."* The force-disconnect dialog gets the same last sentence.
3. **Server** — no change needed to retain data. One optional hardening: `updateObjectiveTx` could stamp a `reopened_at` (or append to a small `objective_runs` ledger) so run boundaries do not depend on inferring them from `deliveries.deliveredAt`. Not required for phase 1.
4. **Delete objective** is a soft delete (`deleted_at`); evidence rows survive but lose their live parent. The panel surfaces those under **Unassigned evidence** (§4.1) rather than dropping them silently — this also covers artifacts with `objectiveId = null` and deliveries whose objective was deleted.

### 4.7 Mission-wide sections that remain

- **Notes** — unchanged.
- **Artifacts** — stays a flat mission list per the brief. Each card gains an objective chip (`coo:879.efgh`) when `objectiveId` is set, and cards are sorted newest first. Not moved into objectives because artifacts are frequently mission-scoped (plans, decisions) and updated across objectives via `update-artifact`.
- **Activity** — the mission-wide `LiveActivityFeed` stays; per-objective agent-session activity moves into the executing objective.
- **Shared state footer** — unchanged.

---

## 5. Component plan (for the build objective — not started)

New:

- `objectives/ObjectiveEvidenceSections.tsx` — renders the ordered sub-sections given `{ objective, deliveries, sessions, fileChanges, attachments, mode: 'complete' | 'active' | 'history' }`.
- `objectives/ObjectiveEvidenceRule.tsx` — the thin labeled rule (line — label · count — line) that separates sections; no collapse behaviour.
- `objectives/ObjectiveHistoryStrip.tsx` — the "Previous runs" wrapper used inside `DraftObjective`.
- `lib/objective-evidence.ts` — `partitionMissionEvidence({ objectives, deliveries, fileChanges, terminalSessions, artifacts })` → `Map<objectiveId, ObjectiveEvidence>` plus `unassigned`. Pure, unit-tested.
- `objectives/ObjectiveEvidenceBadges.tsx` — header count badges.
- `UnassignedEvidenceSection.tsx` — mission-level fallback.

Modified:

- `MissionPanel.tsx` — drop mission-level Terminal/Deliveries/File Changes sections; load deliveries + file changes once and pass the partition down; add Unassigned section.
- `MissionObjectivesSection.tsx` — thread evidence into `ObjectiveCollapsibleItem` and `DraftObjective`; single-open accordion behaviour for executed rows.
- `ObjectiveCollapsibleItem.tsx` — header badges; body becomes `ObjectiveEvidenceSections`.
- `DraftObjective.tsx` — render `ObjectiveHistoryStrip` when history exists; discard guard.
- `ObjectiveMenuButton.tsx` — confirmation copy for "Mark draft".
- `TerminalSessionsSection.tsx` / `LiveFileChanges.tsx` / `MissionDeliveriesSection.tsx` — extract their list bodies so they accept pre-filtered arrays and a `hideObjectiveChip` flag.
- `automations/src/objective-manager/rules.ts` — `shouldDiscardEmptiedObjective` gains a `hasHistory` option.

Contract impact: **none required for phase 1** (all DTOs already carry `objectiveId`). Optional later additions to `ObjectiveDto`: `deliveryCount`, `fileChangeCount`, `hasHistory` — additive, non-breaking; list here per `CONTRACT.md` before adding.

Phasing:

1. Partition selector + evidence sections inside completed/executing accordions; remove the three mission-level sections; Unassigned fallback.
2. History strip in `DraftObjective`; discard guard; menu copy.
3. Artifact objective chips; badges polish; optional per-objective endpoints if partition cost shows up.

---

## 6. Open questions for the PM

1. **Single-open vs multi-open** executed accordions — the design defaults to single-open with shift-click for multi. OK, or always multi-open?
2. ~~Instruction collapsed by default once a delivery exists~~ — resolved: evidence renders as a flat stack with no nested collapsibles; the instruction is always visible in an expanded objective (feedback on the design canvas, 31 Aug 2026).
3. **Artifacts stay flat** with an objective chip (§4.7). Would you prefer artifacts also grouped into objectives, with mission-scoped ones (`objectiveId = null`) remaining below?
4. **Run boundaries** — infer from `deliveredAt` (no schema change) or add an explicit `objective_runs` ledger / `reopened_at` stamp? Phase 1 assumes inference.
5. Should "Mark draft" on a completed objective require a confirmation dialog at all, or is a toast ("History kept as previous runs") enough?
