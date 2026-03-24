# Future Transcript Ingestion Design

## Goal

If transcript ingestion is reintroduced later, it should exist to improve operator visibility, not to manufacture delivery-grade rationale text. The system should prefer precise edit evidence, low overhead, and clear boundaries between hard validation and advisory context.

## Recommended Scope

- Keep the existing git-based `changeRationales` delivery validation as the only hard guardrail.
- Treat transcript ingestion as optional observability that can be enabled per session or per environment.
- Record only explicit edit evidence.
- Do not infer or auto-promote intent from nearby commentary.
- Do not create draft change rationales automatically from transcript heuristics.

## What To Capture

- Native edit events from the runtime when the agent platform exposes them directly.
- Explicit patch application events with concrete file paths.
- Optional command previews for edit commands when the command is known to mutate tracked files.

## What To Avoid

- Treating file reads as high-signal work.
- Promoting every transcript event into ticket activity.
- Generating `why` and `impact` text from nearby assistant commentary.
- Running transcript parsing automatically before every `update` and `deliver`.
- Coupling core file-change UX to advisory transcript-derived records.

## Runtime Design

- Put ingestion behind an explicit flag such as `--ingest-transcript`.
- Ingest asynchronously after the main protocol action succeeds, so delivery/update latency does not depend on transcript processing.
- Batch local parsing and server submission.
- Cap payload sizes aggressively and discard low-value events early.
- Persist an offset cursor only when ingestion succeeds.

## Data Model

- Prefer one append-only evidence table for transcript-derived edit records.
- Store:
  - `session_id`
  - `ticket_id`
  - `event_time`
  - `event_kind`
  - `file_path`
  - `command_preview`
  - `source_agent`
  - `raw_payload`
- Avoid a second draft table unless there is a clear review workflow that depends on it.

## UX Guidance

- Keep transcript evidence in a dedicated debug or audit surface.
- Do not mix transcript-derived records into primary rationale views by default.
- Label all transcript evidence as advisory.
- Make it easy to hide or disable in normal execution flows.

## Reintroduction Criteria

Reintroduce transcript ingestion only if all of the following are true:

- There is a concrete product need for transcript-backed auditability.
- The runtime can provide reliable edit evidence with low false-positive rates.
- The feature is optional and does not sit on the critical path for `update` or `deliver`.
- The primary delivery guard remains git-backed rationale coverage, not transcript heuristics.
