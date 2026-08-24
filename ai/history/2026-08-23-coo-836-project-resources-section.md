# coo:836 — Project settings Resources section

Objective `coo:836.h750` asked for a more robust UX for managing project resources: a whole
Resources section in project settings rather than a single menu item, with an add-resource page,
one page per resource, and per-source agent settings surfaced inline.

## What changed

All work is inside the webapp module. No REST, DTO, or contract change was needed — the existing
`ProjectResourceDto` already carries the name (`resourceKey`), id, `accessMode`, and the
`sources[]` array with per-agent `launchDefaults`.

### Navigation

- `webapp/web/components/settings/SettingsDialogShell.tsx` — `SettingsNavItem` gained an optional
  `key` so a nav entry can have a stable identity distinct from its user-authored display name.
  The sidebar, mobile select, and breadcrumb resolve through the new `settingsNavItemKey` helper.
- `webapp/web/components/projects/ProjectSettingsModal.tsx` — the single `Resources` nav item is
  replaced by a labelled `Resources` nav group containing an `Overview` page, one item per linked
  resource (named by its resource key), and an `Add resource` item. Creating a resource navigates
  to its new page; deleting one (or losing it to a concurrent change) falls back to the overview.

### Pages (new directory `webapp/web/components/projects/project-settings/resources/`)

- `ResourcesOverviewPage.tsx` — the former `ResourcesPage`, minus the inline resource editors:
  execution target, default branch, the missing-primary warning, and an index of resources that
  links to each resource's page.
- `AddResourcePage.tsx` — the former add-resource dialog as a full page (name, source kind,
  path/URL, execution target, primary toggle, permission).
- `ResourceDetailPage.tsx` — name, permission, a read-only copyable resource ID, the sources
  accordion, the add-source form, and a delete section with a confirmation dialog.
- `ResourceSourceRow.tsx` — one accordion row per source. The trigger states the path and its
  execution target on the first line with "Expand for agent settings" as the subtitle; the panel
  holds the editable path, a remove-source control, and the agent settings table.
- `SourceAgentDefaultsTable.tsx` — per-agent pre-command and flags as a table, replacing the
  slider-icon dialog that previously hid these settings.
- `AddSourceForm.tsx`, `resource-display.ts` — extracted unchanged behavior and shared labels.

`webapp/web/components/projects/project-settings/ResourcesPage.tsx` was removed.

## Verification

`yarn typecheck:webapp`, `yarn lint` (0 errors), and `yarn test:webapp` (193 passing) all clean.
