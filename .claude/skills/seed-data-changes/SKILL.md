---
Name: seed-data-changes
Description: Use this skill to make changes to the seed data.
---

NEVER change the seed.sql file directly. Always use the seed.ts file to make changes to the seed data.

After `yarn seed:sync`, fix Snaplet introspection gaps in `.snaplet/dataModel.json`, then run `npx @snaplet/seed generate`:

- `project_tag_definitions_project_id_label_key`: include both `project_id` and `label` (expression indexes on `lower(btrim(label))` introspect as `project_id` only).
- `objectives_one_draft_per_ticket_idx` and `objectives_one_executing_per_ticket_idx`: remove from `uniqueConstraints` (partial indexes `WHERE state = …` introspect as `ticket_id` only; Snaplet would block multiple completed objectives per ticket).

Without `label`, Snaplet rejects multiple tags per project. Without removing the objective partial-index entries, Snaplet rejects multiple non-draft objectives on one ticket.
