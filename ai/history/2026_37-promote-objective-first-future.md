# Week 37, 2026 (7–13 Sep)

Consolidated from per-objective reports created this week.

## coo:954.jsn2 — Promote objective to first future (2026-09-07)

Promoting a future objective already spliced the current draft into the first
future slot on the server. The mission panel then ignored that order: its
local future-list merge kept remaining futures and appended the new id, so the
demoted draft jumped to last. Membership changes now take the server order, so
the demoted draft stays first and the rest of the future queue is preserved.

## coo:973 — Migrate Auto-Advance to Queue (UI language/icons) (2026-09-08)

Swept remaining user-facing "Auto-Advance" language/icons left over from the
Run Queue migration. Web: collapsed objective badge and activity feed mark
switched from `FastForward` to `ListOrdered` + "Queued"; renamed
queue-control state helpers; fixed a stale comment in `DraftObjective.tsx`;
automation approval reason reworded to "Queue launch requires an assigned
agent." Mobile (OverlordMobile): composer chip switched to `list.number` +
"Queued"/"Queue"; removed the duplicate auto-advance chip from saved future
cards (queue footer is authoritative); removed unused
`changeObjectiveAutoAdvance`/`savingAutoAdvanceIds`; kept `futureAutoAdvance`
only for the unsaved composer's create-time payload. Out of scope:
protocol/MCP/CLI `--auto-advance` compatibility flags, the `autoAdvance` DTO
field, and internal docs/plans.

## coo:986.z9p7 — Narrow deferred work to out-of-mission recommendations (2026-09-09)

Deferred work is now only a recommended new objective outside the current
mission. Agent instructions, persist-time filtering, and compose-delivery all
omit items that restate planned sibling work, leftover current-objective
slices, or human follow-up. `agentReport.deferredWork` stays verbatim;
presentation and the Feed rail show the eligible subset. Rail ids follow the
matching agent-report index so omitted earlier items do not steal identity.
Connector version bump ships with the instruction change.

## coo:990.8njd — Collapse previous Latch sessions behind an accordion (2026-09-09)

The mission-level Terminal sessions section again shows one current Latch card,
with every other session collapsed into an accordion under its controls. The
current card is the newest live session (running or stopping), falling back to
the newest session overall when nothing is live. The accordion trigger counts
other still-running connections when any exist; otherwise it reads as
"N previous sessions". Objective rows keep the one-line Latch attach / End
session strip from coo:990.3a2n. No contract change.
