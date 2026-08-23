# 06 — File Changes

The mission panel's **File Changes** section is a read-only projection of durable,
objective-scoped path evidence. It starts from `changed_files` and joins an optional
agent-authored rationale for the same objective and path. It never scans the working
tree to infer ownership.

**Surface:** embedded in mission detail. The current product does not expose a
standalone current-worktree diff route.

---

## Evidence boundary

- Connector callbacks append to an owner-only local ledger only when an explicit
  objective/session binding exists.
- A connector-owned codec must normalize the callback as `file.edited` and return
  an exact workspace-relative path before the ledger can record
  `declared_edit` / `direct` evidence.
- Known read-only callbacks are silent. Shell, generic, unmapped, mutation-capable
  no-path, and unavailable callbacks record bounded hook health without claiming a
  file.
- No shipped connector currently proves a paired mutation window, so
  `window_observed` / `window` remains reserved.
- The backend stores paths and bounded attribution metadata only. It never receives
  file content, a diff, a raw command, a transcript, environment values, a
  fingerprint, or an absolute host path.

There is no VCS baseline, worktree-wide delta, unassigned-workspace bucket,
rationale skip, or no-file-change override in this surface.

---

## Layout and behavior

Rows are newest-first and grouped by logical project resource when a project has
more than one relevant resource. A collapsed row shows the basename, optional
recorded VCS status, attribution source, and observation time. Expanding it shows:

- the normalized repository-relative path;
- source and quality, plus overlapping-window metadata when present;
- bounded hook health;
- the optional rationale fields (`label`, `summary`, `why`, `impact`).

A row without rationale prose stays visible and is labeled as an observed file
change with no rationale recorded. Missing rationale is non-blocking review
metadata.

When the selected execution target exposes the row's resource root, the path opens
in the user's configured editor. This is a local editor deep link, not a backend
diff read. Without a usable resource root, the UI renders the repository-relative
path as text.

---

## Data and refresh

| Region | Read | Refresh |
| --- | --- | --- |
| File evidence | `GET /api/missions/:id/file-changes` | `changed_file` entity changes invalidate `['mission', id, 'file-changes']` |
| Optional rationale | latest `change_rationales` row joined by objective/path | `change_rationale` changes invalidate the same query |
| Resource label/root | project resources for the selected execution target | normal project-resource invalidation |

The REST projection is changed-file-first: every observed path appears once even
when no rationale exists. Historical malformed evidence metadata stays reviewable
without an attribution badge; it does not become active write input.

---

## States

- **No evidence:** "No file changes yet."
- **Loading:** compact spinner while evidence or project resources load.
- **Read failure:** bounded error text without exposing credentials or raw backend
  internals.
- **No rationale:** the row remains visible with a neutral explanatory message.
- **No local resource root:** metadata remains readable; editor linking is omitted.
- **Pathless unavailable hook evidence:** reported by local protocol preflight, not
  as a File Changes row; the review projection never invents a path.

---

## Acceptance criteria

- Every durable `changed_files` row for the mission is visible once, newest-first.
- The UI never fabricates file ownership from CWD, Git status, or a shared
  worktree delta.
- Optional rationales enrich a path but never determine whether it is listed or
  whether delivery can complete.
- Source, quality, overlap, and hook health accurately reflect the stored bounded
  evidence.
- Multi-resource missions resolve editor links against the row's resource and
  selected execution target.
- No repository content leaves the execution target through this surface.
</content>
