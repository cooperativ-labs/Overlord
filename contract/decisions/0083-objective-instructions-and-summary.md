# ADR 0083: Objective instructions and summary

- Date: 2026-11-20
- Status: accepted
- Contract version: 179.0.0
- Supersedes: the naming in ADR 0057 and ADR 0059 (their rules are unchanged)

## Context

An objective has two texts: the instructions the executing agent receives, and a short
human-facing overview (ADR 0057, ADR 0059). The overview was called a "description", and the
instructions were passed as `--objective` / `objective`. When an agent created coo:1320 it passed a
one-line overview as `--objective` and the full brief as `--objective-description-file`: the
executing agent would have received one thin line. The help explained the difference far below
the flags, and nothing refused or flagged the swap.

Data from 1,815 production objectives (76 with an overview) showed that legitimate overviews are
1–5 lines, at most 1,734 characters and at most 1.22 times their instructions, and none contains a
Markdown heading or numbered steps. The coo:1320 overview was 15.3 times its 111-character
instructions and held headings and six numbered steps.

## Decision

1. **Name each text by its role.** The agent-facing text is the *instructions* and the
   human-facing text is the *summary* on every surface: protocol `--objective-instructions[-file]`
   and `--objective-summary[-file]`; JSON items (`--objectives-json`, `add-objectives`, REST
   `POST /api/missions`, MCP `overlord_add_objectives`) `instructions` and `summary`; MCP
   `overlord_create_mission` `objectiveInstructions` and `objectiveSummary`; `update-objective`
   `--summary[-file]` and `--summary-request`, MCP `summary` and `summaryRequest`. Existing
   `instructionText` / `--instruction-text` stay.
2. **One name end to end.** "Description" becomes "summary" in the database
   (`objectives.summary*`, a pure `RENAME COLUMN` migration in both dialects), `ObjectiveDto`,
   REST routes and bodies, error and warning codes, the activity feed, the worker and the web app.
   No compatibility aliases: the owner is the only user and moves every client. Retired protocol
   flags and JSON keys are refused with 400 `invalid_input` that names the replacement rather than
   being ignored.
3. **Swap warning, never a refusal** (`packages/core/service/objective-summary-placement.ts`,
   pure). On every create and every agent summary write, compared with the instructions the
   objective has after the write, both texts are stored as written and the protocol or MCP
   response carries an `objective_fields_swapped` warning when the summary is at least 3 times as
   long as the instructions and at least 400 characters (severity `likely`: "look swapped"), or
   more than 1.5 times as long and at least 240 characters, or contains Markdown headings, two or
   more numbered steps or a `Done when:` label while the instructions are shorter than 400
   characters (severity `possible`: "may be swapped"). Messages name both fields and say which
   one the executing agent receives. REST returns no warning (the management CLI checks locally
   and prints it); a person's REST `PATCH` is not checked.
4. **Say it next to the fields.** CLI help, MCP property descriptions, docs and the connector skill
   describe each field by reader, content and usual length where the field is listed.

`record-work` (`--objective`) and `ovld inbox create --objective` keep their single text: they
have no summary, so there is nothing to swap.

## Consequences

- An agent that swaps the texts gets a warning naming both fields at creation, not a thin
  objective discovered at launch. The write is never blocked, so an intentional long summary
  stays possible.
- Every client reading `description*` breaks until it moves to `summary*` (iOS app).
- The thresholds are a heuristic. A warning can be ignored: the guard does not stop a swapped
  objective from being launched.

## Alternatives considered

- **Refuse past a clear ratio (3x).** Considered first; the owner chose a warning only, so a
  write is never blocked by a heuristic.
- **Rename only the flags, keep the `description` column.** Two names for one field across
  layers. Rejected by the owner.
- **Detect swaps with a model.** Slower, nondeterministic and unavailable offline. Rejected: the
  length ratio and structure markers separate the observed data cleanly.
