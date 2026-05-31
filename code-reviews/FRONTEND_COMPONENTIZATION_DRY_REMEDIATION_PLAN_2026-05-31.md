# Frontend Componentization & Duplication — Remediation Plan

**Date:** 2026-05-31
**Companion to:** `code-reviews/FRONTEND_COMPONENTIZATION_DRY_REVIEW_2026-05-31.md`
**Scope:** `apps/web` (Next.js App Router webapp)
**Ticket:** 1:1299

This plan turns every finding in the review (4 High, 7 Medium, 3 Low) into concrete, independently-shippable work items with target files, signatures, migration steps, test guidance, and a verification checklist. Items are ordered by the review's suggested sequencing (lowest-risk shared primitives first), so each phase can ship as its own PR.

---

## Corrections discovered while grounding this plan

Two premises in the review were checked against the current tree and turned out to be already partially satisfied. The plan below reflects the **actual** state, not the review's assumption:

1. **`lib/hooks/` already exists.** The web app's `@/lib/*` alias resolves to the **repo-root** `lib/` (`apps/web/tsconfig.json` → `"@/lib/*": ["../../lib/*"]`), not `apps/web/lib`. `lib/hooks/` is already populated (`use-mobile.ts`, `use-online-status.ts`, `use-feed-realtime.ts`, `use-ticket-realtime.ts`, `use-executing-feed-tickets.ts`, `use-execution-request-launcher.ts`, `use-ticket-objectives-realtime.ts`). So H3/L2 do **not** require creating the directory or establishing the convention — the new hook simply slots in. The review's "there is no `lib/hooks/` directory" rationale is void; the dedup work itself still stands.
2. **`lib/helpers/color.ts` already exists** but currently only exports `normalizeHexColor(value)` (a validator). M2 is therefore an **extension** of that file (add `parseHexColor` + `tintFromProjectColor`), not a new file.

Confirmed magnitudes (grep on current tree, equal to or larger than the review's estimates):
- `navigator.clipboard.writeText` appears in **14** files (review said 8+).
- `invertDark` agent-icon rendering appears in **10** files.
- project-color dot (`rounded-full` + inline `backgroundColor`) appears in **~22** files (review said 14).
- `getStatusStyle` + `PRIORITY_ORDER` confirmed local to `TicketListView.tsx` (lines 115 and 65).

Line counts confirmed: `CliPage.tsx` 1,766 · `TicketListView.tsx` 1,081 · `DeviceResourceList.tsx` 943 · `ExecutionTargetsPage.tsx` 884 · `ScheduleEditor.tsx` 781 · `CalendarView.tsx` 753 · the three settings modals 262 / 257 / 207.

---

## Guiding principles for the whole effort

- **Pure refactor, no behavior change.** Every item is a move/extract. The visual and functional output must be byte-for-byte equivalent unless a finding explicitly unifies a divergence (M5 status styling), in which case the chosen canonical behavior is called out and confirmed before merge.
- **One finding per PR.** Each item below is sized to be reviewed and reverted independently. Do not bundle a primitive extraction with its 14 call-site migrations across unrelated features into one giant PR — see the per-item "PR slicing" notes.
- **Migrate, don't leave parallel copies.** When a primitive is extracted, the same PR (or an immediate follow-up) replaces the inline copies. Leaving the old inline versions in place defeats the purpose and creates a third source of drift.
- **Add tests for anything that becomes pure.** The main payoff of extracting `cli-page-helpers`, `color.ts` math, and the ticket helpers is that they become unit-testable. New `tests/` coverage is part of "done" for those items, not optional.
- **Snapshot/visual diff the leaf primitives.** `AgentIcon`, `ProjectColorDot`, and the status-style mapping are visual. Verify with a side-by-side in Storybook-less fashion: render before/after in a scratch route or rely on the existing demo/marketing pages that already exercise them.

---

## Phase 1 — Shared primitives (low risk, high leverage)

These are additive and each replaces many call sites mechanically. They unblock L1 (demo components can consume them). Land them first.

### 1A — `useCopyToClipboard` hook (addresses H3, L2, L3)

**New file:** `lib/hooks/use-copy-to-clipboard.ts`

```ts
import { useCallback, useRef, useState } from 'react';

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
        return true;
      } catch {
        return false;
      }
    },
    [resetMs]
  );

  return { copied, copy };
}
```

> Improvement over the inline copies: a `useRef`'d timer so rapid re-clicks don't stack timeouts, and `copy` returns a boolean so callers that need to branch on success can. The review's snippet leaks the timer; this version clears it.

**Optional companion (H3 second half):** `components/ui/copy-button.tsx` — a small icon button that swaps Copy/Check using the hook, for the "icon button that copies a string" case. `CopyTicketIdentifierButton.tsx` is exactly this and becomes a thin wrapper or is deleted in favor of it.

**Call sites to migrate (14):**
`components/features/CopyTicketPromptButton.tsx`, `CopyTicketIdentifierButton.tsx`, `AgentSplitButton.tsx`, `CliQuickstart.tsx`, `ObjectiveMenuButton.tsx` (has a `resumeCopied` variant → two independent hook instances, or one keyed call), `components/features/onboarding/steps/AgentSetupStep.tsx`, `components/features/projects/graph/ExportGraphMenu.tsx`, `components/features/feed/FeedPostDiscussPanel.tsx`, `components/modals/settings/AgentsAndMcpPage.tsx`, `AgentTokensPage.tsx`, `ExecutionTargetsPage.tsx`, `components/marketing/AskAboutOverlordSplitButton.tsx`, `app/(marketing)/demo/DemoSettings.tsx`. (`components/ui/error-boundary.tsx` also writes to clipboard but is a distinct "copy error details" one-shot with no `copied` state — leave it or migrate opportunistically; not part of the duplicated pattern.)

**PR slicing:** PR 1 adds the hook + (optional) `CopyButton` and migrates ~5 of the simplest call sites as proof. PR 2 migrates the rest. Each migration is: delete local `useState(false)` + try/catch + `setTimeout`, replace with `const { copied, copy } = useCopyToClipboard()`.

**Tests:** `tests/lib/hooks/use-copy-to-clipboard.test.ts` — mock `navigator.clipboard.writeText`, assert `copied` flips true then false after `resetMs` (fake timers), and that a rejected write keeps `copied` false and returns `false`.

**Done when:** zero remaining inline `setTimeout(() => setCopied(false), 2000)` clipboard blocks in `components/`/`app/` (grep clean), hook test passes.

---

### 1B — `AgentIcon` component (addresses H4)

**New file:** `components/features/AgentIcon.tsx`

```tsx
import Image from 'next/image';
import { getAgentTypeByIdentifier, type AgentType } from '@/lib/helpers/agent-types';

type AgentIconProps = {
  agentType?: AgentType;          // pass resolved type…
  identifier?: string;            // …or an identifier to resolve internally
  size?: number;                  // default 16
  className?: string;
};

export function AgentIcon({ agentType, identifier, size = 16, className }: AgentIconProps) {
  const resolved = agentType ?? (identifier ? getAgentTypeByIdentifier(identifier) : undefined);
  if (!resolved?.icon) return null;
  return (
    <Image
      src={resolved.icon}
      alt={resolved.label}
      width={size}
      height={size}
      className={[resolved.invertDark ? 'dark:invert' : '', className].filter(Boolean).join(' ')}
    />
  );
}
```

Centralizes the `invertDark ? 'dark:invert' : ''` rule that is the easy-to-forget drift point.

**Call sites to migrate (10–11):** `AgentModelSelector.tsx`, `AgentModelChooserButton.tsx`, `AgentModelChooserTrigger.tsx`, `feed/ExecutingTicketsSection.tsx`, `ObjectiveCollapsibleItem.tsx`, `feed/FeedCard/FeedCardAgentBadge.tsx`, `onboarding/steps/AgentSetupStep.tsx`, `modals/settings/ExecutionTargetsPage.tsx`, `modals/settings/CliPage.tsx` (its internal `AgentNameWithLogo` — coordinate with H2), `app/(marketing)/page.tsx`, `app/(marketing)/demo/DemoContent.tsx`.

**Watch-outs:** some call sites wrap the `<Image>` in size-specific containers or add `rounded`; keep `className` passthrough so those keep working. Confirm `AgentType` is the exported type name in `lib/helpers/agent-types.ts` (adjust import if it differs).

**Tests:** light — render with `invertDark: true` type asserts `dark:invert` class present; with a falsy icon renders nothing. Co-locate or `tests/components/agent-icon.test.tsx`.

**PR slicing:** one PR; it's a leaf component and the migrations are one-liners. Hold the `CliPage.tsx` call site for the H2 PR to avoid editing that monolith twice.

---

### 1C — `ProjectColorDot` component (addresses M1)

**New file:** `components/features/projects/ProjectColorDot.tsx`

```tsx
type ProjectColorDotProps = {
  color: string | null | undefined;
  size?: number;        // px, default 8 (the prevailing size-2)
  className?: string;
  withBorder?: boolean; // some call sites also set borderColor
};

export function ProjectColorDot({ color, size = 8, className, withBorder }: ProjectColorDotProps) {
  return (
    <span
      className={['inline-block rounded-full', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        backgroundColor: color ?? 'transparent',
        ...(withBorder ? { border: `1px solid ${color ?? 'transparent'}` } : {})
      }}
    />
  );
}
```

**Call sites (~22):** `app-sidebar.tsx`, `QuickTaskBar.tsx`, `projects/DefaultProjectChooser.tsx`, `feed/ExecutingTicketsSection.tsx`, `feed/FeedProjectFilter.tsx`, `feed/FeedCard/FeedCardMetaLine.tsx`, `electron-offline/ElectronOfflineScreen.tsx`, `app/(app)/tickets/(components)/KanbanBoardToolbar.tsx`, `TicketListToolbar.tsx`, `app/(marketing)/demo/DemoContent.tsx`, `DemoTicketPanel.tsx`, and the rest surfaced by grep.

**Watch-out:** the ~22 grep hits for `rounded-full` + `backgroundColor` include non-project dots (status/agent indicators). **Audit each hit** before swapping — only migrate the ones that render a *project* color. Don't blindly replace.

**PR slicing:** PR 1 adds the component + migrates the unambiguous project-dot sites (sidebar, toolbars, feed filter). PR 2 mops up the rest after audit.

**Tests:** trivial render test (size, backgroundColor style) — optional given how thin it is; rely on visual check in the sidebar/board.

---

### 1D — Extend `lib/helpers/color.ts` with tint math (addresses M2)

**Edit existing file:** `lib/helpers/color.ts` (keep `normalizeHexColor`).

Add:

```ts
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export type TintVariant = 'background' | 'border' | 'checkbox';

export function tintFromProjectColor(color: string, variant: TintVariant): string {
  const rgb = parseHexColor(color);
  if (!rgb) return 'transparent';
  const alpha = variant === 'background' ? 0.13 : variant === 'border' ? 0.4 : 0.85;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
```

> The exact alpha values must be **lifted from the current `CalendarView` implementation** (`CalendarView.tsx:69` `parseHexColor`, `:94` `getCalendarTicketColors`) so the calendar looks identical after the move — the constants above are placeholders. `TicketListCard.tsx:61` currently does `` `${projectColor}22` `` (hex alpha `22` ≈ 0.13) → it becomes `tintFromProjectColor(projectColor, 'background')`, which must equal the old appearance.

**Call sites:** `CalendarView.tsx` (delete its local `parseHexColor`/`getCalendarTicketColors`, import from helper), `TicketListCard.tsx` (replace the string concat).

**Tests:** `tests/lib/helpers/color.test.ts` — `parseHexColor` on valid/invalid/with-and-without `#`; `tintFromProjectColor` returns expected rgba per variant and `transparent` on bad input. This is the biggest correctness win of the phase, so test it properly.

**PR slicing:** one PR; it's two call sites and pure functions. Do this **before** M3 (CalendarView split) so the split file already imports the shared helper.

---

## Phase 2 — Settings dialog shell (H1)

**New file:** `components/modals/SettingsDialogShell.tsx`

Owns: the `DialogContent` chrome (the `h-dvh max-h-dvh … md:max-h-[680px] md:max-w-[900px] lg:max-w-[1000px]` className — captured once), `SidebarProvider` + `Sidebar` with grouped nav rendering, the mobile `Select` / desktop `Breadcrumb` header, and the scrollable body wrapper.

**Proposed contract:**

```tsx
export type SettingsNavItem = { name: string; icon: React.ElementType; electronOnly?: boolean };
export type SettingsNavGroup = { label?: string; items: SettingsNavItem[] };

type SettingsDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  navGroups: SettingsNavGroup[];
  activeNav: string;
  onActiveNavChange: (name: string) => void;
  children: React.ReactNode;          // the active page
};
```

**Migration:**
- `SettingsModal.tsx` — its three `SidebarGroup` blocks (Workflow/Application/User, lines ~138–191) collapse into a single `navGroups` array driving `navGroups.map()` inside the shell. Body becomes the existing `activeNav` page switch passed as `children`. The `electronOnly` filtering (via `useElectron`) stays in `SettingsModal` when it builds `navGroups`, so the shell stays dumb.
- `ProjectSettingsModal.tsx` and `OrganizationSettingsModal.tsx` — same treatment; each becomes nav config + a page switch. Expect ~80 lines removed apiece.

**Risk:** medium — this is shared chrome behind three real dialogs (one of which has the mobile/desktop responsive split). Verify: open each of the three modals at desktop and mobile widths, switch every nav item, confirm breadcrumb + mobile select both reflect selection, confirm scroll body and close button behave. The `max-h-[680px]` magic number now lives in exactly one place.

**Tests:** a render test that the shell renders all nav items across groups and calls `onActiveNavChange` on click. Full visual verification is manual per modal.

**PR slicing:** one PR (the three modals must move together — leaving one un-migrated keeps the duplication). Land after Phase 1 so the shell can already use `AgentIcon` etc. where relevant.

---

## Phase 3 — Monolith splits

### 3A — `CliPage.tsx` → `cli/` folder (H2)

**New folder:** `components/modals/settings/cli/`

Move, one component per file:
- `AgentVisibilitySection.tsx`
- `CustomAgentsSection.tsx`
- `DefaultAgentSelector.tsx`
- `AgentNameWithLogo.tsx` (or delete in favor of `AgentIcon` from 1B if equivalent — check whether it adds label text; if so it wraps `AgentIcon`)
- `RobotAgentLabel.tsx`

Pure helpers → `cli/cli-page-helpers.ts`: `getBundleActionMeta`, `getSlashActionMeta`, `slugify`, `parseOptionsText`, `placeholdersToOptionsText`, `emptyDraft`.

Shared types → `cli/cli-page-types.ts`: `BundleStatusEntry`, `SlashStatusEntry`, `AgentPluginInstallOption`.

`CliPage.tsx` remains as the orchestrating container that composes the sections.

**Critical dedup (the real point of H2):** the same `BundleStatusEntry` / `SlashStatusEntry` / install-plugin handling is **re-declared** in `components/features/onboarding/steps/ConnectorSetupStep.tsx` and `InstallAgentBundlesStep.tsx`. The extracted `cli-page-types.ts` (and any pure install-status helper) must be **imported by onboarding too**, not just settings. If the types live under `modals/settings/cli/`, consider hoisting the *shared* ones to `lib/helpers/agent-bundles.ts` (or similar) so both feature areas import from a neutral location rather than settings importing onboarding or vice-versa. Decide the home before moving.

**Tests:** `tests/components/cli/cli-page-helpers.test.ts` — `slugify`, `parseOptionsText` ↔ `placeholdersToOptionsText` round-trip, `getBundleActionMeta`/`getSlashActionMeta` for each status. These are now trivially testable, which justifies the split.

**Risk:** medium-high (large file, real logic). Pure mechanical moves keep risk down; the type-unification with onboarding is the part to review carefully. Verify the CLI settings page renders, agent visibility toggles, custom-agent create/edit flow, and bundle/slash install actions all still work, and that onboarding connector/bundle steps still build and run.

**PR slicing:** PR 1 — extract components + helpers + types *within* `cli/`, `CliPage` re-imports them (no onboarding change). PR 2 — unify the duplicated types/helpers with onboarding. Two PRs keep the diff reviewable.

### 3B — `CalendarView.tsx` → `calendar/` folder (M3)

**New folder:** `app/(app)/tickets/(components)/calendar/`

Extract: `CalendarNewTicketInput.tsx` (519), `CalendarDayCell.tsx` (586), `DraggableCalendarTicket.tsx` (664), `CalendarTicketOverlay.tsx` (738). Each has its own props + DnD wiring. `CalendarView.tsx` keeps grid/state orchestration.

**Dependency:** do **after** 1D so the extracted cells import `tintFromProjectColor` from `lib/helpers/color.ts` instead of the now-removed local math.

**Risk:** medium — DnD (`@dnd-kit`) context must remain intact across the file boundary; the draggable/overlay split is the sensitive part. Verify drag-to-reschedule, drag overlay rendering, the inline new-ticket input on a day cell, and multi-day rendering after the split.

**PR slicing:** one PR; it's internal to the calendar feature.

---

## Phase 4 — Shared ticket logic (M4, M5, M6)

Target file (already exists and is documented as the anti-drift home): `app/(app)/tickets/(components)/ticket-view-helpers.ts`.

### 4A — Move pure constants/helpers out of `TicketListView.tsx` (M4)

Move into `ticket-view-helpers.ts`: `PRIORITY_ORDER` (line 65), `DEFAULT_SELECTED_STATUSES`, and the pure filter helpers `areStringListsEqual`, `areProjectFilterIdsEqual`, `buildStatusFilterOptions`, `sanitizeSelectedStatuses`.
Optionally extract the persisted-filter + DnD-reorder logic into a `useTicketListFilters` hook (new `lib/hooks/use-ticket-list-filters.ts`) — note `lib/helpers/ticket-list-filters.ts` already exists, so check for overlap and put pure parts there, stateful parts in the hook.

### 4B — Share status styling between List and Kanban (M5)

Move `getStatusStyle(statusType, statusName)` (TicketListView:115) into the shared helpers and add a sibling `getPriorityStyle(priority)`. Then have `KanbanCard.tsx`, `TicketCardPrimitives.tsx`, and `TicketListCard.tsx` consume them instead of their own status/priority color derivations.

> **Behavior decision (not a pure move):** the Kanban/card primitives currently derive their *own* colors, which may not match the List view's `execute`→blue / `complete`→emerald mapping. Unifying them means picking one canonical mapping. **Confirm the List view's mapping is the desired canonical one** (or get a design call) before merging, because this is the one item in the whole plan that can visibly change Kanban appearance. Screenshot Kanban before/after.

### 4C — Single canonical `PRIORITY_ORDER` (M6)

Export `PRIORITY_ORDER` once (from `ticket-view-helpers.ts` or `lib/helpers/tickets.ts`) and replace the local copies in `NewTicketModal.tsx`, `QuickRunModal.tsx`, `QuickTaskBar.tsx`, `CalendarView.tsx`, and `app/(app)/admin/page.tsx`.

**Tests:** `tests/.../ticket-view-helpers.test.ts` (extend if present) — `getStatusStyle`/`getPriorityStyle` return expected classes per input; the filter-equality helpers; `PRIORITY_ORDER` ordering and `sanitizeSelectedStatuses` edge cases.

**Risk:** M4/M6 low (pure moves), M5 medium (visual unification). 

**PR slicing:** PR 1 = M4 + M6 (pure, safe). PR 2 = M5 (visual, needs the canonical-mapping confirmation). Keep them separate so the safe moves aren't blocked on the design call.

---

## Phase 5 — Second-wave large files (M7) and demo primitives (L1)

### 5A — M7 large-file decomposition (evaluate case by case)

Treat as a follow-up wave; each needs its own short investigation (find the inline sub-components / pure helpers the same way H2/M3 were analyzed):
- `components/features/projects/DeviceResourceList.tsx` (943) → device-row extraction
- `components/modals/settings/ExecutionTargetsPage.tsx` (884) → target-row extraction (also a clipboard + AgentIcon consumer — coordinate with Phase 1)
- `components/features/scheduling/ScheduleEditor.tsx` (781) → schedule-section extraction
- `components/features/projects/current-changes/DiffPane.tsx` (676) → diff-hunk extraction
- `components/features/QuickTaskBar.tsx` (651)
- `components/features/AgentModelSelector.tsx` (630)
- `components/features/projects/ProjectStatusSettings.tsx` (593)

Each becomes its own ticket/PR; do not batch. No behavior change; verify the host feature after each.

### 5B — L1 demo primitive sharing

Once 1B (`AgentIcon`) and 1C (`ProjectColorDot`) exist, have the marketing/demo variants (`DemoTicketPanel.tsx`, `DemoContent.tsx`, `DemoCurrentChangesPage.tsx`, `DemoSettings.tsx`) consume the **leaf** primitives so visuals stay in sync. **Do not** attempt to merge the stateful demo containers with their real counterparts — the mock-data/no-live-action divergence is intentional. Scope L1 strictly to leaf-visual sharing.

### 5C — L3 (optional)

If more transient-confirmation flags appear beyond clipboard, add `lib/hooks/use-transient-flag.ts` and have `useCopyToClipboard` build on it. Low priority; only if a second real use case shows up — don't speculatively add it.

---

## Sequencing & dependency summary

| Phase | Items | Risk | Depends on | Ship as |
|-------|-------|------|------------|---------|
| 1 | H3, H4, M1, M2 | Low | — | 4–6 small PRs |
| 2 | H1 | Medium | Phase 1 (optional reuse) | 1 PR |
| 3A | H2 | Med-High | 1B | 2 PRs |
| 3B | M3 | Medium | **1D (must precede)** | 1 PR |
| 4 | M4, M5, M6 | Low (M4/M6), Med (M5) | — | 2 PRs (split safe vs visual) |
| 5 | M7, L1, L3 | Low each | 1B, 1C for L1 | 1 PR per file |

**Hard ordering constraints:**
- **1D before 3B** — CalendarView split should import the shared color helper, not carry the old local math into new files.
- **1B before 3A and 5B** — so the CliPage split and demo components consume `AgentIcon` rather than re-introducing the inline `<Image>`.
- **M5 needs a canonical-status-mapping confirmation** before merge (only behavior-changing item).

**Total surface:** ~4 new shared files (`use-copy-to-clipboard.ts`, `AgentIcon.tsx`, `ProjectColorDot.tsx`, `SettingsDialogShell.tsx`), 1 extended file (`color.ts`), 2 new folders (`cli/`, `calendar/`), and additions to `ticket-view-helpers.ts` — against ~40 migrated call sites. No database, API, CLI, or MCP surface is touched; this is entirely `apps/web` presentation-layer refactoring.

## Definition of done (whole effort)

- [ ] Grep is clean for each eliminated pattern (inline clipboard timer, inline `invertDark` `<Image>`, inline project-color dot at migrated sites).
- [ ] New pure functions (`use-copy-to-clipboard`, `color.ts` math, `cli-page-helpers`, ticket helpers) have unit tests in `tests/`.
- [ ] `yarn lint` + `yarn build` (or the project's type-check) pass after each PR.
- [ ] Manual verification per phase as noted (three settings modals, calendar DnD, CLI settings + onboarding, Kanban appearance for M5).
- [ ] No parallel copies left behind — every extraction migrates its call sites in the same or an immediately-following PR.
