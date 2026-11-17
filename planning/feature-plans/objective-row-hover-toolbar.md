# Objective row hover toolbar (coo:1289.vfrb)

Status: implemented 2026-11-17 (coo:1289.94nr). Contract impact: **none**.

Implementation notes:

- `ObjectiveRowHoverLine.tsx` holds the line and `useObjectiveRowHoverLine` (open state, 150 ms close delay, `hover: none` and drag suppression). The line reports one "held" flag to the row: resource or agent popup open, Run options or confirmation open, launch pending, or launch error.
- Keyboard focus is detected with `:focus-visible`, so a mouse click that leaves focus on a control does not keep the line open after the pointer leaves.
- The line mounts closed and opens one frame later, so its first reveal animates too.
- `AgentLaunchButton` gained `onPopupOpenChange`, `onPendingChange` and `onErrorChange`. With `onErrorChange`, the button renders no error of its own; the row shows it in `rowError`.
- `AgentModelChooserButton` gained `fullLabel` and `collapsibleClassName`; `ObjectiveResourcePicker` gained `labelClassName`. The line uses `@max-[480px]/objective-list` on the `@container/objective-list` list root.
- Line controls are 32px high (the `sm` size of the existing toolbar controls), not 28px.
- Open question §9.1 is not implemented: the selected row also opens its line on hover.

The page https://claude.ai/artifact/LzV9BVDJsVuzPNqZh2rK8a shows the approved look, with hoverable sample rows.

## 1. Goal

When the pointer is over a not-started objective row in the mission panel, a second line opens under the row. The line is a compact copy of the toolbar at the bottom of the new-objective composer (`GhostObjective` / `ComposerSavedObjective`). It lets a person set up and run a draft objective without opening its detail:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ○  Refactor the sync worker retries                                ⋮     │  first row on hover
│    📁 webapp ▾   ⬡ Claude · Opus 5.5 ▾          ≡  rjay   ▶ Run │▾ │  hover line
└──────────────────────────────────────────────────────────────────────────┘
```

While the line is open, the first row keeps only the state icon, the title and the menu button. Every other first-row control moves down. The line holds, left to right: resource selector, agent selector, a spacer, then the Run Queue button and the identifier copy button, then the split Run button at the right edge. Resource, agent and Run follow the composer's order (resource → agent → primary action).

There is no tag selector. Tags stay on missions only (decided 2026-11-17); objectives do not get tags.

This reverses one rule of `mission-panel-redesign.md` §7.2 ("There is no Run button … on the row"). The row itself still has no Run button. Run appears only on the hover line, and in the kebab menu since coo:1289.eq97.

## 2. When the line is shown

| Row state | Line |
| --- | --- |
| `draft`, `submitted` | yes |
| `launching`, `executing`, `pending_delivery`, `complete`, others | never. Those rows keep their static agent icon. |

The line opens when any of these is true:

- the pointer is over the row (`group-hover/row`);
- a control in the row or the line has keyboard focus (`group-focus-within/row`);
- a popup that the line opened is still open (resource, agent, Run options, or the parallel-launch confirmation). Without this rule the line would close when the pointer moves into a portal menu.
- a launch from the line is pending, or the line shows a launch error.

It closes 150 ms after none of these is true, so a pointer that passes over a row on its way down the list does not make the list jump. It never opens while a row is being dragged (`drag.isDragging` on any row, through the existing DnD context), and it closes when a drag starts.

**Touch devices** (`@media (hover: none)`): no line. The kebab menu (Run and Resource, from eq97) is the way to do these actions. This is the same rule as the hover-only queue button and the mobile objective coo:1289.tccw.

## 3. Layout and motion

- The line is a sibling inside the row `<li>`, after the row button and its controls, with `basis-full` (the `<li>` already wraps: `flex-wrap`). It is not inside the row button, so nothing interactive nests.
- Reveal uses the grid-rows pattern of `MissionCardHoverFooter`: `grid grid-rows-[0fr] opacity-0` → `grid-rows-[1fr] opacity-100`, 150 ms ease-out, `pointer-events-none` while closed. The rows below move down smoothly instead of jumping. `prefers-reduced-motion`: no transition, show and hide at once.
- Inner line: `flex items-center gap-1 pl-9 pr-2 pb-1.5` (`pl-9` lines the first control up under the title, after the state icon, as the menu error line does today). Height 28px (`h-7` controls).
- Controls use the composer's toolbar components at the `sm` / ghost size. The resource label truncates (`max-w-[9rem]`). The agent selector shows its full label ("Claude · Opus 5.5") with no truncation, since the first row no longer competes for the width. The split Run button has 8px extra space on its left (`ml-2`) to separate it from the identifier. At narrow panel widths the labels drop first:
  - at 375–479px (the panel minimum) the resource shows its icon and a short label; the agent selector shows its icon only (`iconOnly`);
  - Run keeps its label at every width.
  Use a container query on the objectives list (`@container`) rather than viewport breakpoints, since the panel width is independent of the window.
- The row background (`hover:bg-muted/40`) covers both lines, so the line reads as part of the row. No border between them.
- While the line is open, the queue button, identifier button and agent icon are removed from the first row (`display: none`), so the title takes the freed width and only the kebab stays at the right. The line renders the same `ObjectiveQueuePopover` trigger (always visible there, grey when not queued) and the identifier copy button to the left of Run. Each control appears once on screen. When the line closes they return to the first row.
- Removing first-row controls changes the title width on hover. That is intended. The row height does not change, so nothing below jumps until the line itself opens.

## 4. Controls

All line controls stop `pointerdown` and `click` propagation (they must not open the detail or start a drag), as the row tail controls already do.

### 4.1 Resource selector

The existing `ObjectiveResourcePicker` with `objectiveResourceOptions`, writing `PATCH { resourceKey }` (null for the primary, as today). Hidden when the project has one logical resource, as in the composer and the menu.

### 4.2 Agent selector

The existing `AgentModelChooserButton` (labelled form, `iconOnly` at narrow widths) bound to `useObjectiveAgentSelection(objective)`. The row tail already creates this selection in `NotStartedRowTail`; lift it one level so the tail icon, the menu Run, and the hover line all share **one** selection object. Otherwise Run in the line could launch with a different model than the chooser shows.

### 4.3 Split Run button

The existing `AgentLaunchButton` with `size="sm"`, the same props `ComposerSavedObjective` passes: `selection`, `selectionLoaded`, and the `resolveLaunchSiblingGuard` result (`hasActiveSibling`, `activeSiblingId`, `activeRequest`). This gives the line, with no new launch code:

- green label and filled play icon when Run can start (coo:1289.yhwc styling);
- the split chevron with "Run on target" and the other options of the split button;
- the parallel-launch confirmation popover when another objective is working the mission (unlike the menu item, the button can show it, so it does not silently queue);
- the disabled reasons (no instruction, Manual agent, resource not connected).

There is no Save state on the row: the row shows only saved objectives. Launch errors appear in the existing one-line error slot under the row (the `menuError` slot, renamed `rowError`), which also keeps the line open.

After Run succeeds the objective moves to `launching`, so the line closes and the row shows its normal launching state.

### 4.4 Queue and identifier

The same `ObjectiveQueuePopover` trigger and identifier copy button as the first row, moved into the line between the spacer and Run (section 3). In the line the queue trigger is always visible: grey when not queued, emerald or amber when queued. Each control is rendered in one place at a time, so there is only one popover anchor and one copy button.

## 5. Tags

Tags are a mission concept and stay that way: `project_tags` defines them and a mission stores `tagIds`. The row line has no tag selector, the composer does not get one, and objectives get no tag field. The mission's tags stay in the mission header and on the board card.

## 6. Components and files

| File | Change |
| --- | --- |
| `components/objectives/ObjectiveRowHoverLine.tsx` (new) | The line: reveal wrapper, resource, agent, queue, identifier and Run, popup-open tracking, close delay. |
| `components/objectives/ObjectiveRow.tsx` | Hide the queue, identifier and agent controls on the first row while the line is open. Lift `useObjectiveAgentSelection` out of `NotStartedRowTail` into a `NotStartedRow` wrapper that feeds the tail, the menu Run and the line. Render the line for not-started rows. |
| `components/objectives/MissionObjectivesSection.tsx` | Pass `mission` (already done) and whether any row is dragging. |

Data cost: rows already load the project resources and agent catalog (React Query, shared keys). The line's controls mount only on first open of that row (keep them mounted after), so a long list does not mount N launch buttons up front.

## 7. Accessibility

- The line is a `role="group"` with `aria-label="Objective actions"`. Its controls are in the tab order after the row's kebab, so keyboard users reach them by Tab; focus-within keeps the line open.
- When closed the line is `inert` (not just transparent), so hidden controls are not focusable or read.
- Labels: "Resource: webapp", "Agent: Claude · Opus 5.5", and the Run button's existing labels.

## 8. Tests

- Line appears on hover and focus for `draft`/`submitted`, never for other states.
- Line stays open while a picker or the Run popover is open; closes after leaving.
- No line under `(hover: none)`; no line while dragging.
- Run sends the launch with the selection the agent selector shows (shared selection).
- Run with an active sibling shows the confirmation, not a silent enqueue.
- Resource change sends the right PATCH.
- Line controls do not open the detail or start a drag.
- While the line is open, the first row shows only the state icon, title and kebab; the queue and identifier render once, in the line. They return to the first row when it closes.
- The agent label is not truncated at wide panel widths; it is icon-only below 480px panel width.

## 9. Open questions

1. Should the line also open for the **selected** row (detail open)? Proposed: no, the detail already has these controls.
