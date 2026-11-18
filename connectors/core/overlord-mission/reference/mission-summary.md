# Mission summary and delivery: payload reference

The rules for writing a mission summary, delivering, declaring missed paths and recovering
from errors are in the **attach response** (`agentInstructions`); they take precedence over
this file. This file holds only shapes, limits and examples. Command and tool names depend on
the connection method: `ovld protocol ...` over the CLI, `overlord_*` tools over MCP.

## Attach baseline (`missionSummary`)

Returned by `attach` and `resume-follow-up` when the mission has a summary. `load-context` and
`connect` never carry it.

```json
{
  "missionSummary": {
    "contentRevision": 7,
    "evidenceRevision": 15,
    "narrative": { "state": "outdated", "evidenceRevision": 15, "publishedEvidenceRevision": 14,
                   "outstandingDeliveryId": null, "…": "…" },
    "headline": "Current headline, or empty before the first write.",
    "summary": "Current summary Markdown, or empty.",
    "author": "agent",
    "openItems": [
      { "id": "<item id>", "kind": "risk", "objective": "coo:1260.7taz", "text": "…" },
      { "id": "<item id>", "kind": "human_action", "objective": "coo:1260.7taz", "text": "…", "blocking": true },
      { "id": "<item id>", "kind": "suggestion", "objective": "coo:1260.7taz", "text": "…" }
    ],
    "truncated": false
  }
}
```

`author` is `agent`, `gemini`, `deterministic`, or `null` when there is no prose. `openItems`
holds at most 60 entries; `truncated: true` means more are open. `narrative.state` is `absent`,
`current`, `outdated` (later work changed the mission) or `legacy` (older text with no recorded
basis). Only agents write the summary; nothing generates or repairs it.

## Delivery payload

```json
{
  "summary": "Narrative for the reviewer: what this objective did and how it was verified.",
  "missionSummary": {
    "baseContentRevision": 7,
    "baseEvidenceRevision": 15,
    "headline": "At most 140 characters.",
    "summary": "Markdown, at most 1,200 characters.",
    "closeItems": [
      { "id": "<item id>", "status": "done", "reason": "Retry guard added and tested in this objective." },
      { "id": "<item id>", "status": "dismissed", "reason": "The endpoint this warned about was removed." }
    ]
  },
  "deliveryReport": {
    "schemaVersion": 1,
    "agentReport": {
      "humanActions": [],
      "tradeoffsMade": [],
      "knownRisks": [],
      "deferredWork": [],
      "assumptions": []
    }
  }
}
```

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID --payload-file - <<'EOF'
{ "summary": "…", "missionSummary": { "baseContentRevision": 7, "baseEvidenceRevision": 15, "headline": "…", "summary": "…", "closeItems": [] } }
EOF
```

Limits and validation:

- `baseContentRevision` is required with `headline` and `summary`; those two go together.
  Send `baseEvidenceRevision` too: without it the prose is withheld.
  `closeItems` may be sent alone (at most 50 entries, `reason` at most 280 characters).
- `--mission-summary-file <path|->` sends the same object on its own and wins over the payload
  field. Only one `--*-file` flag may read stdin.
- Malformed input is rejected with 400 `invalid_input` before anything is written.
- Inline `--payload-json` is limited to roughly 8 KB; stream larger values through `--*-file -`.
- `record-work` accepts the same `missionSummary` object without `baseContentRevision`
  (see [record-work.md](record-work.md)).

Deliver response: `missionSummary { contentRevision, narrativeWritten, closedItemIds, warnings,
publication: { id, available, withheldReason }, baseline? }`. Warnings never block:
`mission_summary_item_skipped`, `mission_summary_style`, `mission_summary_disabled`,
`mission_summary_withheld`.

## Withheld or omitted prose

A stale `baseContentRevision` or `baseEvidenceRevision` (other work was accepted since your
baseline), a missing `baseEvidenceRevision`, or no prose never rejects the delivery. The delivery
and closes are accepted, the existing text stays, and `publication.available` is `true`
(`withheldReason`: `stale_content`, `stale_evidence`, `missing_evidence_base` or `absent`). The
instruction in the response leads with the publication step:

```bash
ovld protocol delivery-summary-context --mission-id <mission> --delivery-id <deliveryId> --session-key <sessionKey>
ovld protocol publish-delivery-summary --mission-id <mission> --delivery-id <deliveryId> \
  --session-key <sessionKey> --payload-file - <<'JSON'
{ "baseContentRevision": 8, "baseEvidenceRevision": 16, "headline": "…", "summary": "…" }
JSON
```

Over MCP: `overlord_delivery_summary_context` and `overlord_publish_delivery_summary` (choose an
`operationId` yourself and reuse it on retries). Rewrite for the whole mission from the returned
baseline. One publication per delivery; the same operation id and text replays. `record-work`
deliveries need no session key. There is no deadline.

Errors (nothing is written):

- 409 `mission_summary_conflict`: bases are stale. The CLI prints `{ code, missionSummary,
  publication, instruction }` on stdout; MCP error details carry the same. Reconcile and try once
  more, then stop and say the summary is not updated.
- 409 `mission_summary_publication_superseded`: newer work, a follow-up or a reopen owns the next
  summary. Say the mission summary is outdated.
- 409 `mission_summary_already_published`; 404 `mission_summary_publication_not_found`.

Never deliver again or resume follow-up only to update the mission summary.

## Delivery report items

### Deferred work

| Field      | Limit     | What to write                                                |
| ---------- | --------- | ------------------------------------------------------------ |
| `title`    | 80 chars  | The work, as an imperative phrase. Shown as the row title.   |
| `change`   | 400 chars | The specific change that is needed, in one or two sentences. |
| `location` | 200 chars | Where to find it: the file, function, component, or command. |
| `doneWhen` | 200 chars | The observable result, in one sentence.                      |

All four fields are required. A plain string item is rejected with `invalid_input`.

> Vague: `{ "title": "Fix flaky test", "change": "The sync worker has a flaky test.", "location": "backend", "doneWhen": "It passes." }`
> Good: `{ "title": "Advance the fake clock before the second retry", "change": "The test asserts the retry fired but never advances the fake clock between attempts, so it passes or fails on real time.", "location": "backend/sync-worker.test.ts › retries after a 503", "doneWhen": "The test passes 20 consecutive runs with the fake clock driving both attempts." }`

### Human actions

| Field      | Expected   | What to write                                                                                     |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `action`   | required   | One imperative sentence naming the exact thing to do, where, and with what value.                 |
| `reason`   | expected   | Why the step is needed and what breaks or stays incomplete until it is done.                      |
| `category` | expected   | `environment`, `database`, `deployment`, `codegen`, `packaging`, `external_service`, or `other`.  |
| `blocking` | optional   | `true` when the delivered work does not function until this is done.                              |
| `command`  | when known | The exact command, setting name, or value to apply, verbatim. Placeholders in `<angle brackets>`. |
| `verify`   | when known | How the operator confirms it worked: a command to run, a URL to open, or the state to observe.    |
| `link`     | when known | An HTTP(S) URL or a repository-relative file path (never another URI scheme).                     |

```json
{
  "action": "Add GEMINI_API_KEY to the production backend service on Railway.",
  "reason": "The delivery-compose worker falls back to the raw summary until a provider key is present.",
  "category": "environment",
  "blocking": false,
  "command": "railway variables set GEMINI_API_KEY=<key> --service backend",
  "verify": "The next delivery card shows a composed presentation instead of 'fallback' in the worker log.",
  "link": ".env.example"
}
```

Overlord also derives `deterministic_rule` actions from changed paths (new migrations,
`.env.example`, dependency manifests, CI workflows) and always shows them; reporting one yourself
with a real `command` and `verify` replaces the generic wording.

## Captured file evidence

`ovld protocol changes --objective-id $OBJECTIVE_ID` is a local read of this checkout's sessions.
It syncs pending ledger entries first (failure is advisory) and returns paths deduplicated by
path, capped at 200 rows with a pre-cap `total` and `truncated`, plus capture and sync warnings.
`coverage: "unavailable"` means no local session matched, not "no files changed".
`ovld protocol objective-changes --objective-id $OBJECTIVE_ID` (hosted MCP `overlord_changes`)
reads synchronized evidence across sessions, resources and devices but not unsynchronized local
rows. Neither read diffs the worktree, classifies ownership, or gates delivery.

Row sources: `declared_edit` (shown Native), `agent_declared` (Declared), `null` (Unknown).
Native capture records a path only for a successful, codec-normalized edit; reads, searches and
fetches are silent. Warning codes: `shell_activity_unverified`, `outcome_partial`,
`outcome_unavailable`, `direct_path_unavailable`, binding warnings (unbound, no callback
observed, availability unknown), and sync warnings. A warning is not proof that a file changed.

## Declaring missed paths

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID \
  --summary "Narrative." \
  --paths src/generated/schema.ts,docs/old-name.md,docs/new-name.md

ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID \
  --summary "Narrative." --paths-file - <<'EOF'
["src/generated/schema.ts", "fixtures/a,b.json"]
EOF
```

- A rename declares both endpoints; a deleted or renamed-away path is valid.
- Quote an inline value containing spaces, or use the JSON array form.
- Paths are normalized against the checkout. Traversal, symlinks leaving the checkout, ignored
  paths and Overlord-managed paths are rejected with a reason on stderr and never fail the call.
- If the local binding or ledger is unavailable, pass `--session-key` and `--objective-id`
  explicitly; the CLI submits the paths through the authenticated session as Declared. If that
  sync fails, repeat the declarations on a later update/deliver. Re-run attach in the intended
  checkout with the same `OVLD_HOME` to restore native capture.
- Retired inputs: `--change-rationales-*`, `--changed-files-*`, and the `changeRationales` /
  `changedFiles` payload fields are rejected.

## Other missions' unresolved items

Attach includes only `missionSummary.otherMissionOpenItems`. When positive, run
`ovld protocol project-items --mission-id <id>` (MCP `overlord_project_items`)
before delivery. It uses your live objective change ledger plus comma-separated
`--path` evidence to rank accepted open items from other missions in this project.
`--query` is a case-insensitive text substring, never an id lookup. Filter with
`--kind risk,human_action,suggestion`; default limit is 20, max 100, with `--offset`.
`--include-own-mission` includes your own items. Draft observations never count.
`scanTruncated` means only the newest 2,000 rows were scanned; `ledger.captureGap`
means supply explicit paths. Restart pages after concurrent changes. Full detail
requires an authorized mission read; compact matches are leads, not proof.

Verify in code that the work resolved or obsoleted an item before closing it, with
a reason naming the verified change. Both standalone `close-items` and delivery
`missionSummary.closeItems` are valid for same-project items. Retain the exact
delivery operation id and semantic body for uncertain-response replay. If accepted
prose is withheld, use delivery-summary-context and publish-delivery-summary with
fresh content/evidence bases and a separate retained publication operation id.
Never resend closes to publication or redeliver to repair accepted prose.
Opt-in report drafts remain provisional: retain batch ids/digests on retry, rebase
CAS refusals, inspect current revision and seal at delivery; discovery reads no drafts.
