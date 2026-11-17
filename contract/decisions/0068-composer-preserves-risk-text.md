# ADR 0068: The delivery composer preserves risk text

- Date: 2026-11-17
- Status: accepted
- Supersedes: none
- Amends: none

## Context

A risk's mission-item identity is `risk-<digest>` of its normalised text
(`missionItemRef`, `contract/data/README.md`). The asynchronous delivery composer
could return reworded `knownRisks`, and reconciliation took the model's list. A
reworded risk then got a new `item_ref`: the open row was deleted and a new open
row inserted with a new id, and a risk someone had already closed came back as a
new open item. With auto-advance, the next objective attaches while composition is
still pending, so the item id it received at attach could disappear before it
delivered `closeItems` (plan `planning/feature-plans/mission-summary-flow-review-2026-11-17.md`,
finding 1 and second-review item B).

## Decision

`presentation.knownRisks` is always the agent's `agentReport.knownRisks`, in both
the composed and the fallback presentation, as `deferredWork` already is. The
compose-delivery response schema no longer has `knownRisks`, and the writing rules
no longer apply to it; risks stay in the prompt as read-only evidence for the
markdown.

A provenance reference on risks (a stable id independent of text) was considered.
It needs a new field and a data migration for existing rows, while passing the text
through removes the cause with no schema change and fewer output tokens.

## Impact

Core reconciliation and the compose-delivery automation change together. Risk text
is shown as the agent wrote it, without the model's style edits. No schema
migration; existing composed deliveries keep their stored rows until they are
recomposed, at which point a previously reworded risk returns to the agent's text
(a one-time identity change for that row, only if it is still open).
