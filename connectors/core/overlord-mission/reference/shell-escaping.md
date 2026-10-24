# Shell Escaping

When a summary or question contains backticks, `$vars`, or other shell-special characters, always use `--summary-file -` (or `--question-file -`) with a single-quoted heredoc (`<<'EOF'`) to prevent shell expansion. Never retry by stripping or escaping content — stream it through that explicit file flag.

```bash
ovld protocol update --session-key <sessionKey> --mission-id $MISSION_ID --summary-file - --phase execute <<'EOF'
What you did and why — including `backticks`, "quotes", and $variables are all safe here.
EOF
```

## Inline JSON size limits

Oversized inline `--*-json` arguments are **rejected** by the CLI (limit ~8 KB per flag). This includes `--payload-json`, `--artifacts-json`, and `--objectives-json`. Pass large JSON via the paired `--*-file -` flag and a single-quoted heredoc instead:

```bash
ovld protocol deliver --session-key <sessionKey> --mission-id $MISSION_ID \
  --summary "Short narrative summary stays inline." \
  --payload-file - <<'EOF'
{"deliveryReport":{"schemaVersion":1,"agentReport":{"humanActions":[],"tradeoffsMade":[],"knownRisks":[],"deferredWork":[],"assumptions":[]}}}
EOF
```

If `heartbeat` succeeds but `deliver` or `update` fails, the session is likely fine — retry with the corresponding `--*-file -` flag rather than inline `--*-json`.

Declared paths that contain commas, or long path lists, go through `--paths-file -` as a JSON string array rather than `--paths`.

Use `--payload-file -` when the full delivery object (summary, artifacts, delivery report, and declared paths together) exceeds the inline limit.

If the summary contains special characters, use `--summary-file -` and pipe via a single-quoted heredoc (`<<'EOF'`) to prevent shell expansion.

If you use `--payload-file`, `--artifacts-file`, or `--paths-file` with a real path, treat that file as ephemeral scratch data under `.overlord/tmp` and remove it after delivery.
