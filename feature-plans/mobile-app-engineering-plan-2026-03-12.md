# Overlord Mobile App — Engineering Plan

**Date:** 2026-03-12
**Ticket:** ee10f2b5-3086-4c9f-a35d-e27285952fe9
**Author:** AI Engineering Agent

---

## Overview

This plan outlines the engineering approach for an Overlord **React Native companion app** that acts as a lightweight partner to the desktop/web app. The mobile app focuses on three core workflows:

1. **Create and edit tickets** — draft new work items and update existing ones on the go
2. **Monitor updates and notifications** — see real-time agent progress, questions, and deliveries
3. **Send prompts to agents** — one-tap copy of contextual prompts to clipboard, ready to paste into any agent tool

The mobile app is explicitly **not** a full replacement for the desktop app. It does not run agents, manage infrastructure, or handle code review diffs. It is a field companion for when users are away from their workstation.

---

## Goals & Non-Goals

### Goals
- Monitor all tickets across projects with real-time updates
- Create and edit ticket titles, objectives, context, constraints, and acceptance criteria
- Receive push notifications for agent questions, deliveries, and status changes
- Copy agent prompts to clipboard from the ticket detail screen
- Answer blocking questions from agents without opening the desktop app
- Quick status transitions (e.g. approve a delivery → mark complete)
- Support deep-link routing from push notifications → correct ticket
- Offline-friendly: show last-known state when connectivity is poor

### Non-Goals
- Running embedded terminals or local agent processes
- Rendering rich code diffs or change rationales in full detail
- Full project/organization management (create orgs, manage members, billing)
- Everhour time tracking controls (these remain on the desktop)
- Electron-specific features

---

## Technical Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **React Native + Expo SDK 52** | Managed workflow, OTA updates, strong Supabase support |
| Navigation | **Expo Router (file-based)** | Mirrors Next.js App Router conventions used in the web app |
| State | **React Query (TanStack Query)** | Consistent with REST-based data fetching; good offline support |
| Real-time | **Supabase Realtime JS client** | Same library already used in the web app |
| Auth | **Supabase Auth + Expo Secure Store** | Reuse existing auth infrastructure; safe token storage |
| UI | **React Native Paper + custom components** | Material 3 tokens; consistent feel without shadcn overhead |
| Push Notifications | **Expo Notifications + Supabase Edge Function** | Lightweight; pairs with existing edge function pattern |
| Forms | **React Hook Form + Zod** | Same schemas as the web app; share validation logic |
| HTTP | **Native `fetch` + Supabase JS client** | No additional HTTP layer needed |
| Storage | **Expo SecureStore** (tokens) + **AsyncStorage** (non-sensitive) | Per Expo security recommendations |
| CI/CD | **EAS Build + EAS Update** | OTA updates without App Store review for non-native changes |
| Error Tracking | **Sentry React Native** | Consistent with existing Sentry setup |

---

## Architecture

```
overlord-mobile/          # separate repo or apps/mobile monorepo package
├── app/                  # Expo Router pages (file-based routing)
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── confirm-email.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Tab bar: Inbox, Tickets, Projects, Account
│   │   ├── inbox/
│   │   │   └── index.tsx         # Notification feed
│   │   ├── tickets/
│   │   │   ├── index.tsx         # All tickets list
│   │   │   └── [ticketId]/
│   │   │       ├── index.tsx     # Ticket detail + event timeline
│   │   │       └── edit.tsx      # Edit ticket fields
│   │   ├── projects/
│   │   │   ├── index.tsx         # Project list
│   │   │   └── [projectId]/
│   │   │       └── index.tsx     # Project ticket list
│   │   └── account/
│   │       └── index.tsx         # Profile, tokens, notification prefs
│   └── _layout.tsx               # Root layout with auth guard
├── components/
│   ├── tickets/
│   │   ├── TicketCard.tsx        # List item card
│   │   ├── TicketStatusBadge.tsx
│   │   ├── TicketPriorityBadge.tsx
│   │   ├── EventTimeline.tsx     # Scrollable event log
│   │   ├── EventItem.tsx         # Per-event renderer
│   │   ├── AgentPromptCopy.tsx   # "Copy Prompt" action sheet
│   │   ├── QuestionAnswer.tsx    # Inline Q&A for blocking questions
│   │   └── ArtifactCard.tsx      # Deliverable summary card
│   ├── forms/
│   │   ├── TicketForm.tsx        # Create/edit form
│   │   └── AnswerForm.tsx        # Answer blocking question
│   └── ui/
│       ├── LoadingState.tsx
│       ├── EmptyState.tsx
│       ├── PushHandler.tsx       # Notification registration + routing
│       └── OfflineBanner.tsx
├── lib/
│   ├── supabase.ts               # Supabase client singleton
│   ├── auth.ts                   # Auth helpers
│   ├── queries/                  # React Query hooks
│   │   ├── tickets.ts
│   │   ├── events.ts
│   │   ├── projects.ts
│   │   └── notifications.ts
│   ├── mutations/                # React Query mutations
│   │   ├── tickets.ts
│   │   └── answers.ts
│   ├── prompt.ts                 # Shared prompt-building logic (port from web)
│   └── notifications.ts         # Push token registration
├── types/                        # Shared types (copy/symlink from web if monorepo)
│   └── database.types.ts
└── eas.json                      # EAS Build configuration
```

---

## Core Feature Flows

### 1. Authentication

**Flow:**
1. App opens → check SecureStore for Supabase session token
2. If no token → navigate to `/login`
3. Login screen uses `supabase.auth.signInWithPassword()`
4. On success → store session, navigate to `/(tabs)/tickets`
5. Token refresh handled automatically by Supabase JS client
6. On session expiry → redirect to login

**No device-code flow needed initially** — email/password is sufficient for mobile. OAuth social login (Apple, Google) can be added in a later phase.

**Sign-out:** Clears SecureStore + calls `supabase.auth.signOut()`.

---

### 2. Ticket List & Search

**Screen: `/tickets`**

- Fetch all tickets for the current user's organization via Supabase query
- Group or filter by status (draft, execute, review, complete, blocked)
- Pull-to-refresh + infinite scroll (paginated, 25 per page)
- Search bar (filters on title and ticket_sequence locally; server search on trigger)
- Tap → navigate to ticket detail
- FAB button → navigate to create ticket form

**Key query:**
```sql
SELECT t.*, p.name as project_name, p.color as project_color
FROM tickets t
LEFT JOIN projects p ON t.project_id = p.id
WHERE t.organization_id = $org_id
ORDER BY t.board_position ASC
LIMIT 25 OFFSET $offset
```

---

### 3. Ticket Detail + Event Timeline

**Screen: `/tickets/[ticketId]`**

This is the most important screen. It shows:

- **Header**: Ticket title, status badge, priority, project name
- **Objective section**: Collapsible, shows full objective text
- **Timeline**: Chronological event list (updates, questions, answers, deliveries, artifacts)
- **Agent status strip**: Shows current agent session state + last heartbeat
- **Action bar** (bottom): Context-sensitive buttons

**Timeline event rendering by type:**
| Event Type | Display |
|---|---|
| `update` | Progress card with summary, phase chip, change rationale count |
| `question` | Question bubble with inline answer form (if blocking + unanswered) |
| `answer` | Reply bubble in answer thread |
| `deliver` | Delivery card with artifact list and "Approve" action |
| `artifact` | Artifact card (type icon + label + truncated content) |
| `status_change` | Status pill with from→to |
| `alert` | Warning card with level badge |
| `system` | Muted system message |

**Real-time updates:** Subscribe to `ticket_events` table changes via Supabase Realtime:
```javascript
supabase
  .channel(`ticket-${ticketId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'ticket_events',
    filter: `ticket_id=eq.${ticketId}`
  }, handleNewEvent)
  .subscribe()
```

**Action bar buttons (context-sensitive):**
- `Edit Ticket` → opens edit screen
- `Copy Prompt` → opens agent prompt action sheet
- `Answer` → shown when there is an open blocking question
- `Approve Delivery` → shown when ticket is in `review` state

---

### 4. Copy Prompt Flow

This is the key "send prompts to agents" feature.

**Interaction:**
1. User opens a ticket detail screen
2. Taps **"Copy Prompt"** (always-visible action button)
3. Action sheet appears with options:
   - **Standard Prompt** — full ticket prompt with protocol instructions
   - **Ask Mode Prompt** — "read ticket and ask one clarifying question before working"
   - **Context-Only** — ticket objective + acceptance criteria, no protocol boilerplate
   - **Resume Prompt** — for re-attaching to an in-progress ticket
4. User selects an option → `Clipboard.setStringAsync(prompt)` → toast confirmation
5. User switches to their preferred agent app (Claude, Cursor, ChatGPT, etc.) and pastes

**Prompt building:**
Port `buildTicketPromptMarkdown()` from the web app into `lib/prompt.ts`. This shared logic is pure TypeScript with no DOM dependencies, making it straightforward to reuse.

The prompt includes:
- Ticket title and identifier
- Objective (full text)
- Acceptance criteria
- Constraints
- Available tools
- Overlord protocol section with API URL and ticket ID
- Custom user instructions from profile settings
- Agent-specific flags from `user_agent_configs`

**Why this works well on mobile:**
Users frequently start agent sessions from their phone while reviewing work. Being able to copy a properly-formatted prompt and paste it into the Claude mobile app (or another agent interface) is a natural fit for the companion use case.

---

### 5. Create & Edit Ticket

**Screen: `/tickets/create` and `/tickets/[ticketId]/edit`**

**Fields (all text areas with Markdown support via plain text):**
- Title (required, single line)
- Project (dropdown/picker from user's projects)
- Priority (segmented control: Low / Medium / High / Urgent)
- Status (picker: Draft / Execute / Review / Complete / Blocked)
- Objective (multiline text area)
- Acceptance Criteria (multiline)
- Context (multiline)
- Constraints (multiline)
- Available Tools (multiline)
- Output Format (multiline)

**Validation:** Reuse Zod schemas from `lib/schemas/` (no change to existing schema files).

**On submit:**
- **Create:** calls existing `createTicketAction` server action (via `fetch` against the Next.js API or direct Supabase insert)
- **Edit:** calls `updateTicketAction`
- Optimistic update via React Query `useMutation` → invalidate ticket list and detail queries

**Mobile UX considerations:**
- Auto-save draft to AsyncStorage for create flow (prevent data loss)
- Keyboard-aware scroll view so text areas are not obscured
- Sticky save button at bottom

---

### 6. Notifications

**Push notification triggers (via Supabase Edge Function):**

| Trigger | Event |
|---|---|
| Agent asks a blocking question | `ticket_events.INSERT` where `event_type = 'question'` and `is_blocking = true` |
| Agent delivers work | `ticket_events.INSERT` where `event_type = 'deliver'` |
| Ticket status changed | `ticket_events.INSERT` where `event_type = 'status_change'` |
| Agent sends an alert | `ticket_events.INSERT` where `event_type = 'alert'` |
| Agent attaches to ticket | `agent_sessions.INSERT` |

**Implementation:**
1. On app launch, call `Notifications.requestPermissionsAsync()`
2. Get `ExpoPushToken` via `Notifications.getExpoPushTokenAsync()`
3. Store token in a new `push_tokens` table linked to `user_id` and `device_id`
4. Create a Supabase Edge Function (`send-push-notification`) that:
   - Listens to `ticket_events` via a Postgres webhook / database trigger → pg_net HTTP call
   - Calls Expo Push API: `https://exp.host/--/exponent-push-api/v2/push/send`
   - Includes: ticket title, event summary, `ticketId` in `data` payload for deep linking
5. On notification tap: Expo Router handles deep link `overlord://tickets/[ticketId]`

**Notification preferences:**
- Per-event-type toggles stored in a new `notification_preferences` table or as JSONB column on `profiles`

---

### 7. Answer Blocking Questions

When an agent asks a blocking question:
1. Push notification arrives → user taps → routed to ticket detail
2. Timeline shows the blocking question with an inline answer form
3. User types their answer → taps Submit
4. Mutation calls `/api/protocol/answer` (new endpoint) or directly inserts a `ticket_events` row with `event_type = 'answer'` and `payload.answer`
5. Agent's long-poll or webhook is notified and resumes execution

This is a critical mobile use case — unblocking agents while away from the desk.

---

## New Backend Changes Required

### New Tables

```sql
-- Push notification tokens
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

-- RLS: users can only manage their own tokens
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push tokens" ON push_tokens
  FOR ALL USING (auth.uid() = user_id);
```

### New API Route: `/api/protocol/answer`

```typescript
POST /api/protocol/answer
Body: { sessionKey: string, ticketId: string, questionEventId: string, answer: string }
Response: { ok: true }
```

Creates a `ticket_events` row with `event_type = 'answer'` linking back to the question event ID, and notifies the waiting agent session (currently via Supabase Realtime; already implemented in the web app as "answer mode").

### New Edge Function: `send-push-notification`

Triggered by a Postgres database trigger on `ticket_events` INSERT → calls Expo Push API. Written as a Deno edge function following existing patterns in `supabase/functions/`.

---

## Monorepo vs. Separate Repo

**Recommendation: Monorepo under `apps/mobile/`**

```
overlord/
├── apps/
│   ├── web/          # existing Next.js app (moved from root)
│   └── mobile/       # new Expo app
├── packages/
│   └── shared/       # shared types, schemas, prompt builder
├── supabase/
└── package.json      # turborepo / pnpm workspaces
```

**Benefits:**
- Share `database.types.ts`, Zod schemas, and `buildTicketPromptMarkdown()` without duplication
- Unified migrations and edge functions
- Single PR touches both web and mobile when a data model changes

**If monorepo migration is too disruptive:** Start as a separate repo using `git subtree` or copying shared files, then migrate when ready. This is acceptable for an MVP.

---

## Phased Delivery

### Phase 1 — MVP (4–6 weeks)
- Authentication (email/password)
- Ticket list (all tickets, basic filter by status)
- Ticket detail with event timeline (read-only)
- Copy Prompt action (Standard + Ask Mode)
- Create ticket (title + objective + project + priority)
- Edit ticket (all fields)
- Answer blocking questions inline
- Basic push notifications (questions + deliveries)
- EAS Build setup for TestFlight + Google Play internal testing

### Phase 2 — Notifications & Polish (2–3 weeks)
- Full push notification coverage (all event types)
- Notification preference settings
- Deep link routing from notifications
- Offline banner + stale-data indicators
- Pull-to-refresh + optimistic updates
- Project-scoped ticket views

### Phase 3 — Extended Features (3–4 weeks)
- Approve delivery / reject flow
- Artifact preview (text content inline, image preview, link open)
- Change rationale summary view (collapsible list, not full diff)
- Quick status transitions via long-press or swipe
- Search across tickets (server-side)
- Agent session status indicators (heartbeat staleness)
- Multiple organization switcher
- Apple/Google OAuth login

### Phase 4 — Power Features (TBD)
- Ticket creation from share sheet (share text → new ticket objective)
- Siri Shortcuts / App Intents for "copy prompt for [ticket]"
- Widget for ticket count by status
- Watch OS companion (notification glance + answer)

---

## Key Design Decisions

### Why Expo (not bare React Native)?
- Managed workflow gives OTA updates without App Store review cycles
- Expo Notifications abstracts iOS/Android push complexity
- Expo Router mirrors file-based routing already familiar from Next.js
- EAS Build handles certificates and provisioning profiles
- Can eject to bare if native modules require it (no lock-in)

### Why React Query (not Zustand/Redux)?
- Protocol data is server-owned and frequently invalidated; React Query handles caching and staleness out of the box
- No complex client-side state that needs a store — most state is derived from server data
- React Query's `useInfiniteQuery` handles pagination cleanly

### Why not just use the web PWA on mobile?
- The existing PWA works but is optimized for desktop cursor interactions
- Mobile-native gestures (swipe, long-press, native pickers) feel significantly better
- Push notifications require native APIs not available in the web PWA
- Deep linking from notifications requires native handling
- The clipboard API works more reliably in native context
- Native text editing for multiline fields is superior on mobile

### Prompt copy UX
Copying text to clipboard is the right pattern for this use case because:
1. Users open their preferred agent app separately (Claude mobile, ChatGPT, etc.)
2. Overlord does not need to integrate with each agent's mobile SDK
3. The pattern already exists in the desktop web app — mobile extends it naturally
4. iOS and Android both have reliable clipboard → paste workflows

---

## Implementation Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Supabase Realtime unreliable on mobile (background, sleep) | Fall back to polling every 30s when socket disconnects; use push notifications as the primary delivery mechanism |
| iOS clipboard access restrictions | Use `Expo Clipboard` which handles iOS 14+ paste confirmation gracefully |
| Large ticket event timelines causing scroll jank | Virtualized FlatList with `windowSize` tuning; cap initial load at 50 events |
| Prompt building relies on profile settings (requires extra fetch) | Prefetch profile on app mount, cache in React Query with 5-minute stale time |
| Edge Function cold starts for push notifications | Use Postgres `pg_net` extension to send HTTP directly from trigger to Expo API; skip Edge Function hop for latency-sensitive cases |
| Different auth token format between web sessions and mobile | Supabase JS client handles session refresh uniformly; no special handling needed |
| App Store review time for iteration | Use EAS Update for JS-only changes (most feature iteration); reserve App Store submissions for native changes |

---

## Dependency on Existing Web App

The mobile app intentionally shares infrastructure with the web app:
- **Same Supabase project** — no data duplication
- **Same agent protocol API routes** — mobile calls `/api/protocol/*` endpoints
- **Same RLS policies** — security model unchanged
- **Same Edge Functions** — push notification function is additive

The only **new backend code** required:
1. `push_tokens` table + RLS
2. `send-push-notification` edge function
3. `/api/protocol/answer` route (if not already fully implemented)

---

## Success Metrics

- **Time to answer a blocking question** — target < 60s from notification to answered on mobile
- **Ticket creation time** — target < 90s from tapping FAB to ticket saved
- **Prompt copy accuracy** — prompt copied matches web app output 100%
- **Notification delivery rate** — > 95% of blocking questions result in push within 30s
- **Crash-free session rate** — > 99.5% (Sentry monitoring)

---

## Open Questions for Product

1. Should the mobile app support **multiple organization accounts** in Phase 1, or single-org only?
2. Is **Apple Sign In** required at launch (required by Apple if any OAuth is offered)?
3. Should deliveries be **approvable from mobile**, or should that remain desktop-only to prevent accidental approvals?
4. What is the preferred **app icon / branding** for the mobile app stores?
5. Should the mobile app be **public (App Store)** or private distribution (TestFlight only / Enterprise) for the initial rollout?
