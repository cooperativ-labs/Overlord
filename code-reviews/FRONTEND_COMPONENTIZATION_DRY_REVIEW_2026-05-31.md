# Frontend Componentization & Duplication Review

**Date:** 2026-05-31
**Scope:** `apps/web` (Next.js App Router webapp — `app/` pages and `components/`)
**Focus:** Opportunities to (a) break large/multi-concern sections into independent components with their own files, and (b) reduce duplication across the site.
**Ticket:** 1:1299

---

## Summary

The frontend is large (244 component files, 141 page files) and generally well-organized: there is a shared `components/ui/` shadcn layer, feature folders under `components/features/`, and a deliberate `ticket-view-helpers.ts` that already centralizes some board/list/calendar logic. Type safety and the use of server actions are consistent.

The two themes the ticket asks about are both present and addressable:

1. **Componentization** — a handful of files have grown into 700–1,766 line monoliths that bundle several distinct UI sections and pure helpers in one file. These are mechanical to split and would materially improve readability and testability.
2. **Duplication** — several small presentational patterns (clipboard copy, agent brand icon, project color swatch) and one large structural pattern (the settings dialog shell) are copy-pasted across many files. There is no `lib/hooks/` directory yet, so reusable client behaviors have nowhere to live and get re-implemented inline.

Severity summary for this review: **0 Critical, 4 High, 7 Medium, 3 Low.** Nothing here is a correctness or security bug — these are maintainability/DRY findings, which is what the objective targets. None of the changes below were applied; this is a review deliverable. Each item is independently shippable.

---

## High Priority

### H1 — Settings dialog shell duplicated across three modals
**Location:** `components/modals/SettingsModal.tsx`, `components/modals/ProjectSettingsModal.tsx`, `components/modals/OrganizationSettingsModal.tsx`
**Category:** DRY / Componentization

All three modals reimplement the identical shell:
- The same `DialogContent` className (`h-dvh max-h-dvh ... md:max-h-[680px] md:max-w-[900px] lg:max-w-[1000px]`)
- `SidebarProvider` + `Sidebar` with the nav-item `.map()` rendering `SidebarMenuButton`s
- A header with a **mobile page-selector `Select`** and a **desktop `Breadcrumb`** (verbatim markup, only the labels differ)
- A scrollable `<div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">` body that switches on `activeNav`

This is ~100 lines duplicated three times, kept in sync by hand (the `max-h-[680px]` magic number, the breadcrumb structure, the mobile/desktop split).

**Recommendation:** Extract a `components/modals/SettingsDialogShell.tsx` that owns the dialog chrome, sidebar, and header. It takes:
- `title: string`
- `navGroups: { label?: string; items: NavItem[] }[]`
- `activeNav` / `onActiveNavChange`
- `children` (the active page) — or a `renderPage(activeNav)` prop

Each modal then becomes nav config + a page switch, dropping ~80 lines apiece. `SettingsModal` additionally repeats its **own** three `SidebarGroup` blocks (Workflow/Application/User) that differ only by label and item list (`SettingsModal.tsx:138-191`) — these collapse into a single `navGroups.map()` once the shell exists.

---

### H2 — `CliPage.tsx` is a 1,766-line file containing many independent sections
**Location:** `components/modals/settings/CliPage.tsx`
**Category:** Componentization / Maintainability

This single file defines several self-contained components plus a pile of pure helpers:
- Components: `AgentNameWithLogo` (298), `DefaultAgentSelector` (370), `RobotAgentLabel` (385), `AgentVisibilitySection` (398), `CustomAgentsSection` (574)
- Pure helpers: `getBundleActionMeta` (327), `getSlashActionMeta` (359), `slugify` (532), `parseOptionsText` (541), `placeholdersToOptionsText` (555), `emptyDraft` (565)
- Plus several inline types (`BundleStatusEntry`, `SlashStatusEntry`, `AgentPluginInstallOption`, …)

**Recommendation:** Split into a `components/modals/settings/cli/` folder:
- `AgentVisibilitySection.tsx`, `CustomAgentsSection.tsx`, `DefaultAgentSelector.tsx`, `AgentNameWithLogo.tsx` (one file each)
- `cli-page-helpers.ts` for the pure functions (these are also unit-testable once extracted)
- `cli-page-types.ts` for the shared `BundleStatusEntry` / `SlashStatusEntry` / `AgentPluginInstallOption` types

Note the bundle/slash install logic (`BundleStatusEntry`, `SlashStatusEntry`, install/plugin handling) is **also** present in `components/features/onboarding/steps/ConnectorSetupStep.tsx` and `InstallAgentBundlesStep.tsx` — the extracted types/helpers should be shared between settings and onboarding rather than re-declared.

---

### H3 — No shared clipboard-copy hook; the pattern is re-implemented in 8+ files
**Location (all reimplement `copied` state + `setTimeout(() => setCopied(false), 2000)` + `navigator.clipboard.writeText`):**
`components/features/CopyTicketPromptButton.tsx`, `components/features/CopyTicketIdentifierButton.tsx`, `components/features/AgentSplitButton.tsx`, `components/features/CliQuickstart.tsx`, `components/features/onboarding/steps/AgentSetupStep.tsx`, `components/modals/settings/AgentsAndMcpPage.tsx`, `components/modals/settings/AgentTokensPage.tsx`, `components/marketing/AskAboutOverlordSplitButton.tsx` (and `components/features/ObjectiveMenuButton.tsx` with a `resumeCopied` variant).

Every one of these owns a `const [copied, setCopied] = useState(false)`, a try/catch around `navigator.clipboard.writeText`, and the same 2-second reset timer. There is **no `lib/hooks/` directory** in the project, so there is nowhere obvious for this behavior to live and it keeps getting copied.

**Recommendation:** Add `lib/hooks/use-copy-to-clipboard.ts`:
```ts
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), resetMs);
    } catch { /* ignore */ }
  }, [resetMs]);
  return { copied, copy };
}
```
Consider also a thin `components/ui/copy-button.tsx` (Copy/Check icon swap) for the most common "icon button that copies a string" case (`CopyTicketIdentifierButton` is exactly this). Establishing `lib/hooks/` also gives the other inline behaviors below a home.

---

### H4 — Agent brand-icon rendering duplicated in 11 files
**Location:** `components/features/AgentModelSelector.tsx`, `AgentModelChooserButton.tsx`, `AgentModelChooserTrigger.tsx`, `components/features/feed/ExecutingTicketsSection.tsx`, `components/features/ObjectiveCollapsibleItem.tsx`, `components/features/feed/FeedCard/FeedCardAgentBadge.tsx`, `components/features/onboarding/steps/AgentSetupStep.tsx`, `components/modals/settings/ExecutionTargetsPage.tsx`, `components/modals/settings/CliPage.tsx`, `app/(marketing)/page.tsx`, `app/(marketing)/demo/DemoContent.tsx`
**Category:** DRY / Componentization

The helper `getAgentTypeByIdentifier` / `getAgentTypeByValue` (`lib/helpers/agent-types`) is correctly centralized, but the **rendering** of the result is copy-pasted:
```tsx
<Image src={agentType.icon} alt={agentType.label} width={…} height={…}
       className={agentType.invertDark ? 'dark:invert' : ''} />
```
The `invertDark ? 'dark:invert' : ''` rule in particular is easy to forget and is the kind of thing that drifts.

**Recommendation:** Add `components/features/AgentIcon.tsx`:
```tsx
export function AgentIcon({ agentType, size = 16, className }: …) { … }
// or an identifier-based variant that calls getAgentTypeByIdentifier internally
```
so callers pass an identifier/agentType and a size, and the dark-invert handling lives in one place.

---

## Medium Priority

### M1 — Project-color swatch dot inlined in ~14 files
**Location:** `components/app-sidebar.tsx:142`, `components/features/QuickTaskBar.tsx:633`, `components/features/projects/DefaultProjectChooser.tsx:94`, `components/features/feed/ExecutingTicketsSection.tsx:39`, `components/features/feed/FeedProjectFilter.tsx:38`, `components/features/feed/FeedCard/FeedCardMetaLine.tsx:32`, `components/features/electron-offline/ElectronOfflineScreen.tsx:64`, `app/(app)/tickets/(components)/KanbanBoardToolbar.tsx:107`, `app/(app)/tickets/(components)/TicketListToolbar.tsx:164`, `app/(marketing)/demo/DemoContent.tsx:84`, `app/(marketing)/demo/DemoTicketPanel.tsx:199`, and others.
**Category:** DRY / Componentization

The small round project-color indicator (`<span className="size-2 rounded-full" style={{ backgroundColor: project.color }} />`) is hand-written everywhere, with minor inconsistencies in size and whether `borderColor` is also set.

**Recommendation:** `components/features/projects/ProjectColorDot.tsx` taking `color` and an optional `size`. Cheap, high-reuse.

### M2 — Hex-color → tint/rgba math is local to CalendarView and should be shared
**Location:** `app/(app)/tickets/(components)/CalendarView.tsx:69` (`parseHexColor`), `:94` (`getCalendarTicketColors`); related ad-hoc tinting in `app/(app)/tickets/(components)/TicketListCard.tsx:61` (`` `${projectColor}22` ``).
**Category:** DRY

`CalendarView` computes RGB from a hex string to derive background/border/checkbox tints. `TicketListCard` does its own string-concat alpha trick. These are the same concept (derive a faint tint from a project color) implemented two different ways.

**Recommendation:** Add `lib/helpers/color.ts` with `parseHexColor` and a `tintFromProjectColor(color, variant)` helper, and have both call sites use it. This also makes the calendar color logic testable.

### M3 — `CalendarView.tsx` (753 lines) holds four inline sub-components
**Location:** `app/(app)/tickets/(components)/CalendarView.tsx` — `CalendarNewTicketInput` (519), `CalendarDayCell` (586), `DraggableCalendarTicket` (664), `CalendarTicketOverlay` (738)
**Category:** Componentization

These are genuine standalone components (each has its own props and DnD wiring). Extracting them to `app/(app)/tickets/(components)/calendar/` would shrink the main file to the grid/state orchestration and make each cell/tile independently reviewable.

### M4 — `TicketListView.tsx` (1,081 lines) mixes filter state, persistence, DnD, and rendering
**Location:** `app/(app)/tickets/(components)/TicketListView.tsx`
**Category:** Componentization / Maintainability

`getStatusStyle` (`:115`) and the `PRIORITY_ORDER`/`DEFAULT_SELECTED_STATUSES` constants, plus the filter-equality helpers (`areStringListsEqual`, `areProjectFilterIdsEqual`, `buildStatusFilterOptions`, `sanitizeSelectedStatuses`), are pure and belong in `ticket-view-helpers.ts` (which already exists for exactly this purpose, per its own header comment). The persisted-filter + DnD-reorder logic could move into a `useTicketListFilters` hook. `getStatusStyle` should be shared with the Kanban views rather than living only here (see M5).

### M5 — Status styling not shared between List and Kanban views
**Location:** `getStatusStyle` in `app/(app)/tickets/(components)/TicketListView.tsx:115`; status/priority styling also referenced in `KanbanCard.tsx`, `TicketCardPrimitives.tsx`, `TicketListCard.tsx`.
**Category:** DRY

`formatStatusLabel` is already shared via `ticket-view-helpers.ts`, but the **color/style** mapping for a status type (`execute`→blue, `complete`→emerald, etc.) lives only in the List view. The Kanban and card primitives derive their own status/priority colors. A single `getStatusStyle(statusType, statusName)` + `getPriorityStyle(priority)` in the shared helpers would prevent the views from drifting visually.

### M6 — `PRIORITY_ORDER` constant is defined locally
**Location:** `app/(app)/tickets/(components)/TicketListView.tsx:65` (`['critical','high','medium','low']`); priority handling also in `NewTicketModal.tsx`, `QuickRunModal.tsx`, `QuickTaskBar.tsx`, `CalendarView.tsx`, `app/(app)/admin/page.tsx`.
**Category:** DRY / Consistency

The canonical priority ordering should be a single exported constant (e.g. in `lib/helpers/tickets` or `ticket-view-helpers`) so sort order and any priority selectors stay consistent across components.

### M7 — Other large multi-concern files worth splitting
**Location / line counts:** `components/features/projects/DeviceResourceList.tsx` (943), `components/modals/settings/ExecutionTargetsPage.tsx` (884), `components/features/scheduling/ScheduleEditor.tsx` (781), `components/features/projects/current-changes/DiffPane.tsx` (676), `components/features/QuickTaskBar.tsx` (651), `components/features/AgentModelSelector.tsx` (630), `components/features/projects/ProjectStatusSettings.tsx` (593).
**Category:** Componentization

These aren't as clearly decomposable as H2/M3 from the outside, but each is large enough that the device-row / target-row / schedule-section / diff-hunk units inside them are good candidates for extraction. Recommend treating these as a second wave after the clear wins above, evaluating each for inline sub-components and pure helpers the same way.

---

## Low Priority / Suggestions

### L1 — Demo components mirror real ones and risk drift
**Location:** `app/(marketing)/demo/DemoTicketPanel.tsx` ↔ `components/features/TicketPanelContent.tsx`; `app/(marketing)/demo/DemoCurrentChangesPage.tsx` ↔ `components/features/projects/CurrentChangesPage.tsx`; `DemoSettings.tsx` ↔ `SettingsModal`; `DemoContent.tsx` ↔ the real board.

The duplication here is partly intentional (mock data, no live actions, marketing styling). The risk is visual/behavioral drift as the real components evolve. **Recommendation:** where a piece is purely presentational (e.g. a ticket card, the project color dot, the agent icon), have the Demo variants consume the same extracted primitives (H4, M1) so at least the leaf visuals stay in sync. Don't attempt to merge the stateful containers.

### L2 — Establish a `lib/hooks/` convention
There is currently no hooks directory; reusable client behaviors (clipboard, the `useElectron` consumer pattern, persisted-filter logic, the `copied`-timer) end up inline. Creating `lib/hooks/` and seeding it with `useCopyToClipboard` (H3) gives future shared behaviors a home and discourages re-implementation.

### L3 — Centralize the `setTimeout`-reset "transient confirmation" pattern
Beyond clipboard, the "set true, reset after N ms" pattern appears for other transient confirmations. Once `useCopyToClipboard` exists, consider a more general `useTransientFlag(ms)` it can build on.

---

## Positive Observations

- `app/(app)/tickets/(components)/ticket-view-helpers.ts` is a good model: it explicitly documents that it exists to "prevent drift between views" and centralizes ticket↔board mapping and optimistic-ticket construction. The recommendations above mostly amount to *moving more pure logic into files like this one*.
- Agent identity is resolved through a single `lib/helpers/agent-types` module (`getAgentTypeByIdentifier` / `getAgentTypeByValue`) — only the rendering of its output is duplicated (H4), not the resolution.
- `components/ui/` (shadcn) and `components/ui/loading-button.tsx` are used consistently for async buttons, so the loading-state pattern is already well-abstracted.
- Feature folders (`features/feed/`, `features/projects/`, `features/onboarding/steps/`) show the project already favors small, file-per-component structure in newer areas — the monoliths flagged here are the exceptions, not the norm.

---

## Suggested Sequencing

1. **Quick, high-leverage primitives first (low risk):** `useCopyToClipboard` (H3) + `AgentIcon` (H4) + `ProjectColorDot` (M1) + `lib/helpers/color.ts` (M2). These are additive, each replaces many call sites mechanically, and they unblock L1.
2. **Settings shell (H1):** extract `SettingsDialogShell`, migrate all three modals.
3. **Monolith splits (H2, M3):** `CliPage` and `CalendarView` into folders.
4. **Shared ticket logic (M4, M5, M6):** move pure helpers/constants/status-styles into `ticket-view-helpers.ts`; share status styling with Kanban.
5. **Second-wave large files (M7)** and demo-primitive sharing (L1), evaluated case by case.
