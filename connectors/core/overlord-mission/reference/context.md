# Context And Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --mission-id $MISSION_ID
ovld protocol write-context --session-key <sessionKey> --mission-id $MISSION_ID --key "key" --value '"json-value"'
ovld protocol update-artifact --mission-id $MISSION_ID --artifact-id <artifact-id> \
  --expected-revision <n> --label "Revised plan" --content-text-file -
ovld protocol attachment-list --session-key <sessionKey> --objective-id <objective-id>
ovld protocol attachment-upload-file --session-key <sessionKey> --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --attachment-id <attachment-id>
```

The `attach` and `load-context` responses already include an `attachments` array plus `previousObjectives` and `futureObjectives` arrays — use those for `<attachment-id>` and `<objective-id>` values. The objective currently being executed is not repeated in those arrays; it is the top-level `objective`. `previousObjectives` are the objectives already worked (before the current one) and `futureObjectives` are the ones queued after it. Run `attachment-list` mid-session if new files have been uploaded since attach. `--mission-id` is optional for attachment calls when `--objective-id` or `--attachment-id` lets the server derive the mission.

## Updating existing artifacts

When a later objective or follow-up must revise a plan, notes, or URL artifact created earlier, call `update-artifact` (or MCP `overlord_update_artifact`) instead of delivering a duplicate. Use the artifact `id` and `revision` from the mission `artifacts` array (or `ovld mission artifacts`). Provide at least one of `--label`, `--content-text` / `--content-text-file`, or `--external-url`. No session key is required. Stale `--expected-revision` returns a conflict — refresh and retry. Delivery/session/objective provenance and `contentJson` remain immutable.

## Large Artifacts

For large artifacts such as planning documents, architecture decisions, research summaries, or design documents: **save the full content as a markdown file in the linked repository, then summarize it in the artifact returned to the mission.**

- Save to a meaningful path in the repository (e.g., `ai/feature-plans/my-feature.md` for feature plans, `docs/decisions/my-decision.md` for architecture decision records).
- Commit the file as part of the mission's work so it appears in `changeRationales`.
- In the delivery, include a `note` or `decision` artifact with a concise summary and the repository file path — not the full document content.

This keeps the mission feed readable while preserving the full document in version control where it can be reviewed, diffed, and referenced later. If that summary artifact already exists on the mission, revise it with `update-artifact` rather than creating another copy.

