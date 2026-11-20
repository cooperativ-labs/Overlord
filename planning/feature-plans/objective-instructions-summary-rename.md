# Objective instructions vs. summary: rename and swap guard (coo:1321)

Contract impact: major

## Problem

When an agent created coo:1320 with `ovld protocol create`, it passed a one-line summary as
`--objective` and the full instructions as `--objective-description-file`. The executing agent
then got one thin line, and the human-facing summary held the instructions. The `create` help
explained the difference far below the flags, and nothing stopped the swap.

## Decision

1. **Say what each field is in its name.** On every create surface the agent-facing text is
   *instructions* and the human-facing text is a *summary*:
   - protocol `create`/`prompt`: `--objective` → `--objective-instructions`
     (new `--objective-instructions-file`), `--objective-description[-file]` →
     `--objective-summary[-file]`;
   - `--objectives-json` / `add-objectives` / REST `POST /api/missions` items:
     `objective` → `instructions`, `description` → `summary`;
   - `update-objective`: `--description[-file]` → `--summary[-file]`,
     `--description-request` → `--summary-request`;
   - management CLI `ovld create`/`ovld prompt`: same flag names as the protocol;
   - MCP `overlord_create_mission`: `objective` → `objectiveInstructions`, `description` →
     `objectiveSummary`; `overlord_add_objectives` items as above;
     `overlord_update_objective`: `description` → `summary`, `descriptionRequest` →
     `summaryRequest`.
   `record-work`'s `--objective` is out of scope: it records finished work and has no summary.
2. **One name end to end.** The objective "description" (ADR 0057/0059) becomes "summary"
   everywhere: database columns (`objectives.description*` → `objectives.summary*`, one forward
   migration per dialect using `RENAME COLUMN`), `ObjectiveDto` fields, REST
   `POST /api/objectives/{id}/summary-requests`, `PATCH` body `summary` /
   `expectedSummaryRevision`, warning and error codes (`summary_style`, `summary_suppressed`,
   `summary_conflict`, `summary_not_editable`, …), the activity-feed `summaryPreview`, the
   worker and the web app. No compatibility aliases (owner: single user, all clients move).
3. **Swap warning** (`assessObjectiveSummaryPlacement` in
   `packages/core/service/objective-summary-placement.ts`), applied to every create and agent edit
   that carries both texts. Owner decision: warn only, never reject.
   - *likely* (`objective_fields_swapped` warning, "look swapped") when the summary is at least 3×
     the instruction length and at least 400 characters;
   - *possible* (same code, "may be swapped") when the summary is longer than 1.5× the
     instructions and at least 240 characters, or when the summary contains instruction structure
     (a Markdown heading, two or more numbered steps, or a `Done when:` label line) and the
     instructions are shorter than 400 characters.
   Messages name both fields and say which one the executing agent receives.
   Thresholds come from 1,815 production objectives (76 with summaries): legitimate summaries
   are 1–5 lines, at most 1,734 characters and at most 1.22× their instructions; none has a
   heading or numbered steps. The coo:1320 swap is 15.3× (111 vs 1,703 characters, 6 numbered
   steps, 3 headings).
   People editing over REST `PATCH` are not guarded (a person may summarize a terse
   instruction); REST create is guarded because agents use it through `ovld create`.
4. **Help next to the flags.** `create`/`prompt`/`add-objectives`/`update-objective` help and the
   MCP property descriptions open with "instructions = complete brief for the executing agent
   (usually the long one)" and "summary = 1–3 short paragraphs for people, never sent to the
   agent (usually the short one)".

## Contract

Major: renamed protocol flags, MCP parameters, REST fields/route, error and warning codes and
database columns. New ADR 0083 (supersedes the naming in ADR 0057/0059), `protocol-commands.yaml`,
`protocol.md`, `architecture.md`, `data/README.md`, `conformance.md`, `api/openapi.yaml`
(`info.version` bump, `yarn api:generate`), generated MCP catalog, conformance manifests restamped.

## Impact on other modules

- Web app: field and route renames (in this change).
- Mobile app (`OverlordMobile`): reads `description*` from `ObjectiveDto` and must move to
  `summary*` (owner will update).
- Desktop: no direct use.
- Connectors/skills: CLI and MCP reference text updated; MCP tool catalog regenerated.

## Tests

- Core: guard unit tests incl. the coo:1320 fixture (`packages/core/service/fixtures/coo-1320-create-submission.json`).
- Backend: protocol `create` with the fixture stores both texts and warns with both field names; a normal create
  is unaffected; a borderline swap returns the warning.
- CLI: file-input flags for the new names.
