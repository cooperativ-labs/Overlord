# Human actions: complete and actionable (coo:963.4cbq)

Follow-up to the Feed human-actions rail (`coo-963-human-actions-rail.md`, contract v136).
The rail only helps if agents report follow-up steps an operator can complete
without re-reading the delivery. This change tightens the reporting contract
in three places: the shape, the guidance, and the safety net.

## 1. Shape: `command`, `verify`, `link` (contract v137)

`HumanActionInputV1` gains three optional string fields:

| Field     | Meaning                                                    | Bound       |
| --------- | ---------------------------------------------------------- | ----------- |
| `command` | Exact command, setting name, or value to apply, verbatim.  | 600 chars   |
| `verify`  | How the operator confirms the action took effect.          | 800 chars   |
| `link`    | HTTP(S) URL or repository-relative path. No other schemes. | 400 chars   |

They flow unchanged through:

- `packages/core/service/delivery-report.ts` normalization (`buildDeliveryReport`,
  `readDeliveryReport`). An item whose `link` is another URI scheme (for example
  `javascript:`) is discarded with a bounded warning, like any other malformed
  advisory item. `isValidHumanActionLink` is exported so the reconciler applies
  the same rule to model output.
- `packages/core/service/delivery-compose.ts` reconciliation: the model may
  restate them, the evidence value wins when the model omits them, and a
  model-supplied `link` is accepted only when well-formed.
- `automations/src/compose-delivery/compose.ts` response schema and the system
  instruction (carry them through, never fabricate a command, URL, or path).
- `backend/human-actions.ts` projects them as nullable strings on
  `HumanActionItemDto`.
- `webapp/web/components/HumanActionDetails.tsx` renders them in both the Feed
  rail (`HumanActionsRail.tsx`) and the delivery card (`DeliverySummaryCard.tsx`):
  the command as a monospace block, the verify line labeled, and the link as an
  external anchor for HTTP(S) or a monospace path otherwise. The rail hides the
  details on resolved rows.

No database change: the fields live inside `deliveries.payload_json` like the
rest of `HumanActionV1`.

## 2. Guidance: `reason` and `category` are expected

The connector skill (`connectors/core/overlord-mission/SKILL.md`), protocol help
(`cli/src/protocol-help.ts`), the agent-protocol docs (`cli/docs/03-agent-protocol.md`,
`docs/.../agent-protocol.mdx`), and both MCP tool descriptions (`mcp/tool-catalog.ts`
and the connector shim `overlord-mcp.mjs`) now describe every field, mark `reason`
and `category` as expected, and show the same worked example:

- Vague: `{ "action": "Set up the env var for Gemini." }`
- Good: a full item naming the variable, the service, the `railway variables set`
  command, the observable verify step, and `.env.example` as the link.

Normalization still tolerates a missing `reason` or `category` (category defaults
to `other`) so older connectors never fail delivery.

## 3. Safety net: deterministic candidates always land

`deriveDeterministicActionCandidates` already inferred steps from changed paths
(migrations, `.env` examples, deployment configs, dependency manifests) but the
reconciler only kept the ones the model cited, and when the agent reported
nothing and the model echoed nothing, the presentation showed no actions at all.

Now:

- `mergeDeterministicActionCandidates` appends every candidate the presentation
  does not already carry (by id), after agent and composed actions, bounded to
  the report limit. It runs on the composed path, the null-draft fallback path,
  and the no-provider path (the worker passes candidates to
  `persistFallbackPresentation` too).
- A new rule covers `.github/workflows/*.yml` (category `deployment`).
- Each candidate links the first triggering path as `link` and `sourceRef` and
  carries a generic `verify` sentence.
- The Gemini system instruction asks the model to cite every candidate unless an
  agent action already covers the same step, so the composed wording is usually
  better than the generic one, but the generic one is never lost.

The stored `agentReport` is untouched; only `presentation.humanActions` grows.

## Tests

- `packages/core/service/delivery-report.test.ts` (new): field carry-through,
  omission, relative-path links, scheme rejection with warnings, bound
  enforcement, persisted round-trip, and the link predicate.
- `packages/core/service/delivery-compose.test.ts`: candidate links and verify,
  carry-through when the model does not restate, model link validation,
  appending uncited candidates, landing candidates with an empty agent report on
  both composed and fallback paths, and id-based merge bounds.
- `backend/human-actions.test.ts`: the DTO projection of the new fields.
- `webapp/.../human-actions-model.test.ts`: fixture shape.

## Versions

Contract `137`; connector manifests, the MCP manifest, the protocol-commands
manifest, and the example connector manifest declare `137`. Connector release
`0.3.43` (run `ovld agent-setup <agent>` to pick up the new skill text).
