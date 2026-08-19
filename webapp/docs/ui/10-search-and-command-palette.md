# 10 — Search & Command Palette

Two related surfaces for fast navigation and action in a keyboard-first ops tool:
the **command palette** (`⌘K` / `Ctrl+K`) for jump-to and verbs, and the **search
results** page for ranked, filtered mission search. Both honor the search capability
gate.

**Routes:** the palette is a global overlay (no route; opens over any screen);
results live at `/search?q=`.

---

## Command palette (`⌘K`)

A single overlay that blends navigation, entity jump, and actions — the fastest
path to anything.

```
┌─ ⌘K ──────────────────────────────────────────────────────────────────────┐
│ ⌕ build react…                                                             │
│ ─ Missions ────────────────────────────────────────────────────────────────│
│   1:1429  Build Realtime React Web Interface        execute ●              │
│   1:1402  Seed schema                                complete               │
│ ─ Go to ──────────────────────────────────────────────────────────────────│
│   Board · Open0           Runner queue           Connectors                │
│   Project: Billing-svc    Settings → Tokens                                │
│ ─ Actions ────────────────────────────────────────────────────────────────│
│   + Create mission…        ▷ Run focused objective   ↻ Run doctor           │
│   ⌫ Clear all execution requests                                           │
└────────────────────────────────────────────────────────────────────────────┘
   ↑↓ navigate · ↵ open · ⌘↵ run action · esc close
```

Result groups (ranked, deduped):

1. **Missions** — by `display_id` (exact, always available) and, when Group 8 is
   installed, ranked text over title + first objective. Each shows live status.
2. **Go to** — navigation targets: board, runner, changes, connectors, settings,
   and **project switching** (type a project name to jump).
3. **Actions** — context-aware verbs that map to protocol/REST:
   - Create mission (opens the create modal, doc 02)
   - Run the focused/selected objective (doc 04)
   - Answer the top blocking ask / approve a permission request (docs 03/07)
   - Clear all execution requests (doc 04)
   - Run doctor (doc 07)
   - Toggle theme/density

Behavior:

- Opens over any screen; preserves the underlying route. `esc` closes.
- Typing filters across all groups; the first result is preselected. `↵` opens,
  `⌘↵` invokes the action variant.
- Actions are RBAC-gated (Group 1): forbidden verbs are hidden or show the denial
  reason. Capability-gated targets (tokens, connectors health) only appear when
  their group is installed.

---

## Search results page (`/search`)

A full, filterable ranked search for when the palette isn't enough.

```
Search   [ q: rotation ] [ Search ]
┌──────────────────────────────────────────────────────────────────────────┐
│ Mission · review  1:1421  Token rotation                                  │
│   …rotate a USER_TOKEN and invalidate the old secret…                      │
│   └ Objective · executing  1:1421.k7xm  Rotate signing keys               │
│      …key rotation schedule…                                               │
│   └ Delivery  Summary of token rotation                                    │
└──────────────────────────────────────────────────────────────────────────┘
   mission anchors with matching objective and delivery evidence · ranked
```

- **Matchable fields**: mission text, objectives, and delivery summaries. Every
  result remains anchored by its mission; matching child rows carry an Objective or
  Delivery badge, an objective state where applicable, a highlighted snippet, and a
  direct destination.
- **Navigation**: an objective row opens the existing mission route with
  `?objective=<display-id>`. A delivery uses its owning objective through that same
  deep-link shape; there is no delivery-specific route parameter.
- The full page initially shows two child rows per mission and can expand its returned
  matches. It explicitly marks mission limits and candidate truncation, so incomplete
  search output never appears complete.

---

## Data + realtime

| Region | Read | Notes |
| --- | --- | --- |
| Ranked results | `GET /api/search/v3` | Mission-anchored groups with matching objective and delivery rows; the UI uses the portable service interface |
| Exact lookup | `GET /missions?displayId=` | always available, no Group 8 |
| Palette nav/actions | local route table + `['missions']`/`['executionRequests']` caches | no extra fetch for nav/actions |

Search results reflect live status from the mission cache/change feed (a result's
status badge updates if it changes while open), though re-ranking happens on the
next query, not continuously.

---

## States

- **No query:** the page asks for a query; the compact search remains idle.
- **No matches:** both surfaces say that no matching mission, objective, or delivery
  was found.
- **Loading and errors:** the compact search stays responsive while debouncing and
  presents failures inline; the page offers a retry.
- **Fallback and truncation:** fallback-mode results and candidate truncation are
  called out in visible status text.

---

## Keyboard model (shared)

- `⌘F`/`Ctrl+F` focuses the compact search. Its `↑`/`↓` traversal follows the
  flattened visible mission/child order and `↵` opens the active row.
- Full-page rows are ordinary focusable controls in that same visible order; `Enter`
  or `Space` opens the mission or child destination. Expansion controls announce their
  state with `aria-expanded`.

---

## Capability gating

- Ranked full-text search: Group 8 (`search_documents`); else exact + client filter.
- Creator filter and actor-scoped actions: Group 1.
- Palette actions are individually RBAC-gated and capability-gated to match the rest
  of the app.

---

## Acceptance criteria

- `⌘K` opens from any screen and can jump to a mission by `display_id`, navigate to
  any primary surface, switch projects, and invoke context-appropriate actions.
- Search renders mission anchors, indented objective/delivery evidence, kind/state
  badges, and highlighted snippets from the v3 response.
- Objective and delivery selections preserve the existing `?objective=` deep link.
- Search visibly distinguishes ordinary limits from truncated candidate results; it
  never presents incomplete output as complete.
- Palette actions respect RBAC and capability gates — forbidden/unavailable verbs do
  not appear or explain why.
</content>
