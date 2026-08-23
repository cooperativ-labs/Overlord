# 05 — Review & Delivery

The screen that makes Overlord useful *after* an agent finishes. When a
delivery moves a mission to `review`, this surface lets a human evaluate what was
asked, what happened, what was delivered, what changed and why, and what still
needs follow-up — **without opening the original agent chat**. It must be easier to
scan than terminal logs.

**Route:** `/p/:projectId/missions/:missionId/review` (also embedded as the top of
mission detail when status is `review`).

---

## Layout

```
┌─ Review · 1:1421  Token rotation ─────────────────────  [status: review] ────────────┐
│ Delivered by claude·opus · objective "Add rotation" · session a1b2… · 12m ago         │
│ [ ✓ Complete ]  [ + Add follow-up objective ]  [ ⟲ Reopen / ask for changes ]         │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Delivery summary ───────────────────────────────────────────────────────────────┐ │
│ │ Narrative summary (what was asked, what happened, what's left). Markdown.         │ │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌─ File evidence ──────────────────────┐  ┌─ Artifacts ──────────────────────────────┐ │
│ │ 4 objective-ledger paths             │  │ ▸ test_results  "vitest 41 pass"          │ │
│ │  src/auth/token.ts      direct + note│  │ ▸ next_steps    "wire rotate to UI"       │ │
│ │  src/auth/token.test.ts direct       │  │ ▸ migration     "add user_token_scopes"   │ │
│ │  src/auth/index.ts      direct + note│  │ ▸ note / url / decision …                 │ │
│ │  src/rbac/authorizer.ts direct       │  └──────────────────────────────────────────┘ │
│ │  [ inspect file evidence ]           │  ┌─ Objective completion history ───────────┐ │
│ │                                      │  │ 1 ✓ Plan       complete  · session …      │ │
│ └──────────────────────────────────────┘  │ 2 ✓ Add rotation complete · session a1b2 │ │
│ ┌─ Human action / follow-up ──────────────┐│ 3 ◷ Wire UI    draft                      │ │
│ │ thread of asks/answers, decisions, notes ││  (redelivery indicator if pending)        │ │
│ └──────────────────────────────────────────┘└──────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Sections

### Delivery summary
- The `deliveries.summary` rendered as markdown — a **narrative**, not a command
  log (the protocol requires this). Shown at the very top of the review state.
- Header line: delivering agent/model, the objective delivered, the session (or
  "recorded work — no session" for `record-work` deliveries), and time.
- **Follow-up deliveries do not replace prior ones**: a delivery history selector
  lets the reviewer page through prior deliveries; the latest is shown by default.

### File evidence
- The core review affordance starts from `changed_files`, so every mechanically
  observed objective/path row stays visible with source, quality, overlap, and
  bounded hook health.
- A `change_rationale` can optionally add `label`, `summary`, `why`, and `impact`.
  Missing prose is neutral review metadata and never blocks delivery.
- File ownership is never inferred from Git status or a shared checkout. There is
  no unassigned-workspace bucket, rationale skip, or worktree-wide delta.

### Artifacts
- Grouped by `artifacts.type`: `test_results`, `next_steps`, `note`, `url`,
  `decision`, `migration`. Each `ArtifactCard` shows `label` + `content`
  (markdown/code aware). `url` artifacts are links; `test_results` get a
  pass/fail-styled header. Large outputs are attachments, not inline artifacts —
  shown as downloadable objective attachments.

### Human action / follow-up
- The conversation surface for review: prior `ask`/answer pairs, `decision`s,
  `discussion_summary`s, and a composer to add a follow-up note. Ordinary
  discussion here **does not** reopen execution (it stays in review); only an
  explicit follow-up-work signal does (below).

### Objective completion history
- Which objective each delivery completed and via which session; a **redelivery
  indicator** when an objective is `pending_delivery` (follow-up execution happened
  after a prior delivery and needs redelivery).

---

## Review actions

| Action | Effect | Endpoint |
| --- | --- | --- |
| **Complete** | Mission `review → complete` | `PATCH /missions/:id` status (service-layer) |
| **Add follow-up objective** | Append a new objective for more work | `POST /protocol/add-objectives` |
| **Reopen / ask for changes** | Post a follow-up requesting changes; optionally begin follow-up work | `POST /protocol/update` (`discussion`) or `--begin-follow-up-work --follow-up-intent execution` |
| **Answer an ask** | Record human answer | `POST /protocol/update --event-type user_follow_up`/`decision` |
| **Approve next** | If a gated next objective is awaiting approval | doc 04 approval gate |

**Follow-up semantics the UI must respect:**

- A delivered mission stays in `review` during discussion. Notes, decisions, and
  clarifications do not move it back to `execute`.
- "Ask for changes that requires code work" is a deliberate, explicit transition:
  the UI calls the `begin-follow-up-work` signal, the objective becomes
  `pending_delivery`, and a follow-up delivery later returns it to `complete`.
- The UI presents these as two clearly different buttons ("Add a note / ask" vs
  "Reopen for changes") so a reviewer never accidentally reopens execution.

---

## Data + realtime

| Region | Read | Realtime |
| --- | --- | --- |
| Delivery summary + history | `GET /missions/:id/deliveries` → `['mission', id, 'deliveries']` | `delivery` insert/update → new delivery card; status badge |
| Artifacts | within deliveries payload | `artifact` deltas |
| File evidence | `GET /api/missions/:id/file-changes` (`changed_files` first, optional rationale join) | `changed_file`/`change_rationale` deltas refresh the file list |
| Follow-up thread | `GET /missions/:id/events` | `mission_event` deltas (`ask`, `decision`, `user_follow_up`) |
| Objective history | `['mission', id]` | `objective` deltas (incl. `pending_delivery`) |

Because the list reads durable `changed_files`, a reviewer watching a follow-up
session sees accepted ledger observations and optional annotations update without
reconstructing state from the worktree.

---

## States

- **Not yet delivered:** if opened on a non-`review` mission, show "No delivery yet"
  with the current objective/session status and a link back to detail.
- **No rationale:** the observed path remains visible with a neutral explanation;
  the reviewer may request prose, but delivery remains complete.
- **`record-work` delivery:** clearly labeled "recorded from chat — no live
  session"; session attribution is null.
- **Pending redelivery:** banner that the latest follow-up work hasn't been
  re-delivered yet.
- **Multiple deliveries:** history pager; default to latest; never destroy prior
  delivery records.

---

## Capability gating

- Review actions gated by RBAC (`mission:update`, `objective:submit`) when Group 1
  is installed.
- Actor attribution on follow-up events shows real users only when Group 1 is
  installed; otherwise the implicit user/agent.

---

## Acceptance criteria

- A delivered mission can be fully reviewed here — summary, artifacts, observed
  file paths with optional annotations, and follow-up actions — without opening
  the agent chat.
- Each path exposes its objective-ledger attribution and remains visible without a
  rationale.
- Artifacts are grouped by type and visually distinct from objective attachments.
- Ordinary review discussion keeps the mission in `review`; reopening for code work
  is an explicit, separately-labeled action that moves the objective to
  `pending_delivery`.
- Follow-up deliveries are added without destroying earlier delivery history, and a
  redelivery-needed state is visible.
- Completing the mission moves it to `complete` via the service layer.
</content>
