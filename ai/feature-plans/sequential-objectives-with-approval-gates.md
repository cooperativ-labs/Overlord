# Sequential Objective Execution with Manual Approval Gates

**Ticket:** 1:1089
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-16
**Status:** Design report — revised 2026-05-16 (per-objective toggle; no ticket-level setting; reuse waiting-response badge)

---

## 1. Problem Statement

Users want to queue **ordered future objectives** on a single ticket and have them
execute **sequentially and automatically** as each predecessor completes. Two
constraints make this non-trivial:

1. Some steps cannot start until a human has reviewed or supplied something
   (creds, design feedback, an out-of-band action). The system needs an
   **approval gate** that pauses the chain.
2. We cannot rely on the agent being smart enough to "remember" to pause or to
   trigger the next step. Many agents are small/cheap; some can't reason about
   their own queue.

The design must therefore put the **scheduler in the platform**, not in the agent,
and reduce the agent's contract to the absolute minimum number of explicit
signals.

---

## 2. Current State (as of 2026-05-16)

We already have most of the substrate:

- `objectives` table with states: `draft | future | submitted | executing | complete`.
- One `draft` per ticket (`objectives_one_draft_per_ticket_idx`).
- Multiple `future` rows per ticket, ordered by `position` (drag/drop) then
  `created_at` (migration `20260516130000_add_position_to_objectives.sql`).
- `markSubmittedObjectiveExecuting` (in `lib/objectives.ts`) already
  **promotes the earliest `future` to `draft` when execution begins** — so the
  "next-up" promotion is half-built.
- `deliver` (in `apps/web/app/api/protocol/deliver/route.ts`) sets the
  executing objective to `complete`, moves the ticket to **review**, and
  detaches the agent session. **It does not currently start the next objective.**

So the missing pieces are:

- A deterministic **post-deliver auto-advance**, scoped per-ticket, that picks
  up the next queued objective and relaunches the agent.
- An **agent-controllable gate** that can stop that auto-advance for a specific
  next step.
- UI affordances to set / clear that gate at queue time and at runtime.

---

## 3. Design Principles

Before proposing a workflow, these are the principles I think the design should
hold to:

1. **The platform schedules; the agent acts.** The agent's only responsibility
   is the current objective. Whether the next one runs is decided by Overlord
   based on row state, not by the agent remembering to "do the next thing."
2. **Gates are data, not behavior.** A pause is a boolean on the *next* objective
   row, not a chat instruction. If the row says "wait for human," no agent will
   start it — regardless of which agent or how dumb it is.
3. **The default is the safe default.** Users who don't think about gates at
   all should still get a system that doesn't surprise them. **Auto-advance is
   a per-objective toggle, not a per-ticket setting.** Each future objective
   carries its own `auto_advance` boolean. When OFF, the objective is promoted
   to draft when its turn comes but does **not** automatically execute — the
   chain pauses there. When ON, the agent is relaunched immediately after the
   previous objective delivers. This gives users fine-grained control without
   forcing a global decision on every ticket.
4. **One verb for the agent.** The agent contract collapses to a single new
   primitive: a way to mark the *next* objective as "requires human." Everything
   else falls out from that.
5. **Reversible by humans at every step.** A human can always: pause a queue,
   resume it, reorder it, skip an objective, or convert any "auto" objective
   into "requires human" — even mid-flight.

---

## 4. Recommended Workflow (the "most natural" one)

### 4.1 Mental model: a playlist with per-track autoplay

The cleanest analogue is a media playlist where each **track has its own
autoplay flag**. Tracks play in order; turning autoplay off on a given track
makes the playlist pause once that track becomes "up next." Users already
understand this from media controls. It maps cleanly onto our data:

- A queue of `future` objectives on one ticket = the playlist.
- Each `future` row has its own `auto_advance` boolean (default TRUE).
  - **TRUE** → when this row becomes next-up, it is promoted to draft,
    submitted, and the agent is relaunched automatically.
  - **FALSE** → when this row becomes next-up, it is promoted to draft and
    the ticket fires an "awaiting approval" signal. The agent does **not**
    relaunch until a human acts.
- There is **no ticket-level setting**. The whole queue's behavior is the sum
  of its per-objective toggles.

### 4.2 The end-to-end flow

```
[User queues N future objectives, toggles auto_advance per row as desired]
[User starts the ticket → first objective executes]
       │
       ▼
Agent works → deliver()
       │
       ▼
Platform marks executing objective complete.
       │
       ▼
Platform looks at next future row.
   ├── No more future rows? → Ticket → review. Done.
   ├── Next row auto_advance=true?
   │       → Promote to draft, mark submitted, relaunch agent on
   │         the same ticket in a fresh session.
   └── Next row auto_advance=false?
           → Promote to draft (it becomes the current editable
             draft objective). Set `has_unopened_waiting_response=true`
             on the ticket so the existing red badge fires.
             Send a push notification. STOP — agent is not relaunched.
```

The ticket **does not get a new status**. It stays in whatever execution
status it was in (typically `execute`), but the existing
`has_unopened_waiting_response` flag is flipped on — the same signal used
today when an agent calls `ask`. This means:

- Kanban board renders the same red badge as a blocking question (no kanban
  changes needed).
- Push notification path is the same one used for `ask`.
- The "awaiting approval" UI lives inline on the ticket detail page (see §9),
  rendered above the freshly-promoted draft objective.

### 4.3 What "approve & continue" does

A single button rendered in the awaiting-approval banner above the draft
objective. It:

1. Clears `has_unopened_waiting_response` on the ticket.
2. Submits the (already-promoted) draft objective and launches the agent —
   same code path the user already uses today to start a ticket.

This means **the approval gate reuses the existing "start work" mechanism**.
We aren't building a parallel runtime. The user is free to edit the draft
objective's text before approving — the draft is just a regular draft.

### 4.4 Failure cases

- **Agent calls `ask`** (blocked on question): existing behavior. Auto-advance
  is paused naturally because there's no deliver event. The agent's
  question-induced red badge and the awaiting-approval red badge share a
  rendering path, so the UI is consistent.
- **Agent delivers but the work failed**: same as today — ticket goes to
  review, *but* if the next row is `auto_advance=true` it will start. To
  prevent this, the agent should call `ask` instead of `deliver` when it knows
  the work didn't succeed. We should add explicit prompt guidance for this.
- **User wants to halt mid-chain**: flip the next future row's `auto_advance`
  to OFF (or set the next *several* rows to OFF). The currently-executing
  objective continues; the chain stops at the first OFF row.

---

## 5. Flexibility — Scenarios to Validate

The above shape needs to support a wide range of user intents. A sample:

| Scenario | How the model handles it |
|---|---|
| "Run 5 refactors back-to-back overnight" | All 5 future rows `auto_advance=ON`. Wakes you up only if something fails. |
| "Implement, then run tests, then deploy — pause before deploy" | Three future rows. First two `auto_advance=ON`, the deploy row `auto_advance=OFF`. Chain auto-runs until the deploy gate. |
| "Implement A, then I'll review the PR, then implement B" | Two future rows, both `auto_advance=OFF`. User approves each manually. |
| "Try approach X; if it doesn't work, try Y" | Two future rows. The second is `auto_advance=OFF` so the user can read X's deliver before deciding whether to approve Y or edit it. |
| "Do this thing, but stop and ask if you find ambiguity" | Single objective; agent uses existing `ask` when blocked. No queue needed. |
| "Run the same task on N targets" | N future rows (one per target). All `auto_advance=ON`. |
| "Refactor, then have a different agent do the test pass" | Each future row already has its own `assigned_agent`. Auto-advance respects per-objective agent assignment. |
| "Build a multi-stage research report" | Long queue. Selected steps `auto_advance=OFF` for human review of intermediate output. |

The key insight: **the model has only one knob** — per-objective
`auto_advance` — and it covers the whole space. Don't add more.

---

## 6. Reducing Reliance on Agent Intelligence

This is the most important section. The design must work with a $0.05 model.

### 6.1 What the agent absolutely cannot be trusted to do

- Remember a queue exists.
- Decide whether the next objective is safe to auto-run.
- "Pause the next ticket" via free-form text.
- Maintain state between sessions.

### 6.2 What the agent must be trusted to do

Exactly one new behavior, plus existing behaviors:

- **New:** Call a single protocol verb when the *next* objective looks unsafe
  to auto-run. Proposed name: `request_approval_gate`. Its effect is to flip
  the next future row's `auto_advance` from TRUE to FALSE.
- **Existing:** Call `deliver` when done. Call `ask` when blocked.

That's it. If the agent never calls `request_approval_gate`, the only
consequence is the next objective runs according to whatever `auto_advance`
the user set on it. Nothing breaks.

### 6.3 The platform fills the gaps

Because the platform sees the full queue, it can:

- Insert a forced approval gate if more than X objectives have run without
  human intervention (configurable: "review every N steps").
- Insert a forced approval gate if a deliver's change rationales touch
  high-risk paths (configurable: globs like `supabase/migrations/**`,
  `package.json`, `.github/workflows/**`).
- Auto-pause if the agent has called `ask` in this ticket in the last K minutes.

This way, even a dumb agent that never pauses produces a safe workflow because
the **platform itself enforces gates** based on observable signals.

### 6.4 Pre-declared gates beat agent-declared gates

Users authoring the queue can already see which steps are risky; *they* should
mark them at queue time. Agent-declared gates are a backstop, not the primary
mechanism. UI should make this trivial — a small lock icon on each future row
that toggles `requires_approval`.

---

## 7. Agent-Facing Contract

### 7.1 Prompt copy (shortest possible)

When the executing ticket has more queued objectives, append exactly this to
the agent prompt (after the existing Objective IDs section). The next future
objective's text and `auto_advance` value should be inlined so the agent can
reason about it concretely:

```markdown
### Queued follow-up objectives

After you deliver, the platform may automatically launch the next objective
listed above (in order) on this same ticket. Whether it auto-launches depends
on a per-objective `auto_advance` flag set by the user — it is shown next to
each Objective ID above. You do NOT need to do anything to trigger the next
one.

If — and ONLY if — the next objective is marked `auto_advance=true` but
SHOULD NOT run without human review (because your current work surfaced a
question, a risk, or a decision a human must make first), call:

ovld protocol request-approval-gate --session-key <sessionKey> --ticket-id <id> --reason "..."

This flips the next objective's `auto_advance` to false so a human must
approve it before it runs. Use sparingly — the default is to deliver and let
the queue continue.
```

That's ~150 words. Most agents can follow it. Critically:

- **Default behavior is do-nothing.** If the agent forgets everything, the
  queue still works according to the user's per-row choices.
- The verb name says exactly what it does.
- A single required argument (`reason`) gives humans context without ambiguity
  and is rendered verbatim in the awaiting-approval banner.

### 7.2 Protocol surface (one new verb)

Add to the protocol:

- `request-approval-gate` (CLI) / `request_approval_gate` (MCP)
- Inputs: `sessionKey`, `ticketId`, `reason`, optional `objectiveId` (defaults
  to the *next* future objective on this ticket, ordered by `position` then
  `created_at`).
- Effect: sets `auto_advance=false` on the target objective row and persists
  the `reason` on the row (new column `approval_reason` — see §8).
- Returns: which objective was gated, and its previous `auto_advance` value.

No new states for the agent to track. The verb is idempotent (gating an
already-gated objective just updates the reason).

### 7.3 Where the auto-advance lives

In `apps/web/app/api/protocol/deliver/route.ts`, in the `after()` block, after
marking the executing objective complete:

1. Look up the earliest `future` row on this ticket (order by `position`,
   then `created_at`).
2. **No future row?** Fall through to review status (current behavior).
3. **Next row `auto_advance=true`?** Promote to draft, mark submitted, mark
   executing, and trigger the same relaunch path used by the "start ticket"
   action. Keep the ticket in `execute` status — do not move it to review.
4. **Next row `auto_advance=false`?** Promote to draft, set
   `has_unopened_waiting_response=true` on the ticket, send a push
   notification, emit a `ticket_events` row of a new event type
   `awaiting_approval` carrying the agent's `reason` (if any). Keep the
   ticket in `execute` status; do not relaunch.

Crucially, the relaunch in step 3 should reuse `protocol-spawn.ts` or the
existing remote-agent launch pipeline — **do not invent a new launcher**.

---

## 8. Schema Changes

Minimal:

```sql
alter table public.objectives
  add column if not exists auto_advance boolean not null default true,
  add column if not exists approval_reason text,
  add column if not exists auto_advanced_at timestamptz;
```

- `auto_advance` — the per-row toggle. Default TRUE because the entire feature
  is "make queues run automatically"; a user who adds a queue without thinking
  about gates should still get sequential autonomy. Users (or the agent) opt
  out per row.
- `approval_reason` — populated by `request-approval-gate`. Rendered in the
  awaiting-approval banner so humans understand why the agent paused.
- `auto_advanced_at` — set by the deliver auto-advance path when the row was
  promoted *and* relaunched without human intervention. Used by the
  `ObjectiveCollapsibleItem` indicator (see §9) so completed objectives can
  show a small "auto-advanced" affordance distinguishing them from manually
  started ones.

**No new ticket status.** Awaiting-approval reuses the existing
`has_unopened_waiting_response` flag — the same boolean an `ask` event sets
today — which means the kanban red badge, list-view red dot, sort order, and
push notification path all just work without changes.

Add one new `ticket_events.event_type` value: `awaiting_approval`. Carries
`summary = reason` (or a default) and the gated objective ID in
`metadata`. Add a sibling `auto_advance` event type for telemetry when a row
auto-runs (useful for retros, optional for v1).

No new tables.

---

## 9. UI Affordances

Smallest set that makes the feature self-explanatory:

### 9.1 Future-objective rows (queue editor)

Each future objective row gets a small **auto-advance toggle** (an
unobtrusive switch or play-vs-pause icon button at the right edge of the row).

- ON (default) → tooltip: "Will run automatically after the previous objective
  delivers."
- OFF → tooltip: "Pauses the queue here — requires manual approval to run."
- The icon visually differs (e.g. play-circle vs pause-circle, or filled vs
  outlined) so a glance down the queue tells the user where the pauses are.

No ticket-level toggle. No new button on the ticket header.

### 9.2 Awaiting-approval banner (inline above the draft objective)

When the platform has promoted a `future` row to `draft` because its
`auto_advance` was FALSE, render an inline banner directly above the draft
objective in the ticket detail panel. Contents:

- Title: "Waiting for your approval to continue."
- Body: the `approval_reason` (if the agent supplied one), otherwise a generic
  "This objective is queued for your review."
- Buttons: **Approve & run** (primary) and **Edit objective first** (ghost —
  focuses the draft editor and dismisses the banner).
- Same visual treatment / color as the existing blocking-question banner so
  the affordance is familiar.

Clicking "Approve & run" clears `has_unopened_waiting_response`, submits the
draft, and launches the agent — i.e. it reuses the existing "start ticket"
path.

### 9.3 ObjectiveCollapsibleItem (history view of completed objectives)

Modify `apps/web/components/features/ObjectiveCollapsibleItem.tsx` so a
completed objective can indicate it was started by the auto-advance scheduler
rather than by a human.

- The collapsible trigger today renders a single horizontal row: status icon,
  agent icon, title, chevron. The auto-advance indicator needs a second line
  of metadata.
- Restructure the trigger to a two-row layout when there is metadata worth
  showing beyond the title:
  - **Row 1:** status icon · agent icon · title · chevron (existing).
  - **Row 2 (only when relevant):** small inline badge "Auto-advanced" with a
    fast-forward icon, plus the timestamp the platform already shows in the
    tooltip. Keep this row at `text-[11px] text-muted-foreground` so it
    doesn't compete with the title.
- The badge is only rendered when `objective.auto_advanced_at` is set.
- The two-row variant should also be the place to surface other passive
  context in future (e.g. queue position when it ran). For v1, only
  `Auto-advanced` is added.

This requires extending the `ObjectiveRow` `Pick<...>` to include
`auto_advanced_at`, and threading it from the parent objectives query.

### 9.4 Kanban board

**No changes.** The existing `has_unopened_waiting_response` flag already
fires the red badge — that is the entire signal we need.

### 9.5 Notifications

Reuse the same push-notification path that today fires for `ask` events. The
deliver auto-advance branch (§7.3 step 4) calls `sendPushNotification` with:

- Title: `Awaiting approval (${ticketReference})`
- Body: `approval_reason` (truncated) or "Queued objective is waiting for
  your approval."

No new notification channel; users who have ask-event notifications enabled
get awaiting-approval notifications for free.

---

## 10. Other Ideas / Considerations

A grab-bag of things that came up while thinking through this:

- **Stop-the-line policy.** If any objective in a chain ends in `blocked` (via
  `ask`) or fails verification, the chain should pause regardless of
  auto-advance setting. Resuming is an explicit user action.
- **Per-objective timeouts.** A queued objective could have a max-wall-clock;
  if exceeded, the agent is detached and the chain pauses. Not for v1, but the
  schema (`objectives.timeout_seconds`) should allow it.
- **Change-rationale-based gating.** Mentioned above: if an agent's deliver
  touches sensitive paths (migrations, infra, secrets), the platform inserts
  an automatic gate. This is the highest-leverage safety net because it works
  without any agent cooperation at all.
- **Multi-agent chains.** Each future row already carries `assigned_agent`.
  Auto-advance must honor this — relaunch with the assigned agent, not the
  agent that just delivered. Already supported by the data model.
- **Branching / conditionals.** Tempting, but resist. Conditional execution
  ("if X, do A else B") is much better handled by: agent delivers + posts a
  followup ticket if needed, OR user reviews and reorders the queue manually.
  Trying to encode conditions in the queue grows the surface area enormously
  and undermines principle (2) — keeping gates as data.
- **History/audit.** The agent's `reason` for any auto-inserted approval gate
  should appear on the objective row and in the ticket feed. This makes
  retrospectives easy: "why did we pause here?"
- **Estimation / cost preview.** When a user toggles auto-advance ON for a
  ticket with 5 queued objectives, show a quick estimated-cost preview based
  on the assigned agents. Sequential auto-execution can be expensive; users
  should see the bill before they sign up.
- **Idempotency of relaunch.** The relaunch path must be safe to call twice
  (e.g., if a webhook retries). Easiest: only relaunch if no `agent_sessions`
  row is in `attached` state for this ticket.
- **Realtime UI.** The `awaiting-approval` ticket state should fire a feed
  post and a push notification — same code path as deliver-to-review. Users
  doing other things should hear about it.
- **Cancel cascading.** If a user cancels a chain mid-way (e.g., flips
  auto-advance OFF after objective 3 of 5), the remaining `future` rows stay
  as-is. They can be reordered, edited, or re-armed later. Don't delete them.
- **"Run all" shortcut.** Power-user affordance: a "Run remaining objectives"
  button on the ticket that turns auto-advance ON, clears all
  `requires_approval` flags, and starts the next objective. One click,
  full-trust mode.

---

## 11. Implementation Order (rough)

1. **Schema**: add `objectives.auto_advance` (default TRUE),
   `objectives.approval_reason`, `objectives.auto_advanced_at`. Add
   `ticket_events.event_type = 'awaiting_approval'` (and optional
   `auto_advance` for telemetry).
2. **Auto-advance in deliver**: extend `apps/web/app/api/protocol/deliver/route.ts`
   `after()` block per §7.3. Promote + relaunch when `auto_advance=true`;
   promote-only + set `has_unopened_waiting_response=true` + push when
   `auto_advance=false`.
3. **Approval gate verb**: add `request-approval-gate` CLI/MCP/route, wire
   into agent plugin docs and the `overlord-ticket` skill copy.
4. **Prompt updates**: extend `lib/overlord/ticket-prompt.ts` to inline each
   future objective's `auto_advance` value next to its Objective ID, and
   append the queue + gate language from §7.1 when ≥1 future row exists.
5. **UI — queue editor**: per-row auto-advance toggle on each future
   objective row.
6. **UI — awaiting-approval banner**: inline banner above the draft objective
   with Approve & run / Edit-first buttons. Reuse the visual style of the
   blocking-question banner.
7. **UI — `ObjectiveCollapsibleItem`**: two-row trigger when
   `auto_advanced_at` is set; show "Auto-advanced" badge with fast-forward
   icon.
8. **Safety nets**: high-risk-path auto-gating (migrations, workflows, etc.).
9. **Polish**: cost preview, telemetry events for auto-advance.

---

## 12. Summary

The cleanest design treats sequential execution as a **platform-side scheduler
over an opt-in queue**, with gates as **data on rows** (not behavior in agent
heads). The agent contract grows by exactly **one verb**
(`request-approval-gate`) whose default — "don't call it" — produces the safe
behavior users opted into. The platform fills in the safety net via observable
signals (high-risk paths, `ask` calls, configurable review cadence) so even
unintelligent agents produce intelligent workflows.

Three new columns on `objectives` (`auto_advance`, `approval_reason`,
`auto_advanced_at`), **no new ticket status** (awaiting-approval reuses the
existing `has_unopened_waiting_response` red-badge mechanism), one new
event type, one new agent verb, and a roughly 150-word prompt addendum are
all that's needed for a complete v1. No ticket-level toggle, no kanban
changes.
