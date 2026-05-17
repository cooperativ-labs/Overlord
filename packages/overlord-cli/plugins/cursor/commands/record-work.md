Run `ovld protocol record-work --payload-file -` to record completed-from-chat work as a ticket in review + feed post (no attach).

Synthesize from the current conversation: `objective` (what was asked/done), `summary` (reviewer-friendly narrative), `changeRationales` (one entry per meaningful git-tracked file change — `label`, `file_path`, `summary`, `why`, `impact`, optional `hunks`; use `git status`/`git diff` to enumerate), and optional `artifacts` (`next_steps`, `test_results`, `decision`, `note`, `url`).

If text was provided after `/record-work`, treat it as additional context for the summary.

Stream the JSON payload on stdin via a single-quoted heredoc. Report the new TICKET_ID.

Do NOT use for in-progress work — use `/prompt` for that. If `ovld` reports `OVERLORD_URL` is unreachable, stop and request permission escalation or network access before retrying.
