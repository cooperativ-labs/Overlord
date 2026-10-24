---
description: Record completed-from-chat work as a mission in review, with a feed post (no attach)
---

Immediately record the work you just completed in this chat as a new Overlord mission via `ovld protocol record-work`. No agent session is opened — the work is already done.

This creates a mission with one completed objective, lands it in the review column, and runs the standard Gemini delivery summary.

Synthesize from the current conversation:
- `objective`: what was asked / what was done (1-3 sentences).
- `summary`: reviewer-friendly narrative of what changed and why.
- `declaredPaths` (optional): repository-relative paths you know this work changed, as a JSON string array (deleted files and both rename endpoints are valid). They are recorded as Declared; never infer them from a shared-worktree-wide status or diff, and never explain files one by one.
- `title` (optional): mission title; defaults to a title derived from the objective.
- `artifacts` (optional): `next_steps`, `test_results`, `decision`, `note`, `url`.

If a command argument is present, treat it as additional context to weave into the summary.

Run:
`ovld protocol record-work --agent antigravity --payload-file -`

and stream a JSON object `{ "objective": "...", "summary": "...", "artifacts": [...], "declaredPaths": [...] }` on stdin via a single-quoted heredoc (`<<'EOF'`).

After the command succeeds, report the new `MISSION_ID`.

Rules:
- Do NOT use this for in-progress work. Use `/prompt` for that.
- If project resolution fails, re-run with `--project-id <id-or-name>`.
- The exact submission format is documented in `skills/overlord-mission/reference/record-work.md`.
