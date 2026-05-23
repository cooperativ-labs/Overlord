# Ticket ↔ Codebase Graph Visualization

Exploration for ticket **1:1193** — an Obsidian-style graph that lets users visually explore the relationship between tickets and the codebase, with the ability to add/remove tickets and drill into changes.

## TL;DR

The data is already there. The `file_changes` table is effectively a pre-built edge list between tickets and files, with rich edge attributes (`label`, `summary`, `why`, `impact`, `confidence`, `hunks`, `change_kind`). The first version is a force-directed graph rendered with [@xyflow/react](https://reactflow.dev) (React Flow) or [Sigma.js](https://sigmajs.org). Tickets and files are nodes; edges carry the rationale. A "compare set" of tickets in the URL drives what's shown. Past that, the high-leverage ideas are:

1. **Directory-clustered force layout** — group nodes by repo path so the topology reflects the codebase, not chaos.
2. **Shared-file overlap detection** — surface tickets that "touch the same code" so users discover hidden coupling.
3. **Hotspot heatmap mode** — size/color files by churn count and impact.
4. **Time scrubber** — replay the order in which tickets touched files (Obsidian doesn't have this; it's much more useful here).
5. **Semantic neighborhoods** — embed `file_changes.why` summaries to cluster tickets by *intent*, not just file overlap.

## What the data gives us today

`public.file_changes` columns we care about for the graph:

| column            | role in graph                                       |
| ----------------- | --------------------------------------------------- |
| `ticket_id`       | source endpoint of the edge (also a node)           |
| `file_path`       | target endpoint (file node id)                      |
| `file_name`       | display label for the file node                     |
| `label`           | one-line edge label ("Refactored auth middleware")  |
| `summary`         | hover/popover detail                                |
| `why`             | hover/popover detail (the rationale)                |
| `impact`          | edge weight / color signal                          |
| `change_kind`     | edge style (add/modify/delete/rename)               |
| `confidence`      | edge opacity (low confidence = ghosted)             |
| `hunks`           | drilldown into actual diff hunks                    |
| `created_at`      | time scrubber axis                                  |
| `session_id` / `objective_id` / `checkpoint_id` | optional finer-grained clustering |

And `get_project_file_changes(p_project_id, p_file_paths, p_include_completed)` already returns rationales joined with `ticket_data`. That's the perfect graph-fetching RPC for the per-project view.

Tickets also have implicit relationships among themselves we should expose:
- **Shared-file edges** (ticket A and ticket B both touched `lib/foo.ts`) — derived, not stored.
- **Sibling-objective edges** (same parent feature) — via `objectives.position` on the same ticket, or via a future "parent ticket" link.

## Where it lives in the app

Two complementary entry points:

1. **Ticket-centric** — on the ticket detail page (`/projects/[projectId]/[ticketId]`) add a "Graph" tab/view. Default: one ticket at the center, its files spoking out, with a "+ add ticket" affordance to bring more tickets into the canvas. URL: `?compare=ticket-id-1,ticket-id-2`.
2. **Project-centric** — a new route `projects/[projectId]/graph` showing the full project graph with filters. This is the "Obsidian graph view" analog.

Both use the same renderer component; the difference is just the initial seed set.

We already accept `?ticket=...` and `?file=...` on `current-changes` and the patterns there (URL-driven multi-select) translate cleanly.

## Library choice

| option            | pros                                                                 | cons                                                       |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| **React Flow / @xyflow/react** | React-native, easy custom nodes (we can put a TicketCard inside a node), great for ≤500 nodes, MIT, good docs | force layout requires `d3-force` separately; slows past ~1k nodes |
| **Sigma.js + graphology** | WebGL renderer, handles 10k+ nodes, has built-in force layouts | nodes are circles, not React components — drilldown UI lives in a side panel |
| **Cytoscape.js**  | Mature, lots of layouts (cola, dagre, klay), good for hierarchical views | larger bundle, less React-y |
| **vis-network**   | Out-of-the-box force-directed                                        | dated API, larger bundle                                   |

**Recommendation:** start with **React Flow + d3-force**. The interaction primitives match what we want (selection, drag, zoom, custom node components), and we get to render real TicketCard and FileListItem chunks inside nodes for instant familiarity. If a project exceeds ~1k file nodes we add a Sigma renderer behind a feature flag.

## Visual encoding (v1)

- **Nodes**
  - **Ticket nodes**: rounded card, colored by status (matches kanban colors). Pinned to compare set = solid border; floating = dashed.
  - **File nodes**: smaller circles. Color by directory (top-level folder hash → hue) so users see structure at a glance. Size by total impact count across all visible tickets.
- **Edges**
  - Color by `change_kind` (add=green, modify=blue, delete=red, rename=purple).
  - Width by `impact` (low/medium/high).
  - Opacity by `confidence`.
  - Hovering edge → popover with `label` + `why`.
- **Layout**
  - `d3-force` with three forces: charge (repel), link (rationale edges), and a **directory cohesion force** that pulls files sharing a top-level directory together. This is the single biggest improvement over a vanilla Obsidian-style layout because the codebase has real structure we shouldn't throw away.

## Add / remove tickets (core interaction)

Three ways to bring a ticket into the canvas:

1. **Tray search** — left rail with the same ticket search used in `attach`. Type, click → it slides in and immediately rebinds the force simulation.
2. **One-hop expansion** — right-click a file node → "Add tickets that touched this file." Reveals the hidden coupling between tickets.
3. **URL paste** — bookmarkable. `?compare=t1,t2,t3` survives reload.

Removal: click the ticket node's chip "×". The simulation continues smoothly — don't reset the layout.

## Ideas to make it more useful than Obsidian's graph

Obsidian's graph is pretty, but as a tool for *exploring code changes* the following are higher-leverage:

### 1. Directory-clustered layout
Group file nodes by their top-level (or 2-deep) directory using a [forceCluster](https://github.com/john-guerra/forceInABox) approach. The graph then *looks like the repo* — a glance at the cluster sizes tells you which areas of the codebase a ticket touches. Optional toggle: "treat all `tests/` files as a single super-node" to declutter test-heavy tickets.

### 2. Shared-file detection ("co-change" edges)
When two tickets in the compare set both touched the same file, draw a faint **dotted edge between the tickets themselves** (not just through the shared file). This makes coupling pop visually — "these three tickets all touch auth, even though they live on different boards." This is the killer view for code review prep and incident postmortems.

### 3. Hotspot heatmap mode
Toggle that ignores the compare set and sizes/colors every file in the project by **how many distinct tickets have touched it in the last N days**. Reveals churn hotspots, files in trouble, modules nearing maturity. This essentially turns the graph into a codebase health dashboard.

### 4. Time scrubber
A bottom slider that animates the graph forward through `file_changes.created_at`. Tickets and edges appear in the order they happened. Useful for:
- Code review ("show me the order this PR was built")
- Onboarding ("watch a month of changes play back in 10 seconds")
- Postmortem ("when did this file start changing?")

Obsidian doesn't have this; it makes far more sense for code than for notes.

### 5. Semantic clustering
Embed `file_changes.why` text (we already store rich rationale!) with a small embedding model, project to 2D with UMAP, and offer a layout mode "by intent." Two tickets that say "fixing race condition in subscription handlers" and "preventing duplicate realtime callbacks" should cluster even if their file overlap is partial. We have higher-quality text input here than any open-source graph viz because the *agent itself* wrote the rationale.

### 6. Blast-radius preview from acceptance criteria
On a draft ticket (before any work), if we have an objective and `available_tools` text, hit an LLM to predict which files are likely to be touched and render those as **ghost edges** to a phantom ticket node. Confirms or surprises the user before they spend agent time. (Optional v2; depends on inference budget.)

### 7. Pin-and-diff lanes
Pick two tickets, pin them to opposite sides of the canvas, and let the graph reflow with files in the middle. Files only touched by ticket A drift left; files only touched by ticket B drift right; shared files anchor in the center. This is a force-layout version of `git diff --stat A...B` and reads at a glance.

### 8. Filter + paint
Filter pills above the canvas: `change_kind`, `impact`, `confidence`, author/agent, time window. Each filter dims out non-matches rather than removing them so the topology stays stable. (Removing nodes mid-simulation is jarring.)

### 9. Live updates
Subscribe to `file_changes` realtime inserts for visible tickets — new edges fade in as an agent emits change rationales. The graph becomes a live diagram of what an agent is doing right now. This is *also* not something Obsidian can do, and we already have the realtime infra (`useTicketBoardRealtime.ts`).

### 10. Export to image / Markdown
"Copy as image" and "Copy as Mermaid" for posting into a PR description. Mermaid `graph LR` output from a small compare set is genuinely useful as a PR comment.

## Performance considerations

- A typical project will have a few hundred file rows per active ticket. With 5 tickets in the compare set we're at ~1k nodes worst-case — well within React Flow's comfort zone.
- The full project graph (hotspot mode) is the danger zone — could be 10k+ files. Strategies:
  - Aggregate files into directory super-nodes at low zoom; expand on zoom-in (level-of-detail).
  - Cap to "files touched in last 90 days" by default.
  - Behind feature flag, swap to Sigma.js renderer for >2k nodes.
- Edges are the real cost; render them with `d3-quadtree`-backed collision detection turned off and use straight lines (no Bezier) above 500 edges.

## API additions

Most of what we need exists. Two small additions:

1. **`get_project_graph(p_project_id, p_ticket_ids[], p_since)`** — RPC that returns `{nodes: [...tickets, ...files], edges: [...rationales]}` denormalized, scoped to the compare set. Lets the client do one fetch.
2. **`get_project_hotspots(p_project_id, p_window_days)`** — RPC that returns `{file_path, ticket_count, impact_score}` for hotspot mode.

Both can be views or set-returning functions. The RLS surface is the same as `get_project_file_changes`.

## File layout proposal

```
apps/web/components/features/projects/graph/
  GraphCanvas.tsx              # React Flow root + simulation
  GraphCompareTray.tsx         # left rail: ticket search + chips
  GraphFiltersBar.tsx          # top: change_kind/impact/confidence/time
  GraphTimeScrubber.tsx        # bottom: time-replay slider
  nodes/
    TicketNode.tsx             # custom React Flow node
    FileNode.tsx
    DirectoryClusterNode.tsx   # aggregated at low zoom
  edges/
    RationaleEdge.tsx          # custom edge with hover popover
    CoChangeEdge.tsx           # dotted ticket↔ticket
  simulation/
    forces.ts                  # d3-force config + directory clustering
    layouts.ts                 # alternate layouts (intent, hotspot, lanes)
  view-model.ts                # raw file_changes[] -> {nodes,edges}
  use-graph-data.ts            # data fetching + realtime subscription
apps/web/app/(app)/projects/[projectId]/graph/page.tsx
apps/web/app/(app)/projects/[projectId]/[ticketId]/graph-tab.tsx (optional)
```

## Suggested v1 scope (smallest useful slice)

1. New route `/projects/[projectId]/graph?compare=...`
2. React Flow canvas + d3-force, no clustering yet
3. Ticket nodes (status-colored) + file nodes (directory-hued)
4. Edges colored by `change_kind`, hover popover with `label`/`why`
5. Left tray to add/remove tickets; URL stays in sync
6. One-hop expansion ("add tickets that touched this file") on file right-click

That's a 1–2 day spike that ships value, after which 2 (shared-file edges), 1 (directory clustering), and 4 (time scrubber) are the next-best returns per day of work.

## Open questions

- Should this be a top-level nav item or always reached via a ticket/project sub-route? Recommend sub-route; navigating to "graph" without context is rarely the user's intent.
- Mobile: graph viz on mobile is genuinely hard. Recommend a "list mode" auto-swap below ~640px (we already have `TicketListView`).
- Permissions: rationales include `why` text which can be sensitive. The existing RLS on `file_changes` should cover this — confirm before exposing a public-share view.
- Do we want **cross-project** graphs (org-wide hotspots)? Possible but RLS gets harder. Park for v2.

## Non-goals (intentionally out of scope)

- AST-level dependency graphs (calls/imports between files). Different problem, different data, different audience. Don't conflate.
- Replacing `current-changes`. The graph is a sibling exploration view, not a replacement.
- Editing the graph (manual edges). The graph reflects recorded change rationales; edits belong on the ticket, not the visualization.
