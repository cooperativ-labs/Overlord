# coo:973 — Migrate Auto-Advance to Queue (UI language/icons)

## Inventory (before)

User-facing Auto-Advance leftovers after Run Queue work:

### Main repo
| Location | What remained |
| --- | --- |
| `webapp/.../ObjectiveCollapsibleItem.tsx` | `FastForward` + "Auto-advance" badge |
| `webapp/.../MissionRunCard.tsx` | `FastForward` + aria-label "Auto-advance" |
| `webapp/.../DraftObjectiveActions.tsx` | `canToggleAutoAdvance` / `AUTO_ADVANCE_*` names (UI already Queue) |
| `webapp/.../DraftObjective.tsx` | Comment still said "auto-advance toggle" |
| `automations/.../rules.ts` | User-visible reason: "Auto-advance requires an assigned agent." |

Already migrated (left alone): `DraftObjectiveActions` Queue popover, `QueueNavButton` / `MissionCardBody` `ListOrdered`, AgentLaunchButton Run Queue copy.

### Mobile (`OverlordMobile`)
| Location | What remained |
| --- | --- |
| `ObjectiveComposerPanel.swift` | "Auto-advance" / "Manual start" + `forward.end.alt.fill` |
| `MissionDetailScreen.swift` | Alert "Unable to update auto-advance"; PATCH helper for existing rows |
| Future cards | Duplicate: auto-advance chip **and** Run Queue footer |

Already migrated: Queue tab (`list.number`), `queueFooter` / membership lines, Queue screen.

Out of scope: protocol/MCP/CLI `--auto-advance` compatibility flags, DTO field `autoAdvance`, internal docs/plans.

## Changes

### Web
- Collapsed objective badge → `ListOrdered` + "Queued", keyed off `queueEntry`
- Activity feed mark → `ListOrdered` + aria-label "Queued"
- Renamed queue-control state helpers; fixed DraftObjective comment
- Approval reason → "Queue launch requires an assigned agent."

### Mobile
- Composer chip → `list.number` + "Queued" / "Queue"
- Removed chip from saved future cards (queue footer is authoritative)
- Removed unused `changeObjectiveAutoAdvance` / `savingAutoAdvanceIds`
- Kept create-time `futureAutoAdvance` for the unsaved composer only
