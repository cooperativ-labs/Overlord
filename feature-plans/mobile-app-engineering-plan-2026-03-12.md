# Overlord Mobile App — Engineering Plan

**Updated:** 2026-03-29
**Ticket:** 533bd754-4c91-4873-aa83-551e8b306006
**Author:** AI Engineering Agent

---

## Executive Summary

Overlord should ship a **feed-first iPhone app** built with **React Native on Expo SDK 55** inside a formalized monorepo. The app should center on three mobile-native workflows:

1. **Follow the feed and ticket notifications in real time**
2. **Unblock work quickly from the phone**
3. **Launch and monitor remote jobs through SSH-backed server access**

This should not be treated as a thin port of the web app. On phones, the product should feel like a fast operational inbox with list-based ticket management. On tablets, it can expand into fuller project management views including **list, board, and calendar**.

The codebase already has core ingredients we can build around: `ticket_events`, `agent_sessions`, `feed_posts`, existing offline caches, push-friendly realtime primitives, and an Electron SSH launch pattern. The mobile plan should reuse those primitives rather than inventing a separate backend model.

---

## Product Direction

### Primary use cases

- Check the **organization feed** for meaningful agent activity
- Receive and act on **push notifications** for questions, deliveries, failures, and remote-job state
- Open a ticket from the feed or a notification and reply immediately
- Create lightweight tickets while away from a desk
- Register a server, install the device's public SSH key on that server, and then **start or monitor remote jobs from the phone**

### Non-goals for the first release

- Full parity with the desktop web app
- Embedded code review diffs
- Rich terminal emulation comparable to a desktop SSH client
- Complex project administration, billing, or organization setup
- Android-first design work; the first-class target is **iPhone**, with tablet adaptations for iPad

---

## Recommendation

### 1. Build the mobile app in the monorepo now

The repository already contains web, Electron, CLI, Supabase, and shared-package patterns. The right move is not "create yet another repo and migrate later"; it is to **formalize the monorepo shape now** and add `apps/mobile`.

Recommended target structure:

```text
apps/
  web/                  # Next.js app
  mobile/               # Expo 55 app
  desktop/              # Electron shell and desktop services
packages/
  shared/               # Types, schemas, helpers, ticket/feed models
  api-client/           # Typed client wrappers for mobile/web/desktop
  protocol/             # Prompt/protocol builders and shared ticket actions
  ui-core/              # Design tokens, cross-platform constants
supabase/
  migrations/
  functions/
```

### 2. Treat feed + notifications as the product center

The prior plan emphasized tickets broadly. The new plan should shift the center of gravity to:

- **Feed tab as default landing surface**
- Push notifications deep-linking into feed entries and ticket threads
- High-signal event summaries instead of forcing users to browse ticket lists first

### 3. Treat SSH as a first-class mobile workflow, not a side setting

The mobile app should own:

- SSH keypair generation on-device
- Secure private-key storage
- Public-key export so the user can install it on their server
- Server reachability checks
- Remote job launch/monitor flows tied back to ticket activity and notifications

This is the differentiator that makes mobile operationally useful, not just informational.

---

## Technical Stack

| Concern | Choice | Notes |
|---|---|---|
| Mobile framework | **React Native + Expo SDK 55** | Matches the stated requirement and keeps EAS/OTA workflow |
| Routing | **Expo Router** | File-based routing aligns with existing web mental model |
| Data fetching | **TanStack Query** | Good fit for server-owned state, optimistic mutations, offline hydration |
| Backend | **Supabase + existing Overlord protocol/backend** | Reuse `ticket_events`, `agent_sessions`, `feed_posts`, auth, and edge functions |
| Auth | **Supabase Auth + SecureStore** | Existing auth model, mobile-safe token persistence |
| Notifications | **Expo Notifications** | Native push support for iPhone and tablet |
| Sensitive storage | **SecureStore + Keychain-backed storage** | For tokens and SSH private-key material |
| SSH transport | **Native-capable SSH library via Expo-compatible native module** | Must support key auth and non-interactive command execution |
| Observability | **Sentry React Native** | Keep parity with web/desktop monitoring |
| Delivery | **EAS Build + EAS Update** | Fast iteration without repeated App Store review for JS-only changes |

---

## Monorepo Plan

### Why now

- Shared prompt/protocol logic already exists conceptually and should not fork again for mobile
- Feed models, ticket models, and notification payload contracts should be defined once
- SSH server metadata should be shared across desktop and mobile
- Keeping mobile outside the repo would create duplicate auth, types, and protocol code immediately

### Migration approach

Do this in two controlled steps:

1. **Create monorepo boundaries without moving everything at once**
   - Add `apps/mobile`
   - Add `packages/shared`, `packages/api-client`, and `packages/protocol`
   - Begin moving reusable code out of the web root into packages
2. **Optionally relocate web/Electron roots later**
   - Only after package boundaries are stable
   - Avoid a disruptive "move the world first" migration

This gives monorepo benefits immediately without blocking the mobile app on a large structural rewrite.

---

## App Information Architecture

### Phone navigation

Recommended root tabs for iPhone:

1. **Feed**
2. **Tickets**
3. **Servers**
4. **Account**

### Tablet navigation

On iPad/tablets, keep the same information model but allow wider presentation:

- Persistent sidebar or split view
- Ticket workspace modes: **list**, **board**, **calendar**
- Feed alongside ticket detail when space permits

### Screen map

```text
app/
  _layout.tsx
  (auth)/
    login.tsx
  (tabs)/
    _layout.tsx
    feed/
      index.tsx
      [postId].tsx
    tickets/
      index.tsx
      [ticketId]/
        index.tsx
        activity.tsx
        edit.tsx
    servers/
      index.tsx
      add.tsx
      [serverId].tsx
      [serverId]/setup-key.tsx
      [serverId]/run-job.tsx
    account/
      index.tsx
      notifications.tsx
      security.tsx
```

---

## UX Priorities

### 1. Feed-first UX

The default home screen should be the feed, not the ticket index.

Each feed item should summarize:

- What happened
- Which ticket/project/objective it belongs to
- Whether the user needs to act
- Whether a remote job was started, failed, or completed

Feed cards should support quick actions where appropriate:

- Open ticket
- Reply to blocking question
- View server/job details
- Copy prompt or run follow-up action

### 2. Notifications are tied to feed, not just tickets

Push notifications should deep-link to the most relevant object:

- Blocking question -> ticket activity thread with answer composer
- Delivery -> ticket summary or feed post
- Remote job completion/failure -> job detail or server screen
- Important feed post -> specific feed item

### 3. Layout behavior by device class

Phone behavior:

- Ticket browsing is **list-first only**
- Ticket detail opens as a dedicated screen
- Calendar and board are intentionally omitted on phone

Tablet behavior:

- Tickets support **list, board, calendar**
- Two-pane layouts are acceptable
- Feed and detail can coexist in split view

This keeps the phone app fast and native-feeling instead of cramming desktop metaphors into a small screen.

---

## GlassEffect Strategy

Use `expo-glass-effect` selectively, not everywhere.

Recommended uses:

- Feed filter bar / floating segmented controls
- Inline notification trays
- Bottom action surfaces on ticket detail
- Server quick-action cards
- Tablet side panels and floating inspector surfaces

Do **not** make the entire UI glass-heavy. Use it for hierarchy and focus, not decoration.

Constraints:

- Treat glass as **iOS-only enhancement**
- Ship normal fallbacks for unsupported OS versions and reduced-transparency settings
- Avoid putting primary text on noisy glass backgrounds without an opaque content layer

Practical rule:

- Core app layout remains solid and readable
- Glass is applied to overlays, action surfaces, and "current context" chrome

---

## Core Functional Areas

### 1. Feed

The existing `feed_posts` model should become a first-class mobile surface.

Mobile feed requirements:

- Organization feed with project filters
- Read/unread state
- Deep links into ticket detail, objective, and remote-job context
- Compact body previews with expansion
- Offline cache of recent feed posts

Important feed event types to emphasize:

- Agent progress milestones
- Blocking questions
- Deliveries ready for review
- Remote job started / running / failed / completed
- Ticket delegation or reassignment

### 2. Notifications

Push notifications should be driven from the same event model powering the feed.

Recommended triggers:

- Blocking question created
- Delivery posted
- Delivery approved/rejected
- Remote job failed
- Remote job completed
- High-priority feed post generated
- Server connectivity issue or authentication failure

Recommended preference model:

- Per-user preferences for event categories
- Per-device token registration
- Optional quiet hours
- "Critical operations" category that cannot be fully silenced without explicit confirmation

### 3. Tickets

Ticket support on mobile should focus on speed, not full desktop breadth.

Phone MVP:

- List view
- Ticket detail
- Activity timeline
- Create/edit essentials
- Reply to blocking questions
- Approve simple review actions if product wants that on mobile

Tablet additions:

- List
- Board
- Calendar
- Split-view detail

### 4. Servers and SSH

This deserves its own product area in the app.

Each server record should contain:

- Display name
- SSH host / user / port
- Optional working directory
- Auth status
- Last successful connection time
- Associated projects or environments

The mobile app should support:

- Adding a server profile
- Generating an SSH keypair on-device
- Copying or sharing the public key
- Verifying connectivity
- Launching non-interactive jobs remotely
- Viewing recent runs and logs

---

## SSH Key and Remote Job Plan

### Product requirement

The device should generate and keep its own SSH key so the user can authorize the phone against a remote server. After that, the phone can trigger jobs on the server without asking for a password each time.

### Recommended security model

- Generate a dedicated **Ed25519** keypair per device or per server profile
- Store the **private key only on-device** in secure storage
- Prefer non-exportable storage if the chosen native implementation supports it
- Display and share only the **public key**
- Let users revoke and rotate keys from the app

### Recommended backend model

Add server-management tables instead of overloading generic settings:

```text
servers
server_authorizations
device_ssh_keys
remote_job_runs
remote_job_events
```

Purpose:

- `servers`: canonical SSH endpoints and metadata
- `device_ssh_keys`: public key fingerprint, device label, revocation status
- `server_authorizations`: links users/devices/servers/projects
- `remote_job_runs`: execution record tied to ticket or objective
- `remote_job_events`: lifecycle updates for feed + notifications

### Mobile SSH flow

1. User creates a server profile
2. App generates SSH keypair on-device
3. App shows the public key with copy/share actions
4. User installs the public key on the target server
5. App runs a verification command over SSH
6. App can now launch remote commands tied to tickets/objectives
7. Job state is mirrored back into `remote_job_runs`, `remote_job_events`, `ticket_events`, and optionally `feed_posts`

### Scope recommendation

Phase 1 should support:

- Key generation
- Key storage
- Public-key export
- Connectivity verification
- Non-interactive command execution
- Job status + logs

Phase 1 should **not** promise a full interactive shell UI unless the SSH module selection proves stable early.

That keeps the value high while avoiding a terminal-emulation rabbit hole.

---

## Backend Changes

### Reuse what exists

Keep using:

- `ticket_events`
- `agent_sessions`
- `feed_posts`
- existing auth and organization scoping
- existing realtime publication setup

### Additive backend work

1. **Push token storage**
   - `push_tokens`
   - device metadata
   - notification preference linkage
2. **Server and SSH key models**
   - `servers`
   - `device_ssh_keys`
   - `server_authorizations`
3. **Remote job execution records**
   - `remote_job_runs`
   - `remote_job_events`
4. **Feed/notification fanout**
   - edge function or database-trigger pipeline for push notifications
   - feed post generation rules for remote-job milestones

### API/shared service requirements

Create shared typed clients in `packages/api-client` for:

- Feed queries
- Ticket queries and mutations
- Notification preference management
- Server management
- SSH key registration
- Remote job launch and polling

The mobile app should not talk to ad hoc one-off endpoints if the same workflows will also be needed in desktop/web.

---

## Offline and Realtime Strategy

### Realtime

Use Supabase Realtime for:

- Ticket activity updates
- Feed refresh signals
- Remote job status updates

### Offline

Mobile should cache:

- Recent feed posts
- Ticket summaries
- Recently opened ticket timelines
- Server list and last-known server state

Behavior:

- Feed and ticket detail show last-known state when offline
- Queued replies or lightweight edits retry when connectivity returns
- Remote job launch should fail explicitly when no network is available

---

## Delivery Plan

### Phase 0: Monorepo Foundations

- Add `apps/mobile`
- Add shared packages for protocol, models, and API clients
- Extract reusable ticket/feed/domain types from the web app
- Define mobile design tokens and navigation conventions

### Phase 1: Feed + Notifications MVP

- Expo 55 app shell
- Auth
- Feed tab as default landing
- Push notifications for blocking questions and deliveries
- Ticket list + ticket detail
- Reply to blocking questions
- Offline cache for feed and recent tickets

### Phase 2: Server Access MVP

- Servers tab
- On-device SSH keypair generation
- Public-key install flow
- Connectivity verification
- Launch remote jobs tied to tickets/objectives
- Push notifications for job completion/failure
- Feed integration for job lifecycle

### Phase 3: iPad / Tablet Expansion

- Split-view layout
- Ticket board view
- Ticket calendar view
- Feed + ticket dual-pane experiences
- Glass-enhanced tablet inspector surfaces

### Phase 4: Operational Polish

- Key rotation and device revocation UX
- Richer job log viewing
- More feed filters
- Deeper notification preferences
- Approval/review workflows from mobile where safe

---

## Main Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Monorepo migration becomes a project of its own | Add `apps/mobile` and shared packages first; delay moving web/Electron roots |
| SSH native module compatibility in Expo 55 | Validate module choice with a spike before committing to full interactive terminal support |
| Private-key handling becomes unsafe or export-heavy | Keep private keys on-device only; expose public keys and fingerprints, not raw private-key export |
| Feed becomes too noisy on mobile | Tune feed generation and notification categories around actionability, not completeness |
| Push fatigue from job/status fanout | Add category preferences and suppress low-signal events by default |
| Glass UI harms readability | Restrict glass to overlays and action surfaces with solid fallbacks |
| Phone UI grows desktop complexity | Keep phone tickets list-only and defer board/calendar to tablets |

---

## Immediate Next Steps

1. Approve the monorepo target shape and create `apps/mobile` plus shared packages.
2. Run a technical spike for Expo 55 covering:
   - auth
   - push notifications
   - selected SSH module
   - secure key storage
   - `expo-glass-effect` fallback behavior
3. Define backend schema for servers, device SSH keys, and remote job events.
4. Build Phase 1 around the feed and notifications before expanding ticket editing breadth.
5. Start tablet-specific board/calendar work only after the phone feed/ticket/server loop is stable.

---

## Open Product Questions

1. Should remote jobs be limited to predefined commands per project/server, or can users enter arbitrary commands from mobile?
2. Should a device generate one SSH key per server, or one per device with multiple server authorizations?
3. Should delivery approval be allowed on phone in Phase 1, or only viewing and feedback?
4. Does the first App Store release need public distribution, or is TestFlight sufficient through the server-access beta period?
5. Which feed events are important enough to interrupt the user with push versus remain in-app only?
