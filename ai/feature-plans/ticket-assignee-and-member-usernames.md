# Engineering Plan: Ticket Assignee + Human-Readable Member IDs (usernames)

**Ticket:** 1:1342 — "Ability to assign tickets to specific users"
**Status:** Plan (no code written yet)
**Author:** Overlord agent, in response to PM feedback on the prior review.

This plan folds the original assignee feature (column `assigned_member`, default = creator, web/mobile pickers) together with the three feedback decisions:

1. **Member unique ID** — give each user a `username` on `profiles`, used to form human-readable member IDs `[orgid]:[username]`.
2. **Default assignee** — creator is the default; the ticket-create CLI gains an `--assigned-to` flag so agents can assign on creation.
3. **Profile visibility** — pick the most efficient approach; co-members may select each other's profiles.

---

## 1. Answering the open questions

### 1a. Usernames on `profiles` — good idea, with one refinement to the default

**Yes, this is a good idea.** A stable, human-readable handle is the natural key for `--assigned-to`, for `@`-mentions later, and for any URL or log line that needs to name a person without leaking a UUID. Storing it on `profiles` and generating it in the existing `handle_new_user_profile()` trigger (`supabase/migrations/20260226201000_add_profiles.sql:45`) is the right home: `profiles` is already user-level (one row per `auth.users` id), so one username per user falls out naturally, and the member ID `[orgid]:[username]` mirrors the existing `ticket_id` format `[orgid]:[sequence]` (`1:1342`).

**Refinement to the default — don't default to the *raw* email.** The request says the default username should be the email address. I recommend defaulting to the **slugified email local-part** instead of the full address:

- The full email contains `@` and the domain, so member IDs become `1:jake@cooperativ.io` — long, and it pushes PII (domain, full address) into CLI output, URLs, and logs. The local-part alone gives clean IDs like `1:jake`.
- Emails are globally unique, which is why they were proposed as a safe default — but the local-part is **not** unique (two people can be `jake@a.com` / `jake@b.com`). So we slugify the local-part and append a numeric suffix on collision (`jake`, `jake2`, …). The generator must resolve collisions itself.
- Slug rules: lowercase, allowed `[a-z0-9._-]`, collapse/trim separators, min length fallback to `user` + suffix if the local-part slugifies to empty.
- Users can still edit it to whatever they like in profile settings.

If the PM prefers the literal-email default, it's a one-line change in the generator (skip slugification) — but I'd advise against it for the reasons above. **This is the one decision worth confirming before building.**

**Uniqueness & storage.** `username` is **globally unique** across `profiles` (case-insensitive). Because the ID is `[orgid]:[username]` and a user carries the same username into every org they belong to, global uniqueness on the column is sufficient to make every member ID unique. Store as `citext` with a `UNIQUE` constraint (or `text` + a unique index on `lower(username)`).

### 1b. Profile visibility — SECURITY DEFINER directory RPC (most efficient *and* safe)

The assignee picker needs co-members' `name`, `image_url`, `email`, and now `username`. Today `profiles` RLS is own-row only (`profiles_select_own`), so `getOrganizationMembersAction` (`lib/actions/organizations.ts:351`) already silently renders co-members without names — its `profiles.in(userIds)` lookup returns only the caller's own row.

I evaluated the two options from the review and **recommend a SECURITY DEFINER RPC, not a blanket RLS policy**, because `profiles` holds sensitive columns — `custom_agent_instructions` and the `preferences` jsonb (default project, editor scheme, terminal profile, active org). A broad co-member `SELECT` policy on `profiles` is row-scoped only; it cannot hide columns, so it would expose everyone's custom instructions and preferences to every co-member. That's not acceptable.

A `SECURITY DEFINER` function returning **only the safe display columns** is the most efficient path that's also safe:

- `get_org_member_directory(org_id integer)` → `setof (user_id uuid, username citext, name text, email text, image_url text)`.
- Guards internally that `auth.uid()` is a member of `org_id` (reuse the membership check pattern already used by `has_org_role`), then returns the directory for that org.
- It also **fixes the existing member-list gap for free**: point `getOrganizationMembersAction` at the same RPC and co-members finally render with names everywhere.

This keeps the read surface tight (one column-controlled function) rather than widening base-table RLS.

---

## 2. Data model changes

All in a single new migration under `supabase/migrations/` (timestamp-prefixed). Per CLAUDE.md: after migrating, run `yarn generate`, update `seed.ts` (never `seed.sql`), then `yarn seed:sync`.

### 2a. `profiles.username`

- Add `username citext` (enable the `citext` extension if not already present) with a `UNIQUE` constraint. Decide nullable-then-backfill vs. `NOT NULL` after backfill — recommend: add nullable, backfill, then add the unique constraint + `NOT NULL`.
- Extend `handle_new_user_profile()` to compute `username` via a helper `generate_unique_username(seed text)` that slugifies the email local-part and loops on collision. Keep it inside the same `SECURITY DEFINER` function as requested.
- Backfill existing profiles in the migration (the file already has an idempotent backfill block to extend), iterating to guarantee uniqueness.
- `set search_path` stays `public, auth`; `citext` lives in `public`.

### 2b. `tickets.assigned_member`

(Carried over from the prior review — still greenfield; nothing named `assigned_member` exists in the repo yet.)

- `assigned_member uuid` **nullable**. It physically stores a `user_id`; keep the requested name and document it.
- **Composite FK** `(organization_id, assigned_member) → members(organization_id, user_id)` `ON DELETE SET NULL`. This guarantees the assignee is a member of the ticket's own org and auto-nulls if they leave. (`members` has composite PK `(organization_id, user_id)` and no single `id` — `supabase/migrations/20260223110247_init-squash.sql:67`.)
- **Default = creator** via a `BEFORE INSERT` trigger that sets `assigned_member := created_by` when null (a column `DEFAULT` can't reference another column). Safe because the insert policy already requires the creator to be an AGENT+ member, so the composite FK holds.
- One-time backfill: `update tickets set assigned_member = created_by where assigned_member is null`.
- Index `tickets(organization_id, assigned_member)` to support "my tickets" / filter-by-assignee queries later.

### 2c. RPCs

- `get_org_member_directory(org_id integer)` — described in §1b. Used by the picker and by `getOrganizationMembersAction`.
- `generate_unique_username(seed text)` — internal helper for the profile trigger and for the username-edit validation path.

---

## 3. Server-side (Next.js server actions + protocol routes)

### 3a. Assignee mutation
- `setTicketAssignedMemberAction(ticketId, assignedMemberUserId | null)` mirroring `setTicketProjectAction`. No new write RLS needed — changing the assignee is a normal `tickets` UPDATE, already gated by `tickets_update_agent_plus` (AGENT/MANAGER/ADMIN; VIEWER blocked). Validate the target is a member of the ticket's org before writing (defense in depth; the composite FK is the backstop).

### 3b. Member-ID resolution helper
- `resolveAssignedMember(supabase, organizationId, input)` → `user_id`, used by every create surface and by `--assigned-to`:
  - `^\d+:.+$` → split `orgid:username`; assert `orgid === ticket org`; look up `profiles.username`.
  - UUID → treat as `user_id` directly.
  - contains `@` → look up by `profiles.email`.
  - otherwise → treat as bare `username`.
  - In all cases verify org membership; return a clear error if not found / not a member.

### 3c. Username edit
- Add `username` to the profile-settings surface alongside `updateProfileNameAction` (`lib/actions/account.ts:131`) and the `profile-name-form.tsx` component. New `updateUsernameAction(username)`:
  - normalize + validate format (`^[a-z0-9._-]{2,32}$`), check global uniqueness (friendly error on conflict), update `profiles.username`.
- Surface the computed member ID (`[orgid]:[username]`) read-only in settings so users see their handle per org.

### 3d. Thread `assigned_member` through ticket creation
Add an optional `assignedTo` (member-ID string) to the create schemas and resolve it in the routes, overriding the creator default when present:
- `createFollowUpTicketSchema` → `apps/web/app/api/protocol/create-ticket/route.ts` (insert at line ~81).
- `createStandaloneTicketSchema` → `apps/web/app/api/protocol/tickets/route.ts`.
- `spawnSchema` (the `prompt` command) and `recordWorkSchema` for parity — at minimum `create` + `prompt`, which is what the feedback calls out.
- Schemas live in `lib/overlord/validation.ts`. Resolve via `resolveAssignedMember`; on failure return a 4xx with a readable message.

---

## 4. CLI: `--assigned-to` flag

**Governed by the `agent-connector-update` skill** (source-template-first edits, generated-plugin parity, drift alignment) and verified with `drift-review`.

- Command surfaces in `packages/overlord-cli/bin/_cli/protocol.mjs`: `protocolCreateTicket` (follow-up + standalone, ~line 2550) and `protocolPrompt` (~line 2452). Add `--assigned-to <member>` to the flag parsing and include `assignedTo: String(flags['assigned-to'])` in the request body when present.
- `--assigned-to` accepts the human-readable member ID `[orgid]:[username]` (primary), a bare username, an email, or a raw user UUID — all resolved server-side by `resolveAssignedMember`.
- Update `ovld protocol help` / command usage text and any README/`apps/web/app/docs` references (use the `update-docs` skill).
- Add the flag to the generated agent plugins for parity (the connector skill enumerates the surfaces); run `drift-review` to confirm CLI ↔ API ↔ MCP ↔ plugin alignment.

---

## 5. UI

### 5a. Web
- New `TicketMemberSelect` rendered immediately **before** `TicketProjectSelect` in `apps/web/components/features/TicketPanelHeader.tsx` (~line 80). Options come from `get_org_member_directory`; shows avatar + name, allows explicit unassign (null). Calls `setTicketAssignedMemberAction`. Use `LoadingButton`/loading-state conventions.
- Thread `members` + `assignedMember` through the header props.
- Add the `username` field + read-only member-ID display to profile settings (`profile-name-form.tsx` area).

### 5b. Mobile
- The objective's path is stale. The real file is `apps/mobile/components/ticket-detail/TicketDetailHeader.tsx`; there's **no project selector** in the mobile header. Add an assignee **row inside `TicketHeaderSheet`** (the expandable sheet). Note its existing `assignedSelection` refers to the executing **agent**, not a human — keep them distinct. Keep parity with web via the `mobile-app` skill.

---

## 6. Build order

1. **Migration** — `profiles.username` (+ `citext`, unique, generator, backfill); `tickets.assigned_member` (+ composite FK, default trigger, backfill, index); `get_org_member_directory` RPC. Test with `supabase db reset`.
2. `yarn generate`; update `seed.ts`; `yarn seed:sync`.
3. **Reads** — point `getOrganizationMembersAction` at `get_org_member_directory`; add a `getOrgMemberDirectoryAction` for the pickers.
4. **Server actions** — `setTicketAssignedMemberAction`, `resolveAssignedMember`, `updateUsernameAction`.
5. **Create surfaces** — add `assignedTo` to schemas + create/prompt routes.
6. **CLI** — `--assigned-to` (connector skill + drift-review + docs).
7. **Web UI** — `TicketMemberSelect`; username settings.
8. **Mobile UI** — assignee row in `TicketHeaderSheet`.
9. **Tests** — see §7.

## 7. Testing
- DB: username generation + collision suffixing; uniqueness rejection; trigger default = creator; FK auto-null on member removal; directory RPC returns only safe columns and only to co-members.
- Resolution: each `--assigned-to` form (member-ID / username / email / uuid), cross-org rejection, non-member rejection.
- RLS / multi-tenancy: a member of org A cannot read org B's directory; VIEWER cannot change assignee; AGENT+ can.
- UI: assign, reassign, unassign (web + mobile); username edit + uniqueness error.

## 8. Decisions to confirm
1. **Default username = slugified email local-part** (recommended) vs. raw email. *(Only true blocker.)* ANSWERED: Slugified email local-part + numeric suffix on collision
2. Username edit constraints: reserved words? min/max length (proposed 2–32)? rate-limit changes? ANSWERED: Reserved words, min/max length (3–32), rate-limit changes, unique constraint with friendly error on conflict
3. On unassign — explicit `null` (recommended; spec says nullable) vs. fall back to creator. ANSWERED: Explicit `null`

## 9. Out of scope (suggested follow-up tickets)
- Surface assignee on board/list cards and **filter by assignee** (likely the real day-to-day value).
- `@username` mentions in comments/objectives, reusing the same resolver.
