# Deferred work as objective-quality statements (coo:986)

## Question

Users can turn a delivery's deferred-work item into a new mission whose first
objective is the item text verbatim (Feed rail, coo:971). Items are often too
sparse to be good objectives. Is the raw delivery text agents return enough to
generate richer deferred-work statements, or do agents need to send more?

## Evidence

Corpus: 167 deliveries read through `ovld protocol list-deliveries` across 94
review/complete missions (2026-09-09).

| Measure                                                                                                           | Value                         |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Deliveries carrying `agentReport.deferredWork`                                                                    | 33 (77 items)                 |
| Deferred item length (chars)                                                                                      | min 20, median 92, max 534    |
| Summary length for those deliveries (chars)                                                                       | min 179, median 654, max 3395 |
| Deliveries with no deferred list whose summary still says work "remains", is "out of scope", or is "pre-existing" | 50 of 134                     |

Typical sparse items and what the same delivery's summary already says:

- "Remaining ~60 unassigned counterparty moves." Summary: Cooperativ Labs, Inc.
  journal moves, matched by memo text to four named vendors, 59 assigned, 60
  left for manual matching.
- "Repository-wide Prettier and Ruff format application." Summary: configs and
  check scripts now enforce the style policy; the formatting pass was skipped.
- "P2 composite read tools banking_work_queue and month_close_prep." Summary
  and objective instruction name the plan phases.
- "Upgrade the remaining outdated dependencies, including React Router." Known
  risks: react-router-dom 6.30.4 carries two advisories, fix needs v7.

The compose step was making this worse, not better. The Gemini system
instruction said nothing about deferred work, so the model echoed the agent list
verbatim in most cases and, when it did rewrite, shortened it (per:114, per:90,
per:81, per:95). The compose input already carries the summary (6,000 chars),
the objective title and instruction (2,000 chars), known risks, change
rationales, and recent events, which is the context the sparse items lack.

**Conclusion: the raw delivery text is enough.** No new agent-side fields are
needed for the common case.

## Change

### Compose automation (`automations/src/compose-delivery/compose.ts`)

- System instruction gains DEFERRED WORK rules: each item becomes the full text
  of a future objective handed to an agent that has not read this delivery, so
  it must stand alone (imperative verb, component/file/data named, what was
  delivered and why this piece was left, what done looks like when the evidence
  says so). Delivery-local references ("finding 3", "P2", "the next objective",
  "~60 remaining") are resolved from the summary, instruction, rationales, and
  events. Never shorten, merge, drop, or reorder. Add an item beyond the agent's
  list only when the summary explicitly says work was left undone. Facts only.
- Response schema: `deferredWork` carries a description and is now `required`,
  because the model intermittently omitted the array when it was optional.
- Prompt labels the deferred section with the agent count and the rewrite
  instruction. `maxOutputTokens` 2048 to 4096 so a 12-item list of enriched
  statements plus markdown does not truncate the JSON.

### Core reconciliation (`packages/core/service/delivery-compose.ts`)

New `reconcileDeferredWork({ agentItems, draftItems })`, used by
`reconcileDeliveryComposeDraft`:

- A draft item replaces its agent source only when it is at least as long, so a
  model that shortens can never degrade an item.
- A draft with fewer items than the agent listed is ignored; the agent list is
  kept whole.
- Extra draft items beyond the agent count are kept, bounded to the existing
  12-item limit (these are the explicit-in-summary extractions).
- With no agent items, the draft list is used as-is.

`agentReport.deferredWork` is never rewritten; only `presentation.deferredWork`
changes, exactly as before.

### Contract

`contract/components.yaml` automations capability line and the Version 139
summary in `CONTRACT.md` describe the enrichment and the guard. No schema, route,
or DTO change.

## Live verification (real deliveries, gemini-3.1-flash-lite)

- per:93 "Remaining ~60 unassigned counterparty moves." became "Classify the
  remaining 60 unassigned journal moves for Cooperativ Labs, Inc. that could not
  be automatically matched by memo text. This task involves manually reviewing
  the transaction descriptions to assign the correct counterparty, as the
  previous automated pass only addressed 59 ..."
- per:120 ten "finding N" items all came back enriched in order; output fit the
  budget.
- per:82 the added React Router detail traced to the agent's known-risks entry.
- per:95 one run returned no `deferredWork` at all (schema had it optional); the
  guard kept the agent list. Marking the field required addresses the cause.
- Summaries with no agent list and only vague leftover wording (per:50) produced
  no invented items.

## Known risks and follow-ups

- Rail item ids are a hash of the presentation text. They already changed when
  Gemini rewrote an item; with enrichment they change on nearly every composed
  delivery. A resolution made in the seconds between delivery and composition
  would detach. Existing behavior, now more frequent; an index-based or
  agent-text-based id would remove it.
- The length guard is a floor, not a quality check. A verbose but wrong rewrite
  passes. Grounding rules in the prompt are the mitigation.
- Optional next step for agents (not required by the evidence): document in the
  connector skill and protocol help that each `deferredWork` item should name
  the component and the reason it was left, mirroring the human-action example.
  That touches connectors and needs a connector version bump, so it is left for a
  separate objective.
