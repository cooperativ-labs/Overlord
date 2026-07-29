# Refactor Reviews

Output of the `refactor-review` skill (`.claude/skills/refactor-review/SKILL.md`).

One file per run: `YYYY-MM-DD-<area>.md`, plus a `-follow-up` suffix if an area is reviewed twice
on the same day. Areas are `backend`, `core`, `cli`, `webapp`, `desktop`, `database`,
`agent-surfaces`, and `platform-services` — see
`.claude/skills/refactor-review/reference/rotation.md` for the rotation order and how to pick the
next area.

These reports are **plans, not records of work**. Each finding is scored by value and effort and
broken into independently landable steps. The refactors themselves are filed as separate Overlord
missions; this directory is where the reasoning behind them lives, and where the next run reads
the previous measurements to see whether an area is improving.

Related review skills, which answer different questions: `code-review` (is this code correct?),
`drift-review` (do the product surfaces still agree?), `security-audit` (can this be attacked?).
