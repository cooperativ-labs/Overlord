# 06 — Files changed during this objective

Each objective in the mission panel shows a read-only, compact list of durable
objective-scoped path evidence: **Files changed during this objective**. It reads
the server objective projection and never scans the working tree to infer
ownership. There is no per-file explanation; the delivery summary carries the
narrative.

**Surface:** embedded in each objective's evidence stack in mission detail. The
current product does not expose a standalone current-worktree diff route.

---

## Evidence boundary

- Connector callbacks append to an owner-only local ledger only when an explicit
  objective/session binding exists, and only for successful edits with exact
  workspace-relative paths. Those rows carry `source: declared_edit` (Native).
- Agents declare known shell/script outputs, deletes and both rename endpoints
  with `--paths` / `--paths-file` or record-work; those rows carry
  `source: agent_declared` (Declared). Native evidence is never downgraded.
- Historical rows without reliable provenance carry `source: null` (Unknown) and
  are never relabeled Native.
- The backend stores paths and bounded capture diagnostics only. It never receives
  file content, a diff, a raw command, a transcript, environment values, a
  fingerprint, or an absolute host path.

There is no VCS baseline, worktree-wide delta, rationale, or window metadata in
this surface.

---

## Layout and behavior

The list is one section per objective, not per run: it is cumulative across every
session and run of the objective, including edits later reverted. Rows are sorted
by resource then path (server order) and grouped under a resource header when they
span more than one resource. Equal relative paths in different resources are
distinct rows. Rows without a resolved resource (sessionless record-work) form an
"Unresolved resource" group instead of being guessed into the primary resource.
Grouping follows recorded evidence even when another resource is no longer
linked on this device. An editor link requires a matching resource root.

A row shows the derived basename, its directory, and a Native / Declared / Unknown
chip. Hovering shows the full path and last observation time. When the selected
execution target exposes the row's resource root, the basename opens in the user's
configured editor; otherwise it is plain text.

Below the rows: a truncation notice when the server capped the list, objective
capture warnings, a cumulative/pending-sync note, and on-demand per-session capture
details (binding, callback observed, health codes). The section rule shows the
pre-cap total and a warning mark when tracking was incomplete, so both are visible
while it is collapsed. Collapsed objective rows show the same total as a badge.

---

## Data and refresh

| Region | Read | Refresh |
| --- | --- | --- |
| Objective files | `GET /api/missions/:id/file-changes?objectiveId=` → `ObjectiveFileChangesDto`, key `['mission', id, 'file-changes', 'objective', objectiveId]` | `changed_file` and `agent_session` entity changes invalidate the `['mission', id, 'file-changes']` prefix |
| Deleted objectives | mission-wide page `GET /api/missions/:id/file-changes`, rows whose objective is gone, under "Unassigned evidence" | same prefix |
| Resource label/root | project resources for the selected execution target | normal project-resource invalidation |

The objective filter is applied on the server before the 200-row cap, so a busy
sibling objective can never hide this objective's rows. The UI never partitions
the capped mission-wide page into per-objective lists. The server read cannot see
paths still pending sync on the agent's machine and the UI says so.

Capture warnings aggregate across every session of the objective; a newer healthy
session never hides an earlier gap.

---

## States

- **Listed:** rows, plus any warnings and truncation notice.
- **Nothing captured:** capture sessions exist but no path synchronized — "No file
  changes were captured", with "and tracking was incomplete" when warnings exist.
  This is not a claim that nothing changed.
- **Unavailable:** no capture session and no path — "File tracking was not
  available for this objective, so no file list exists."
- **Truncated:** "Showing 200 of N files".
- **Loading / read failure:** muted loading line; bounded error text.
- **No local resource root:** rows remain readable; editor linking is omitted.

---

## Acceptance criteria

- Each objective's list comes from the objective-filtered server read, never a
  partition of the capped mission page.
- No per-file prose, VCS status, or window metadata is displayed.
- Native / Declared / Unknown chips reflect stored provenance; Unknown is never
  shown as Native.
- Empty capture, unavailable tracking and truncation read distinctly.
- Unbound, configured-with-no-callback, unknown and incomplete-tool-capture
  warnings stay visible, including gaps from older sessions.
- Multi-resource objectives keep resource-distinct rows and resolve editor links
  against the row's resource and selected execution target.
- No repository content leaves the execution target through this surface.
