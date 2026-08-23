Immediately record the work you just completed in this chat as a new Overlord mission via `ovld protocol record-work`. No agent session is opened — the work is already done. This creates a mission with one completed objective, lands it in the review column, and runs the standard Gemini delivery summary.

Synthesize from the current conversation:
- `objective`: what was asked / what was done.
- `summary`: reviewer-friendly narrative of what changed and why.
- `changeRationales` (optional): reviewer annotations for changes whose reason is not obvious (`filePath`, `label`, `summary`, `why`, `impact`, optional `hunks`).
- `changedFiles` (optional, `record-work` only): files known from this completed chat work that have no rationale. Each entry is an object with canonical repository-relative `filePath` and optional `vcsStatus`; never infer ownership from a shared-worktree-wide status or diff.
- `title` (optional): mission title; defaults to a title derived from the objective.
- `artifacts` (optional): `next_steps`, `test_results`, `decision`, `note`, `url`.

If text was provided after `/record-work`, treat it as additional context for the summary.

Run `ovld protocol record-work --payload-file -` and stream a single JSON object `{ "objective": "...", "summary": "...", "title": "...", "changeRationales": [...], "changedFiles": [...], "artifacts": [...] }` on stdin via a single-quoted heredoc.

After the command succeeds, report the new MISSION_ID.

Do NOT use for in-progress work — use `/prompt` for that. The exact submission format is documented in `skills/overlord-mission/reference/record-work.md`.
