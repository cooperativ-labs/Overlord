# ADR 0069: Compact execution context on attach

Date: 2026-11-17
Status: Accepted (owner approved in mission coo:1294.hhh9)
Contract impact: major

## Decision

Attach and resume-follow-up use attach-response-v4. Remove general `history` and
`previousObjectives`/`futureObjectives`. Return sibling `objectives` containing only
`displayId`, real lifecycle `state` and instruction `objective` in mission order,
excluding the current objective and blank slots. Cap completed instructions at 600
characters, including `… [truncated]`. Keep other instructions in full.

Return `directives`: current-objective events of types `user_follow_up`, `decision`
and `discussion_summary`, newest 10, ordered by created_at then id descending.
Filter before limiting, so operational events cannot hide a follow-up request.
Keep agentInstructions first, with current context locations, and preserve the
mission-summary editing baseline and all authorization/session rules.

## Compatibility and migration

This is a breaking response change, approved by the owner after the explicit
protocol question for step 6. There is no database migration or stored-data change.
Ordinary ObjectiveSummary consumers and load-context retain full metadata and
explicit history inspection. A truncated sibling's full instructions can be read
with `ovld protocol load-context --objective-id <displayId>` or the MCP context read.

CLI and local/hosted MCP pass the core result through without reconstructing sibling
fields. They and connector reference material and fixtures are updated together.
Consumers reading execution context must replace either sibling array with
`objectives`, check `state` rather than infer state from position, and read
`directives` rather than `history`. Clients requiring historical evidence must use
the existing inspection read. Deploy the server and matching consumers as one major
contract rollout; old servers still emit v3, so clients spanning versions must
detect the shape. The launch prompt remains a pointer to attach. All conformance
manifests are restamped and the OpenAPI description/types regenerated together.

## Tradeoff and validation

A bounded projection removes duplicated metadata and irrelevant lifecycle events
without adding an outcome summarizer. Completed instructions describe intent;
missionSummary remains the mission outcome baseline. Older directives and full
completed instructions require an explicit read. User instruction text, future
work, custom agent rules and attachments remain unbounded; the size budget is a
fixed-fixture regression guard, not a universal limit.

Tests cover CLI and MCP wording, fresh-session follow-up and reattach, more than
100 irrelevant events, objective/type filtering before the limit, out-of-order
completion, blank slots, full inspection reads, and a five-objective response
budget of 12000 characters with a 6500-character instruction budget.
