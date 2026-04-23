# Overlord Slack App — Feature Plan

## Goal

Let a user install a single Overlord Slack app into any workspace they belong to, mention `@overlord` on any message, and have that message become a ticket in their Overlord account. Default project and incoming-status are user-configurable.

## Primary Use Case

Jake (or any Overlord user) is a guest/member in several client Slack workspaces. When a client posts a feature request or bug, Jake wants to forward it into Overlord as a ticket with one action — ideally without copy/paste, and without leaving Slack.

---

## UX Flow

### 1. Install

- A single "Add to Slack" button in Overlord settings → `Integrations → Slack`.
- OAuth v2 install flow. Slack app is **distributed** (publicly installable) so any workspace admin (or, where allowed, any member) can add it.
- On callback, we store the workspace's bot token + team metadata keyed to the **Overlord user who initiated the install**. That user becomes the "owner" of that workspace connection.
- The same Overlord user can install into N workspaces. Each install is a separate row.

### 2. Mention to create a ticket

Three supported surfaces:

1. **New message with mention**: `@overlord please build a CSV export for the billing page` → ticket is created with that text as the objective.
2. **Reply in a thread with mention**: `@overlord turn this into a ticket` inside a thread → ticket is created using the **parent thread message** as the objective (plus a note linking the triggering reply). Rationale: in practice the client's original message is what matters; Jake's reply just flags it.
3. **Message shortcut**: "Create Overlord ticket" message action (the three-dot menu on any message). No mention needed. Useful when Jake wants to capture a message from a channel the bot isn't in, or silently.

After creation, the bot replies (ephemerally to Jake if possible, else threaded) with:
- The ticket title / ID
- A deep link (`overlord://ticket/<id>` + web URL)
- Inline buttons: **Edit objective**, **Change project**, **Change status**, **Open in Overlord**

### 3. Redescribe / edit inline

Clicking **Edit objective** opens a Slack modal pre-filled with the captured text so Jake can rewrite it before it lands with the agent. Common case: the client's message is vague and Jake wants to rephrase as a proper ask. Modal also exposes project + status selectors.

### 4. Attribution

Because Overlord is a single-user-per-workspace tool (from the Slack side), only Jake's mentions create tickets. Anyone else mentioning `@overlord` gets an ephemeral reply: _"Only @Jake can create tickets from this workspace."_ This prevents random channel members from spamming his board and keeps the mental model simple for v1.

(Future: a workspace could be "shared" and route to a team Overlord account — out of scope.)

---

## Configuration

Settings page at `/settings/integrations/slack` (or within the existing integrations list) per connected workspace:

| Setting | Values |
|---|---|
| Default project | any project the user owns, or "(no project / inbox)" |
| Default status | any `ticket_status` (enum or custom column) — default `next-up` |
| Default priority | low / medium / high — default `medium` |
| Default execution_target | `agent` / `human` — default `human` (Slack captures are usually to triage, not auto-run) |
| Include Slack context | bool — whether to embed permalink, channel, author, and thread transcript in ticket `context` field |
| Restrict to user's own mentions | bool (default true) |

Per-workspace overrides so Jake can route **Acme workspace → Acme project** and **Beta workspace → Beta project**.

---

## Architecture

### Slack app configuration

- **Scopes (bot token)**: `app_mentions:read`, `chat:write`, `commands`, `channels:history` (optional, only needed to fetch the parent of a thread reply; scoped as narrowly as possible), `groups:history`, `im:history`, `mpim:history`, `users:read` (for author name resolution), `reactions:read` + `reactions:write` (for optional reactji trigger).
- **Events subscribed**: `app_mention`, `message.channels` (disabled unless reactji trigger is enabled), `message.im` (for DMing the bot to create tickets).
- **Interactivity**: enabled for buttons + modals + message shortcuts.
- **Slash command**: `/overlord <objective>` as an alternate to mentions.
- **Event delivery**: HTTP request URL pointing at our webhook endpoint (Slack prefers sub-3s ack). Prefer **Events API over HTTP**, not Socket Mode — we already have a web app so HTTP is simpler to operate.

### Webhook endpoint

A new Supabase Edge Function at `supabase/functions/slack-events/index.ts` handling:

1. `url_verification` challenge
2. Request signing verification via `x-slack-signature` + `x-slack-request-timestamp` (HMAC-SHA256 with signing secret; reject if timestamp skew > 5 min — replay protection).
3. **Immediate 200 ack** (< 2s), then enqueue processing. Use `EdgeRuntime.waitUntil()` or push a job row and process it from a separate invocation to stay under Slack's 3s budget.
4. Dispatch by `type`/`event.type`:
   - `event_callback` → `app_mention` / `message` / `reaction_added`
   - `interactive` (block_actions, view_submission, message_action)
   - `slash_commands`

Edge function is preferred over a Next.js API route because:
- Slack retries aggressively; edge functions have predictable cold-start behavior.
- Signing secret lives in Supabase secrets, not `NEXT_PUBLIC_*`.
- Matches existing patterns (`supabase/functions/mcp`, `send-push-notification`).

A thin Next.js route at `/api/integrations/slack/oauth/callback` still handles the OAuth redirect because it needs the authenticated Overlord session to bind the install to the user.

### Data model

One new table plus reuse of `user_integrations`.

```sql
create table "public"."slack_workspaces" (
  "id"              uuid primary key default gen_random_uuid(),
  "user_id"         uuid not null references auth.users(id) on delete cascade,
  "organization_id" integer not null,
  "team_id"         text not null,        -- slack team ID (T0123…)
  "team_name"       text not null,
  "bot_user_id"     text not null,        -- the @overlord user id in that workspace
  "bot_access_token" text not null,       -- xoxb-… — encrypted at rest via pgsodium or stored in vault
  "slack_user_id"   text not null,        -- the installer's slack user id, so we know "Jake in this workspace"
  "default_project_id" uuid references projects(id) on delete set null,
  "default_status"  text not null default 'next-up',
  "default_priority" text not null default 'medium',
  "default_execution_target" public.ticket_execution_target not null default 'agent',
  "include_context" boolean not null default true,
  "restrict_to_owner" boolean not null default true,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique(user_id, team_id)
);
```

- RLS: `user_id = auth.uid()` for select/update/delete. Inserts via service role from the OAuth callback.
- Token storage: do **not** store `bot_access_token` in plaintext. Use Supabase Vault (`vault.secrets`) or pgsodium column encryption. The column above is illustrative; real migration should reference a vault secret id.
- We keep `user_integrations` untouched — it's API-key-shaped and the slack install carries enough shape of its own that a dedicated table is cleaner.

Also add an idempotency table to dedupe Slack retries:

```sql
create table "public"."slack_event_dedupe" (
  "event_id" text primary key,
  "received_at" timestamptz not null default now()
);
-- TTL cleanup via cron: delete where received_at < now() - interval '1 day'
```

### Ticket creation

- Reuse `createBlankTicketAction` + `updateTicketFieldAction` patterns, or add `createTicketFromSlackAction(payload)` in `lib/actions/tickets.ts` that wraps the existing primitives. The action runs as the owning user via a service-role supabase client scoped to `user_id` derived from the slack workspace row.
- Set `context` to a structured block containing: Slack permalink, channel name, original author display name, posted-at ts, and (if opted in) the last N messages of the thread for context. This is invaluable when the agent later works the ticket.
- Set `objective` to the triggering message (or user-edited modal text).
- Set `project_id`, `status`, `priority`, `execution_target` from workspace config.
- Tag the ticket with source metadata so UI can render a Slack badge — either a new `source` enum column (`slack|web|calendar|api`) or a row in an existing audit table. Recommend the column; it's cheap and unlocks filtering.

### Interactive flow (post-creation)

Bot posts an ephemeral message (visible only to the installer) with block_actions buttons:

- **Edit objective** → opens `view.open` modal → `view_submission` → `updateTicketFieldAction`.
- **Change project** → opens modal with project select (data sourced via `external_select` hitting a tiny `/api/integrations/slack/options` endpoint that returns the user's projects).
- **Change status** → same pattern using the user's `ticket_statuses`.
- **Open in Overlord** → static URL button.

---

## Suggested Additional Features

Ranked roughly by value-to-effort for Jake's stated workflow:

1. **Reaction-based capture** — add a 🎯 or 📥 reaction to any message and the bot files it as a ticket, no mention required. This is the lowest-friction capture mechanism and works in channels where the bot hasn't been explicitly added (provided `reactions:read` + `channels:history` are granted and the bot is in the channel). Works great when a client pings you in a thread you don't want to reply to publicly.
2. **DM-to-inbox** — DMing the Overlord bot creates a ticket silently (no workspace visibility). Useful for private notes-to-self. Already comes nearly free with `message.im`.
3. **Thread follow-ups → ticket comments** — after the initial ticket is created, replies in the thread tagged `@overlord` (or reacted with a follow-up emoji) append to the ticket's `context` or a comments feed. Closes the loop so further client clarification isn't lost.
4. **Channel-scoped project defaults** — per-channel override on top of per-workspace ("messages from #acme-urgent default to project Acme + priority high"). Small UI cost, big quality-of-life for busy workspaces.
5. **Back-channel status updates** — when a ticket created from Slack transitions to `done` (or any user-chosen status), bot posts a threaded reply in the original Slack thread: "✅ Shipped — here's the PR." Keeps the client loop closed. Guard behind a per-workspace toggle; some client channels you don't want Overlord posting into.
6. **Slash command `/overlord <text>`** — alternate to mention; useful in channels where the bot isn't invited (slash commands work globally).
7. **"Create from last message" shortcut** — global shortcut (cmd-K in Slack) so Jake doesn't need the message visible.
8. **File attachment forwarding** — if the source message has files (screenshots, PDFs), upload them to the ticket as artifacts via existing `artifact-upload-file` protocol. High value because clients almost always attach screenshots.
9. **Multi-message selection** — message shortcut on a thread captures the **whole thread** as the objective + context, not just one message. Useful when the request is spread across 5 replies.
10. **AI-assisted title/objective rewrite** — when capturing, optionally run the raw Slack text through a small rewriting prompt (existing Anthropic client) to produce a cleaner objective + a one-line title. Offered as a modal button "Rewrite" before submitting, not automatic — you still want human control.
11. **Mention another agent** — `@overlord --cursor` or `@overlord --execute` flags to directly set `assigned_agent` or status=`execute`. Power-user; defer.
12. **Signed deep-link previews** — when an Overlord ticket URL is pasted into Slack, unfurl with title / status / assigned agent. Uses `links.unfurl`. Nice polish, non-essential.

---

## Implementation Plan (phased)

### Phase 1 — MVP (end-to-end capture)
1. Slack app manifest + distribution config (single app in Slack's marketplace, not per-workspace).
2. OAuth install + `/api/integrations/slack/oauth/callback` route binding install to current Overlord user.
3. Migration: `slack_workspaces`, `slack_event_dedupe`, optional `tickets.source` column.
4. Supabase Edge Function `slack-events` with signature verification, dedupe, and `app_mention` handler only.
5. `createTicketFromSlackAction` helper.
6. Settings UI page: list connected workspaces, per-workspace defaults form, disconnect button.
7. Ephemeral ack message with the ticket link (no buttons yet).

### Phase 2 — Interactivity
8. Message shortcut "Create Overlord ticket".
9. Edit-objective / change-project / change-status modals.
10. Project + status `external_select` endpoint.

### Phase 3 — Power features
11. Reaction-based capture.
12. File attachment forwarding.
13. Back-channel status updates on ticket completion.
14. Channel-scoped overrides.

### Phase 4 — Polish
15. Link unfurls.
16. AI rewrite modal.
17. Slack app store listing copy + screenshots.

---

## Open Questions For Jake

1. Is this single-user-per-workspace (just you) forever, or do you anticipate wanting a per-org Overlord account that multiple teammates' Slack mentions feed into? Affects data model now vs. later migration pain.
2. Should the bot's ephemeral ack be visible to the **whole thread** (so clients know you captured their request) or **only to you**? Two very different product stances.
3. Do you want incoming Slack tickets to auto-appear in a "Slack Inbox" view, or just land in the chosen default project unmarked?
4. Distribute on the Slack marketplace (review process, ~2 weeks), or leave it as an unlisted distributed app that you share install links for? Marketplace is only worth it if others will install.
