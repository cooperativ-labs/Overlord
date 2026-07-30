Every module should adhere to the contract in CONTRACT.md. Before beginning work, read the contract. Always make a change to any module adhere to contract where possible, and where not possible, propose a change to the contract and list the impact of that change on all other modules.

## Skills

`.claude/skills/` is the single source of truth for this repo's skills, whatever agent harness you are running in. Start from `.claude/skills/SKILLS_INDEX.md`, which lists every available skill and its file.

`.agents/skills` is a symlink to `.claude/skills`, so harnesses that discover skills under `.agents/` resolve to the same files. Do not replace it with copies: when the two directories were maintained separately they drifted, and a search-and-replace over the duplicate produced skills referencing paths that do not exist (`.Codex/skills/...`, `connectors/adapters/Codex/...`).

When you add, update, or remove a skill, edit it under `.claude/skills/` and update `.claude/skills/SKILLS_INDEX.md`. Nothing else needs mirroring.

<!-- OVERLORD PROJECT METADATA PROTECTION: START -->
## Overlord project metadata — do not edit

`.overlord/project.json` is exclusively managed by Overlord. Do not edit,
replace, stage, commit, delete, or revert it. If its link metadata needs to
change, use Overlord's resource-linking command instead.
<!-- OVERLORD PROJECT METADATA PROTECTION: END -->
