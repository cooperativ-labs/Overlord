# Objective descriptions in the unified queue

Mission: coo:1275 · Objective: coo:1275.9n5a · Date: 2026-11-14

Contract impact: none. This is a design specification, not a runtime implementation.
Feature rules and proposed additive contract changes: [implementation plan](objective-descriptions-ste.md).

## Layout

Retain the current mission panel header, tabs, spacing, borders, typography, evidence rows and footer controls. Use existing `DraftObjective`, `ObjectiveEvidenceRule` and `ObjectiveEvidenceSection` primitives. The wireframes specify content and behavior, not new visual tokens.

The panel contains executed rows, launching cards, one ordered draft/submitted queue and one end composer. There is no separate Future group or Promote action. The first queued row is full even when submitted or blank; layout never selects execution policy.

```text
Mission title                                      Existing mission actions
Existing mission information / tabs

▸ Completed objective                   Existing status and evidence counts
▾ Open completed objective              [1 decision]
  ─ SUMMARY ───────────────────────────────────────────────────────────────
  Full prose description. Goal first; observable done-when result last.
  ▸ INSTRUCTIONS · 1,240 characters
  ─ Existing delivery / files / activity evidence ────────────────────────

┌ Launching objective ───────────────────────────────────────────────────┐
│ Full card, summary or instruction fallback, existing launching status │
└───────────────────────────────────────────────────────────────────────┘

⋮⋮ ┌ Full queue-head card · Draft ──────────────────────────────────────┐
   │ Add a summary to each objective                                  │
   │ Help people read long objective instructions. Show a short        │
   │ summary and keep the full instructions available. The work is     │
   │ done when people can read both texts from the objective card.      │
   │ AI summary · Edit · Regenerate                                    │
   │ ▸ Instructions · Edit                                            │
   ├───────────────────────────────────────────────────────────────────┤
   │ Existing attachments / Run Queue / resource / agent / model / Run │
   └───────────────────────────────────────────────────────────────────┘

⋮⋮ ┌ Compact card · Submitted ─────────────────────────── [1 decision] ┐
   │ Choose where summaries appear                                    │
   │ Show summaries on the objective cards. Decision needed: include   │
   │ the inbox now or in a later release. …                 [Expand ▾] │
   ├───────────────────────────────────────────────────────────────────┤
   │ Existing compact controls                                  [Run] │
   └───────────────────────────────────────────────────────────────────┘

⋮⋮ ┌ Compact card · Draft ─────────────────────────────────────────────┐
   │ Person-written instruction preview, as today           [Expand ▾] │
   ├───────────────────────────────────────────────────────────────────┤
   │ Existing compact controls                                  [Run] │
   └───────────────────────────────────────────────────────────────────┘

Existing “Add objective” / single end composer
```

The sample prose is illustrative content, not a new product decision. Executed rows keep their existing collapsed layout; compact queued cards are a different surface and have a summary preview. Keep the entire summary within the plan's one-to-three-paragraph limit, with no generated headings or bullets.

## Full and compact reading behavior

| Surface | Closed/default body | Open body |
| --- | --- | --- |
| Full queue head with summary | Title, complete summary, provenance/status, closed instruction disclosure | Instruction disclosure exposes the original text and its existing edit affordance |
| Compact queue row with summary | Title and at most two lines of summary; decision/caution indicators remain visible | Full prose, provenance/status, Edit/Regenerate, instruction disclosure |
| Queue row without summary | Current instruction body/preview; head is full, remainder compact | Original instruction editor; Summarize for eligible long text |
| Launching card | Full, non-draggable card; existing launch restrictions | Readable summary and original instructions; no new instruction-edit permission |
| Executed row | Existing title/status/evidence counts; optional decision badge | SUMMARY then INSTRUCTIONS then existing evidence; omit empty SUMMARY |

Expand and the decision/caution indicators are keyboard-accessible buttons with an explicit accessible name and expanded state. The indicators open the complete summary; they never imply that the full instructions have been checked. On touch screens, direct launch and the drag handle remain distinct targets. Keep existing toolbar focus behavior: opening agent/model menus does not expand or collapse the body.

People can edit descriptions after launch, including on completed objectives. This changes presentation only; instruction-edit restrictions and execution evidence remain unchanged. Assistant-written instructions qualify for automatic summaries even without an attached session. The prose aims for 120 words, with extra words allowed to preserve essential meaning. Remove summary shows the original instructions and keeps the summary absent until a user clicks Summarize. Instruction edits, reloads and late generation results must not restore it. Regenerate replaces an existing summary and is a separate action.

## Summary states

```text
No summary, long instructions      Pending
┌────────────────────────────┐     ┌────────────────────────────┐
│ Original instruction text  │     │ Original instruction text  │
│ Summarize                  │     │ Writing summary…           │
└────────────────────────────┘     └────────────────────────────┘

Failed generation                  User-edited, instruction changed
┌────────────────────────────┐     ┌────────────────────────────┐
│ Original instruction text  │     │ User's saved summary       │
│ Summary unavailable · Retry│     │ Edited by you · Edit       │
└────────────────────────────┘     │ May be out of date         │
                                   │ Regenerate                 │
                                   │ ▸ Instructions · Edit      │
                                   └────────────────────────────┘
```

A pending or failed regeneration retains the prior summary with its stale/status indication and access to current instructions. On first generation, retain the instruction fallback until a result exists. Short instructions and blank drafts do not show a pending summary. Never replace an active instruction editor with a newly arrived summary.

A blank saved draft can be the full head. Keep its existing placeholder, attachments, configuration and Previous runs evidence. An old summary cannot substitute for an empty instruction or enable launch. The client-only end composer has no summary until it saves a real objective.

## Drag and edit transitions

```text
Before                              After moving B above A
A · full · unsaved instruction      B · full · same summary and disclosure state
B · compact · summary expanded      A · compact · same unsaved instruction
C · compact · upload pending        C · compact · same pending upload
```

Use one component identity per objective ID. Full/compact is a layout prop, not a new component key or a lifecycle state. An in-progress editor remains visible when its row becomes compact; the two-line limit applies to read previews, not to an active editor. Store summary and instruction edit buffers separately. Preserve focus and staged files through head changes and rollback/refetch after a stale reorder.

Generation targets an objective ID and instruction/ownership generation token, never a queue index. Moving a row does not regenerate its summary or invalidate a still-current result. Realtime summary updates must not replace local unsaved buffers or reorder the list.

Reopen places the same objective at the head with its prior summary and Previous runs strip. Launching any eligible non-head row leaves the head's state unchanged. The summary is never the launch payload or a requirement to enable Run.

## Implementation anchors and verification

- Web/desktop: `webapp/web/components/objectives/MissionObjectivesSection.tsx` retains its ID-keyed sortable list; `DraftObjective.tsx` owns full/compact reading and editing; existing evidence components retain executed-row structure.
- iOS: the ID-keyed queue in `Overlord/Views/MissionDetail/MissionDetailContentView.swift` receives equivalent reading and editing behavior from the mobile resource.
- Check mixed submitted/blank queues, head drag, non-head launch, reopen, stale reorder recovery, pending summary arrival and both editor buffers with staged uploads. Test keyboard/touch disclosure separately from drag. The plan's §11 is the acceptance checklist.

This local specification supersedes the queue layout in the earlier hosted canvas. That canvas could not be retrieved and was not edited. No browser/device interaction or runtime implementation is claimed by this artifact.
