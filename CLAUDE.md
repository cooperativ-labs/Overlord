Every module should adhere to the contract in `contract/CONTRACT.md`. Before beginning work, read the contract. Always make a change to any module adhere to contract where possible, and where not possible, propose a change to the contract and list the impact of that change on all other modules.

Every plan and material change summary declares `Contract impact: none|patch|minor|major`. Code and contract changes land together; never type a contract version by hand (`yarn version:contract`). See `.claude/skills/component-contract/SKILL.md`.

Always use '===' and instead of '=='  eqeqeq
Always use '!==' and instead of '!='  eqeqeq

Feature planning documents should be saved in the planning/feature-plans directory.

In an agent-pod, be sure to use the env variable `OVERLORD_USER_TOKEN` to authenticate with the backend.

`OVERLORD_PROJECT_RESOURCES_PATHS` and other similar list-valued env variables should be comma-separated, not space-separated.

<!-- OVERLORD PROJECT METADATA PROTECTION: START -->
## Overlord project metadata — do not edit

`.overlord/project.json` is exclusively managed by Overlord. Do not edit,
replace, stage, commit, delete, or revert it. If its link metadata needs to
change, use Overlord's resource-linking command instead.
<!-- OVERLORD PROJECT METADATA PROTECTION: END -->
