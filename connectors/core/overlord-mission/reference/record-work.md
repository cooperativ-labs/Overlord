# Recording Completed Work (`record-work`)

Use `record-work` to log work that is **already finished** — for example, something you
just built for the user in a chat app — as a completed Overlord mission. It is the
after-the-fact equivalent of `create` + `attach` + `deliver`, collapsed into one call:

1. Creates a mission with a **single completed objective** matching the work done.
2. Records explicitly supplied changed files and any optional reviewer annotations.
3. Lands the mission in the **review** column.
4. Runs the delivery through the **standard Gemini delivery summarizer**, so the result
   reads like any other delivered (in-review) mission.

There is **no agent session** — do not `attach`. Do not use this for in-progress work
(use `create`/`prompt` for that).

## Submission format (authoritative)

Submit **one JSON envelope** on stdin. This is the efficient, quoting-safe path and is
identical across the CLI (`--payload-file -`) and the hosted MCP tool
(`overlord_record_work`).

```jsonc
{
  "objective": "What was asked and what you did, phrased as a completed objective (1–3 sentences).",
  "summary": "Reviewer-facing narrative of what changed and why. This is what the PM reads first.",
  "title": "Optional mission title; defaults to a title derived from the objective.",
  "changeRationales": [
    {
      "filePath": "src/widget.ts",   // repository-relative path
      "label": "Add widget",          // short reviewer title
      "summary": "New widget module.", // what changed in this file
      "why": "User asked for a widget.", // why it changed
      "impact": "Widget now renders on the dashboard." // behavioral impact
    }
  ],
  "changedFiles": [
    { "filePath": "src/generated.ts", "vcsStatus": "M" }
  ],
  "artifacts": [
    { "type": "next_steps", "label": "Next steps", "content": "…" } // optional
  ]
}
```

### Field rules

- **`objective`** (required) — the completed objective text. May also be passed as
  `--objective`/positional on the CLI; a flag always wins over the envelope.
- **`summary`** (required) — narrative, not a command list.
- **`title`** (optional) — omit to derive from the objective.
- **`changeRationales`** (optional reviewer annotations) — same shape as `deliver`. All
  five string fields (`filePath`, `label`, `summary`, `why`, `impact`) are required per
  entry. Use canonical `filePath`; do **not** wrap entries under a `rationale` key.
- **`changedFiles`** (optional, `record-work` only) — files known to have changed during
  this completed chat work. Each entry is an object with a canonical repository-relative
  `filePath` and optional bounded `vcsStatus`; raw strings, absolute paths, and extra fields
  are rejected. A rationale's `filePath` is recorded automatically, so do not list it twice.
  Do not infer ownership from a shared-worktree-wide status or diff.
- **`artifacts`** (optional) — `next_steps`, `test_results`, `migration`, `note`, `url`,
  or `decision`.
- **`deliveryReport`** (optional) — you may include a `deliveryReport.agentReport`
  (`humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, `assumptions`) just as
  in `deliver`. It improves review visibility but never blocks the record.

## CLI

Stream the envelope on stdin with a single-quoted heredoc (safe for backticks/`$vars`):

```bash
ovld protocol record-work --payload-file - <<'EOF'
{
  "objective": "Add a CSV export button to the reports page.",
  "summary": "Added a CSV export control and the serializer behind it.",
  "changeRationales": [
    { "filePath": "src/reports/export.ts", "label": "CSV serializer",
      "summary": "New CSV serializer.", "why": "Users need offline reports.",
      "impact": "Reports can be exported as CSV." }
  ],
  "changedFiles": [
    { "filePath": "src/reports/generated-schema.ts", "vcsStatus": "M" }
  ]
}
EOF
```

- Project resolution: matches the current directory to a project resource. Pass
  `--project-id <id-or-name>` when running outside a linked checkout or to be explicit.
- The command prints the new mission (and `MISSION_ID`); report it back to the user.
- Inline `--*-json` flags are capped (~8 KB) — prefer `--payload-file -` on stdin.

## Hosted MCP

Call `overlord_record_work` with the same fields as first-class arguments
(`projectId` **required** — hosted MCP never chooses a project implicitly):

```jsonc
{
  "projectId": "acme-web",
  "objective": "Add a CSV export button to the reports page.",
  "summary": "Added a CSV export control and the serializer behind it.",
  "changeRationales": [
    { "filePath": "src/reports/export.ts", "label": "CSV serializer",
      "summary": "New CSV serializer.", "why": "Users need offline reports.",
      "impact": "Reports can be exported as CSV." }
  ],
  "changedFiles": [
    { "filePath": "src/reports/generated-schema.ts", "vcsStatus": "M" }
  ]
}
```

The tool returns the created review-column mission and the `deliveryId` whose Gemini
summary is composing asynchronously.
