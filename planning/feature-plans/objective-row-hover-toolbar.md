# Objective row hover toolbar (coo:1289.vfrb)

Status: proposal. Contract impact: **minor** if objective tags are adopted (section 5), otherwise **none**.

## 1. Goal

When the pointer is over a not-started objective row in the mission panel, a second line opens under the row. The line is a compact copy of the toolbar at the bottom of the new-objective composer (`GhostObjective` / `ComposerSavedObjective`). It lets a person set up and run a draft objective without opening its detail:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ○  Refactor the sync worker retries                 ≡  rjay  ⬡  ⋮        │  row (unchanged)
│    🏷 Backend ▾   📁 webapp ▾   ⬡ Claude · Opus 5.5 ▾          ▶ Run │▾ │  hover line
└──────────────────────────────────────────────────────────────────────────┘
```

Order, left to right: tag selector, resource selector, agent selector, then the split Run button pushed to the right edge. This matches the composer's order (resource → agent → primary action), with tags added at the left.

This reverses one rule of `mission-panel-redesign.md` §7.2 ("There is no Run button … on the row"). The row itself still has no Run button. Run appears only on the hover line, and in the kebab menu since coo:1289.eq97.

## 2. When the line is shown

| Row state | Line |
| --- | --- |
| `draft`, `submitted` | yes |
| `launching`, `executing`, `pending_delivery`, `complete`, others | never. Those rows keep their static agent icon. |

The line opens when any of these is true:

- the pointer is over the row (`group-hover/row`);
- a control in the row or the line has keyboard focus (`group-focus-within/row`);
- a popup that the line opened is still open (tag, resource, agent, Run options, or the parallel-launch confirmation). Without this rule the line would close when the pointer moves into a portal menu.
- a launch from the line is pending, or the line shows a launch error.

It closes 150 ms after none of these is true, so a pointer that passes over a row on its way down the list does not make the list jump. It never opens while a row is being dragged (`drag.isDragging` on any row, through the existing DnD context), and it closes when a drag starts.

**Touch devices** (`@media (hover: none)`): no line. The kebab menu (Run, Resource from eq97, plus Tags from section 5) is the way to do these actions. This is the same rule as the hover-only queue button and the mobile objective coo:1289.tccw.

## 3. Layout and motion

- The line is a sibling inside the row `<li>`, after the row button and its controls, with `basis-full` (the `<li>` already wraps: `flex-wrap`). It is not inside the row button, so nothing interactive nests.
- Reveal uses the grid-rows pattern of `MissionCardHoverFooter`: `grid grid-rows-[0fr] opacity-0` → `grid-rows-[1fr] opacity-100`, 150 ms ease-out, `pointer-events-none` while closed. The rows below move down smoothly instead of jumping. `prefers-reduced-motion`: no transition, show and hide at once.
- Inner line: `flex items-center gap-1 pl-9 pr-2 pb-1.5` (`pl-9` lines the first control up under the title, after the state icon, as the menu error line does today). Height 28px (`h-7` controls).
- Controls use the composer's toolbar components at the `sm` / ghost size. Each picker label truncates (`max-w-[9rem]`); at narrow panel widths the labels drop first:
  - at 375–479px (the panel minimum) tag and resource show icon plus a dot or short label; the agent selector shows its icon only (`iconOnly`);
  - Run keeps its label at every width.
  Use a container query on the objectives list (`@container`) rather than viewport breakpoints, since the panel width is independent of the window.
- The row background (`hover:bg-muted/40`) covers both lines, so the line reads as part of the row. No border between them.
- While the line is open, the agent icon in the row tail is hidden (`group-hover/row:invisible`, space kept) because the line shows the full agent selector; this avoids two agent controls on screen. The identifier and kebab stay.

## 4. Controls

All four controls stop `pointerdown` and `click` propagation (they must not open the detail or start a drag), as the row tail controls already do.

### 4.1 Tag selector

`ObjectiveTagSelect`: a ghost button with `Tag` icon and the assigned tag labels (first tag plus "+n"), or just the icon in muted ink when none are assigned. The menu is the `MissionCardHoverFooter` `TagsSelector` pattern: checkbox items with colour dots, active project tags plus any inactive tags still assigned, "No tags in project" when empty, and a footer link "Manage tags…" to the project settings Tags page. Each toggle sends one PATCH and keeps the menu open. Hidden when the project has no tags and none are assigned. See section 5 for what it edits.

### 4.2 Resource selector

The existing `ObjectiveResourcePicker` with `objectiveResourceOptions`, writing `PATCH { resourceKey }` (null for the primary, as today). Hidden when the project has one logical resource, as in the composer and the menu.

### 4.3 Agent selector

The existing `AgentModelChooserButton` (labelled form, `iconOnly` at narrow widths) bound to `useObjectiveAgentSelection(objective)`. The row tail already creates this selection in `NotStartedRowTail`; lift it one level so the tail icon, the menu Run, and the hover line all share **one** selection object. Otherwise Run in the line could launch with a different model than the chooser shows.

### 4.4 Split Run button

The existing `AgentLaunchButton` with `size="sm"`, the same props `ComposerSavedObjective` passes: `selection`, `selectionLoaded`, and the `resolveLaunchSiblingGuard` result (`hasActiveSibling`, `activeSiblingId`, `activeRequest`). This gives the line, with no new launch code:

- green label and filled play icon when Run can start (coo:1289.yhwc styling);
- the split chevron with "Run on target" and the other options of the split button;
- the parallel-launch confirmation popover when another objective is working the mission (unlike the menu item, the button can show it, so it does not silently queue);
- the disabled reasons (no instruction, Manual agent, resource not connected).

There is no Save state on the row: the row shows only saved objectives. Launch errors appear in the existing one-line error slot under the row (the `menuError` slot, renamed `rowError`), which also keeps the line open.

After Run succeeds the objective moves to `launching`, so the line closes and the row shows its normal launching state.

## 5. Tags: the one decision

Tags today belong to **missions** only: `project_tags` defines them per project and a mission stores `tagIds`. Objectives have no tags, and the composer toolbar the line is modelled on has no tag selector. Two ways to build 4.1:

**A. Objective tags (recommended).** Add `tagIds: string[]` to objectives, using the same project tag set.

- Contract (minor, additive): `ObjectiveDto.tagIds` (always present, default `[]`); `PATCH /objectives/:id` accepts `tagIds`; create accepts optional `tagIds`. Validation: every id is a tag of the objective's project, else 400 `invalid_tag`.
- Database: `objective_tags (objective_id, tag_id)` join table mirroring the mission one, cascade on delete of either side; RLS as for objectives.
- Backend: read and write through the objective repository; mission detail returns `tagIds` per objective.
- CLI / MCP: `update-objective --tags a,b` and the `overlord_update_objective` `tagIds` field, so the surfaces do not drift (drift-review).
- Webapp: the line, the kebab menu (a "Tags" checkbox submenu next to Resource), and tag chips in the objective detail header. The composer toolbar also gets the selector so the line really mirrors it.
- Mobile (coo:1289.tccw): menu-only Tags submenu.
- Other modules: none must change; older clients ignore the new field.

**B. Mission tags on the row.** The selector edits the parent mission's `tagIds`. No contract change, but every row of the mission would show and edit the same tags, which reads as per-objective and is not. Not recommended.

If tags are not wanted per objective, drop 4.1 and ship the line with three controls; the rest of this design does not change.

## 6. Components and files

| File | Change |
| --- | --- |
| `components/objectives/ObjectiveRowHoverLine.tsx` (new) | The line: reveal wrapper, the four controls, popup-open tracking, close delay. |
| `components/objectives/ObjectiveTagSelect.tsx` (new, option A) | Shared tag menu, extracted from `MissionCardHoverFooter`'s `TagsSelector` with a scope prop (mission or objective). |
| `components/objectives/ObjectiveRow.tsx` | Lift `useObjectiveAgentSelection` out of `NotStartedRowTail` into a `NotStartedRow` wrapper that feeds the tail, the menu Run and the line. Render the line for not-started rows. Hide the tail agent icon while open. |
| `components/objectives/MissionObjectivesSection.tsx` | Pass `mission` (already done) and whether any row is dragging. |
| `components/objectives/ObjectiveMenuButton.tsx` (option A) | Tags submenu. |
| `pages/MissionCardHoverFooter.tsx` (option A) | Use the extracted tag menu. |

Data cost: rows already load the project resources and agent catalog (React Query, shared keys). Project tags add one cached query per project. The line's controls mount only on first open of that row (keep them mounted after), so a long list does not mount N launch buttons up front.

## 7. Accessibility

- The line is a `role="group"` with `aria-label="Objective actions"`. Its controls are in the tab order after the row's kebab, so keyboard users reach them by Tab; focus-within keeps the line open.
- When closed the line is `inert` (not just transparent), so hidden controls are not focusable or read.
- Labels: "Tags: Backend, +1", "Resource: webapp", "Agent: Claude · Opus 5.5", and the Run button's existing labels.

## 8. Tests

- Line appears on hover and focus for `draft`/`submitted`, never for other states.
- Line stays open while a picker or the Run popover is open; closes after leaving.
- No line under `(hover: none)`; no line while dragging.
- Run sends the launch with the selection the agent selector shows (shared selection).
- Run with an active sibling shows the confirmation, not a silent enqueue.
- Resource change and (option A) tag toggle send the right PATCH.
- Line controls do not open the detail or start a drag.

## 9. Open questions

1. Objective tags (5A) or a three-control line without tags?
2. Should the line also open for the **selected** row (detail open)? Proposed: no, the detail already has these controls.
