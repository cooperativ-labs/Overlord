# Rotation — running the refactor review as a standing routine

One area per run. A whole-repo sweep produces a list nobody acts on; a rotation produces a small
plan every week and a trend line over time.

## Order

The rotation is weighted by size and change rate — the areas that move fastest come round most
often.

| Slot | Area | Roots | Approx. size |
|---:|---|---|---:|
| 1 | `backend` | `backend/` | ~36k lines |
| 2 | `webapp` | `webapp/` | ~43k lines |
| 3 | `core` | `packages/core/`, `packages/contract/` | ~24k lines |
| 4 | `cli` | `cli/` | ~20k lines |
| 5 | `agent-surfaces` | `mcp/`, `connectors/` | ~2k lines + skill content |
| 6 | `database` | `database/`, migrations | ~3k lines |
| 7 | `desktop` | `desktop/src/` | ~4k lines |
| 8 | `platform-services` | `auth/`, `automations/`, `scripts/` | ~6k lines |

Then start again at slot 1. Slots 1–4 hold most of the debt; 5–8 are quick passes that mostly
confirm the shape is still right.

## Picking the next area

```bash
ls -1 planning/refactor-reviews/ 2>/dev/null | sort
```

Take the rotation slot whose most recent report is oldest or missing. Override that default when:

- a large feature just landed in one area — review that area next, while the shape is fresh
- an area is mid-migration — skip it; reviewing a half-finished transition produces findings that
  the transition will resolve anyway
- the user names an area — always honor it

State which area you chose and why in the report.

## Invocation

```
/refactor-review backend
/refactor-review webapp
/refactor-review core
/refactor-review cli
/refactor-review agent-surfaces
/refactor-review database
/refactor-review desktop
/refactor-review platform-services
```

Narrower targets use the enclosing area's playbook:

```
/refactor-review backend/execution
/refactor-review webapp/web/lib/queries.ts
```

## As a scheduled routine

The monthly Claude web routine uses its connected Overlord MCP after it finishes the review. It
creates one mission containing a short **Publish refactor review** objective, appends one draft
objective per recommended finding/remediation, then delivers the publish objective with a concise
summary and the full Markdown report as a `note` artifact. File-change evidence is captured
independently by the attached connector. The same report stays in `planning/refactor-reviews/`.

Use this Routine prompt:

```text
Run the refactor-review skill for the next area in its rotation. Follow
.claude/skills/refactor-review/SKILL.md exactly. Save the complete Markdown report in
planning/refactor-reviews/. Then, using the connected Overlord MCP, resolve the Overlord project,
create a mission with a Publish refactor review objective, add one draft objective for every
recommended finding/remediation, and attach/deliver the publish objective with the full report as
a note artifact and a concise summary. Do not send a no-file assertion or explicit changed-file
list. Do not make any refactor changes and do not wait for user confirmation.
```

Keep review publication and refactoring separate. The published mission is the action queue; a
later Overlord execution handles each remediation objective.

## Trend tracking

Every report carries a Measurements table. Each run copies the previous run's numbers into the
`Previous run` column, so the rotation answers the question a single review cannot: is this area
getting better or worse?

Numbers worth carrying forward, per area:

- file count and total lines
- number of files over 800 lines
- largest file and its line count
- count of open findings carried over from the previous report

If a metric is worse and no feature work explains it, that is the lead of the summary.

## Keeping the routine honest

- A run that finds nothing worth doing is a **good** outcome. Write the short report and say the
  area is in good shape. Do not manufacture findings to fill the template.
- Do not re-report findings the previous run listed under *Explicitly not recommended* unless
  something changed. Say what changed.
- Findings that survive three runs untouched are either not actually valuable or genuinely blocked.
  Re-score them or move them to *Explicitly not recommended* with the reason.
