# Investigation: Alternative Delivery Formats (YAML / TOON)

Mission `coo:825`, objective `coo:825.0tpy`. Investigation only — no behavioral code changed.

## Question

Overlord often rejects `ovld protocol deliver`. Would a different serialization format
(YAML, TOON) raise delivery success rates? And could Overlord accept *less* structure,
leaving the internal Gemini agent to get structured data into the database?

## Answer in one paragraph

**A format swap does not address the failures we actually have.** Measured against 33 real
agent-authored change rationales, the one authoring hazard that reliably breaks an inline
delivery — an apostrophe in prose — breaks JSON, YAML, and TOON *identically*, because the
break happens in shell single-quoting, before any parser runs. Every other rejection class
occurs **after** parsing, in schema validation, where the wire format is already gone. TOON
saves 19–79 tokens on a realistic delivery, which is noise. **The second half of the question
is the right one:** loosening the schema and letting Gemini do the structuring is a real fix —
but it targets a defect that has nothing to do with format, and the *existing* compose worker
cannot do it as built.

## Evidence

### 1. Format cost, measured on real data

33 change rationales pulled from delivered missions `per:104` and `per:105`
(`ovld mission rationales --json`), reduced to the wire shape an agent authors,
tokenized with `gpt-tokenizer`:

| n rationales | JSON compact | YAML | TOON | TOON saving |
|---|---|---|---|---|
| 1 | 68 tok | +10% | **+6%** | **−4 tok (worse)** |
| 3 | 221 tok | +7% | −9% | 19 tok |
| 5 | 382 tok | +6% | −11% | 43 tok |
| 8 | 635 tok | +6% | −12% | 79 tok |
| 33 | 2,299 tok | +6% | −17% | 380 tok |

A typical delivery carries 3–8 rationales. **TOON's saving there is 19–79 tokens** — well
under 0.1% of a coding session — and TOON is *more expensive* than JSON for a single-file
delivery, because the `[n]{field,field,...}` header cannot amortize. YAML costs ~6% more
tokens at every size.

TOON's actual design goal is packing large uniform datasets *into* a model's context. A
delivery payload is small, one-shot, prose-heavy, and travels *out* to a database. The
format is well-built for a problem we don't have.

### 2. Format does not determine whether a delivery survives the shell

Each hazard below was authored into a rationale field, serialized, and pushed through
`sh -c` single-quoting exactly as an agent writes it:

| Authoring hazard | JSON inline | YAML inline | TOON inline | heredoc (any format) |
|---|---|---|---|---|
| apostrophe in prose (`can't`) | **SHELL BREAK** | **SHELL BREAK** | **SHELL BREAK** | ok |
| backtick + `$var` in prose | ok | ok | ok | ok |
| embedded double quote | ok | ok | ok | ok |
| multi-line rationale | ok | ok | **CORRUPT** | ok |
| `Note: informational` (colon) | ok | ok | ok | ok |
| `retry, backoff, and a ceiling` (comma) | ok | ok | **CORRUPT** | ok |
| leading dash | ok | ok | ok | ok |
| Windows path | ok | ok | ok | ok |

Two things follow:

- **The dominant inline failure is format-invariant.** A `'` closes the shell's quote no
  matter what is inside it. Switching to YAML or TOON changes nothing.
- **TOON adds two new corruption modes.** Commas and newlines are structural delimiters in
  its tabular form. 13% of real rationale prose fields contain a comma; 11% of cells would
  require quoting. This is not hypothetical — the first encoder pass written for this
  investigation silently produced corrupt rows until delimiter-safe quoting was added. A
  format that fails *silently* on ordinary English prose is a downgrade on a trust boundary,
  and it would need a hand-written parser (no TOON parser exists in our dependency tree).

The `--*-file -` heredoc path already documented in the mission skill survives **every**
hazard, in every format. The robustness win is already available and doesn't need a new format.

### 3. The real rejection surface is schema strictness — which is format-invariant

Twelve plausible authoring shapes run through `buildDeliveryReport`
(`packages/core/service/delivery-report.ts`):

| Authored shape | Result |
|---|---|
| `humanActions: ["Run the migration"]` (strings, not objects) | REJECTED |
| tradeoff without `rationale` | REJECTED |
| `knownRisks: "..."` (string, not array) | REJECTED |
| `schemaVersion: "1"` (string, not number) | REJECTED |
| action longer than 280 chars | REJECTED |
| 13 known risks (cap is 12) | REJECTED |
| `category: "infra"` (not in enum) | REJECTED |
| empty string inside `knownRisks` | REJECTED |
| evidence keys at top level, no `agentReport` wrapper | **ACCEPTED — data silently dropped** |
| `agent_report` / `known_risks` snake_case | ACCEPTED |
| extra unknown key | ACCEPTED |
| well-formed | ACCEPTED |

**8 of 12 shapes are rejected, and every rejection happens after parsing.** By that point the
payload is a JavaScript object and the wire format is irrelevant. YAML and TOON would be
rejected in exactly the same eight ways.

### 4. Two defects found along the way

**(a) Advisory evidence hard-blocks delivery — a contract violation.**
`CONTRACT.md:848` states these fields are "advisory agent evidence, normalized to empty arrays
when absent so evidence and model availability **never delay delivery**." In practice
`buildDeliveryReport` throws `invalid_delivery_report` (400) at
`packages/core/service/protocol.ts:1802`, *before* the transaction opens. A single over-long
`action` string, or a `category` the agent guessed, fails the **entire delivery** — including
the summary and all the change rationales, which are not advisory at all. This is very likely
the largest single contributor to the reported rejection rate.

**(b) Omitting the `agentReport` wrapper silently discards all evidence.**
Because `z.object` strips unknown keys, sending `{humanActions:[...], knownRisks:[...]}`
without the wrapper parses cleanly, yields `agentReport: undefined`, and normalizes to all
empty arrays. Exit code 0, no warning, evidence gone. Verified directly. This is worse than a
rejection — a rejection at least tells the agent to retry.

### 5. The Gemini worker cannot do what the proposal needs — as built

The good news: `enqueueDeliveryComposeJob` fires *inside the delivery transaction, after the
row is written* (`protocol.ts:2108`). The Gemini step is already strictly post-acceptance and
asynchronous — it can never gate a delivery, and it degrades cleanly to `fallback` when
`GEMINI_API_KEY` is unset. The architecture the proposal wants already exists.

The catch: `reconcileDeliveryComposeDraft` (`delivery-compose.ts:185`) **drops any human action
or tradeoff without a matching `sourceId`** from the evidence the agent already supplied. The
current worker is a *citation-constrained reorganizer*, not an extractor. It can polish
structure the agent provided; it cannot manufacture structure from prose. Pointing freeform
text at it today yields an empty report, not a structured one.

So the proposal is sound but needs a genuinely new step — extraction — rather than a reuse of
composition.

## Recommendation

Do not change the delivery format. Fix the strictness, in three tiers by value-to-effort.

### Tier 1 — Make advisory evidence actually advisory (highest value, smallest change)

Change `buildDeliveryReport` from all-or-nothing validation to **per-field salvage**: validate
each `humanActions` / `tradeoffsMade` / `knownRisks` / `deferredWork` / `assumptions` entry
independently, keep what parses, drop what doesn't, and return a `warnings[]` the CLI prints
back to the agent. Coerce the obvious slips rather than rejecting them — a bare string in
`humanActions` becomes `{action: "..."}`; an unknown `category` falls back to `'other'`;
over-length text is clamped to the documented limit; a 13th item is truncated at the cap.

This removes all eight census rejections without weakening anything a reviewer relies on, and
brings the code back in line with `CONTRACT.md:848`. It is a change to one file.

Alongside it, fix defect (b): detect evidence keys at the top level and lift them into
`agentReport` instead of stripping them.

### Tier 2 — Fail fast locally, and make the heredoc the default path

- `cli/src/commands.ts:296` currently swallows a `JSON.parse` failure on `--payload-json`
  (`catch { payloadRationales = [] }`) and lets the request round-trip to the backend for a
  generic 400. Parse locally, fail immediately, and name the remedy — `--payload-file -` with
  a single-quoted heredoc — in the error.
- Promote `--*-file -` from "use this when the payload is large" to the documented default in
  `protocol-help.ts` and the mission skill. It is the only path that survives the apostrophe,
  and the evidence says apostrophes are the thing that breaks deliveries.

### Tier 3 — Add a freeform lane (the proposal, done right)

Add `deliver --freeform-file -` taking Markdown prose. Accept and persist it immediately,
then enqueue a **new extraction job type** (not the compose job) that runs Gemini to derive
`agentReport` structure from the prose.

Three constraints keep this safe:

1. Extracted items must be stamped `source: 'extracted'`, never `source: 'agent'`, so review
   can tell inferred evidence from asserted evidence. The existing `source` discriminator on
   `HumanActionV1` / `TradeoffMadeV1` already supports this.
2. When Gemini is unconfigured the delivery still succeeds — freeform simply stays freeform,
   matching how the compose worker already degrades.
3. **Freeform cannot replace `changeRationales` coverage.** `missing_rationale` is an
   *attribution* guarantee tied to `changed_files` rows, not a formatting rule; it is what
   stops one mission from claiming another's edits. Keep the coverage check.

The cheaper adjacent win: `ovld protocol changes` already emits `draftRationales` prefilled
from local edit notes (`cli/src/commands.ts:1022`). Extending that drafting to cover every
`mine` path would satisfy coverage mechanically and remove the second-largest rejection class
without any model call at all. **Consider doing this before Tier 3** — it is cheaper, offline,
and deterministic.

## If a second format is still wanted

YAML is the only defensible candidate, and only as an *additive* input option on the
`--*-file -` path. It costs ~6% more tokens, needs no new dependency (`yaml@2.6.1` is already
in the root and CLI manifests), and its block scalars let an agent write multi-line prose with
no escaping. Note the honest caveat: 0% of the 33 real rationales contained a newline, so that
ergonomic edge is currently unused. Low cost, low benefit — worth doing only after Tier 1.

TOON should not be adopted. The token saving is negligible at delivery sizes, it is negative
at n=1, it introduces silent corruption on comma-bearing prose, and it would require
maintaining a hand-written parser on a trust boundary.

## Reproduction

Measurement scripts and the real-data samples used above are in this session's scratchpad
(`fmt/`): `real.mjs` (character census + size on real rationales), `bysize.mjs` (cost by
payload size), `failmodes.mjs` (shell-hazard matrix), `strictness.ts` (schema census),
`silent.ts` (wrapper data-loss proof).
