# Engineering Plan: Assign Tickets to Specific Members

**Ticket:** 1:1342 — "Ability to assign tickets to specific users"
**Status:** Plan (supersedes the feasibility review delivered for objective `ed21f28c`)
**Author:** Overlord agent

This plan incorporates the product feedback on three open questions from the
original review: (1) human‑readable member IDs / usernames, (2) the default
assignee and a CLI `--assigned-to` flag, and (3) profile visibility.

---

## 1. Goals

- Add a nullable `tickets.assigned_member` column that names the **human owner**
  of a ticket, recorded independently of who/what executed it
  (`tickets.assigned_agent` / `delegate` stay untouched).
- Default the assignee to the **member who created the ticket**, while keeping
  the field freely editable and explicitly nullable.
- Let AGENT/MANAGER/ADMIN members change the assignee from web and mobile.
- Give the CLI `create` / `prompt` / `create-ticket` commands an `--assigned-to`
  flag so agents can file tickets owned by a specific member.
- Introduce a per‑user **username** so members can be referenced by a
  human‑readable handle instead of a UUID, and resolve `--assigned-to`
  against it.
- Make co‑member profiles selectable (names + avatars) so the assignee picker
  is actually usable.

## 2. Non‑Goals (recommended follow‑ups)

- Surfacing the assignee on board/list cards and filtering by assignee. This is
  likely the real downstream value but is out of scope here — track as a
  separate ticket.
- "My tickets" views / notifications on assignment changes.

---

## 3. Product Decisions (answering the feedback)

### 3.1 Usernames and human‑readable member IDs

**Question asked:** give each user a `username` on `profiles` (defaulting to
their email, editable in profile settings, generated in the profile SQL
function), and compose member IDs as `[orgid]:[username]`. Good idea?

**Recommendation: yes to a username on `profiles`, with three adjustments.**

1. **Don't store the `[orgid]:[username]` string anywhere.** Treat it as a
   *display / lookup convenience*, not a stored identifier. The durable
   identity for an assignee remains `user_id` (a UUID), which is what
   `assigned_member` stores and what every existing FK/RLS path already uses.
   A composite string column would duplicate state that can drift from
   `members` and `profiles`. The handle is resolved on demand, not persisted.

2. **`username` lives on `profiles` and is globally unique.** `profiles` is a
   global, one‑row‑per‑auth‑user table (PK `id = auth.users.id`), so a username
   stored there is inherently global. That is actually convenient: a globally
   unique username means `username` alone unambiguously identifies a user, and
   the `orgid:` prefix in `[orgid]:[username]` becomes a *scope check*
   ("this handle, and confirm they're in this org"), not part of the key.
   - Use a case‑insensitive unique handle. Implement with a `citext` column +
     unique index (enable the `citext` extension), or a `lower(username)`
     unique index on a `text` column. Prefer `citext` for ergonomics.
   - **Tradeoff to accept:** global uniqueness means two unrelated orgs cannot
     both have a member with handle `jake`. That is the standard GitHub‑style
     model and is fine for our scale. If we ever need orgs to own their own
     namespace, the alternative is an **org‑scoped** `username` on `members`
     (unique per `organization_id`); that better matches `[orgid]:[username]`
     literally but cannot be generated in the profile trigger (members are
     created per‑org, later) and complicates the "default = email" rule.
     We recommend the global model now and call out the org‑scoped option as
     the escape hatch.

3. **Default the username to a slugified email local‑part, not the raw email.**
   The raw email is a poor public handle: it contains `@`/`.`, isn't
   slug‑safe, and exposing it as a member ID leaks email addresses to other org
   members. Generate the default from `split_part(email, '@', 1)`, slugified to
   `[a-z0-9_-]`, with a numeric suffix on collision (`jake`, `jake-2`, …).
   Members can override it in profile settings. The email itself is still
   stored separately (`profiles.email`) and can remain an accepted
   `--assigned-to` input.

**Username generation** is added to the existing
`public.handle_new_user_profile()` trigger
(`supabase/migrations/20260226201000_add_profiles.sql`), which already runs
`security definer` on `auth.users` insert. Because uniqueness can collide, the
generation logic loops/suffixes until it finds a free handle. A backfill
populates usernames for existing profiles.

**Validation rules for user‑edited usernames:** 3–39 chars, `^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$`, case‑insensitive unique, reserved‑word denylist (`admin`, `me`, `null`, etc.). Enforced both in the server action (Zod) and a DB `CHECK` constraint.

### 3.2 Default assignee + CLI `--assigned-to`

- **Default = creator, but not a column default.** A column `DEFAULT` cannot
  reference another column, so use a `BEFORE INSERT` trigger that sets
  `assigned_member := created_by` when the caller leaves it null. Backfill
  existing rows with `update tickets set assigned_member = created_by`. This is
  safe because the insert policy already requires the creator to be an AGENT+
  member of the org, so the composite FK (below) will hold.
- **`--assigned-to` is honored when present, default applies when absent.** When
  the flag is provided, the resolved `user_id` is sent and the trigger leaves it
  alone; when omitted, the trigger fills in the creator.
- `--assigned-to` accepts any of: a **username** (preferred), an **email**, or a
  raw **user_id UUID** (and tolerates an `orgid:username` form by stripping the
  prefix and validating the org). Resolution happens server‑side, scoped to the
  target ticket's organization membership; an unresolvable or non‑member handle
  returns a 4xx with a clear message rather than silently dropping the value.

### 3.3 Profile visibility

The picker needs co‑member names/avatars, but `profiles` RLS is currently
own‑row only (`profiles_select_own`). The feedback explicitly approves org
members seeing each other's profiles, so take the **most efficient, reusable**
route:

> **Add an RLS `SELECT` policy on `profiles` that lets a user read any profile
> belonging to a co‑member of one of their organizations.**

```sql
create policy "profiles_select_co_member"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.members me
      join public.members them
        on them.organization_id = me.organization_id
      where me.user_id = (select auth.uid())
        and them.user_id = profiles.id
    )
  );
```

This is preferred over a `SECURITY DEFINER` RPC (the original review's lean)
because it fixes the visibility gap **everywhere** at once — notably the
existing `getOrganizationMembersAction` join that today returns only the
caller's own profile — without adding a new call surface. Keep the existing
`has_org_role` helper pattern in mind to avoid policy recursion; if the
self‑join on `members` trips RLS recursion, wrap the membership lookup in an
existing `security definer` helper (mirroring how `has_org_role` is used
elsewhere).

---

## 4. Data Model Changes

### 4.1 `profiles.username`

Migration `…_add_profile_username.sql`:

- `create extension if not exists citext;`
- `alter table public.profiles add column username citext;`
- `CHECK` constraint for slug format; `unique` index on `username`.
- New helper `public.generate_unique_username(seed text)` that slugifies the
  seed and appends `-N` until free.
- Update `public.handle_new_user_profile()` to populate `username` via the
  helper from name/email local‑part, in both the trigger body and the
  bottom‑of‑file backfill `insert … select`.
- Backfill existing rows lacking a username.
- After backfill, consider `alter column username set not null` in a follow‑up
  migration once all rows are populated (kept nullable initially to avoid
  insert‑ordering issues).

### 4.2 `tickets.assigned_member`

Migration `…_add_ticket_assigned_member.sql`:

```sql
alter table public.tickets
  add column assigned_member uuid;

-- Guarantee the assignee is a member of THIS ticket's org; auto-null on leave.
alter table public.tickets
  add constraint tickets_assigned_member_fkey
  foreign key (organization_id, assigned_member)
  references public.members (organization_id, user_id)
  on delete set null;

create index tickets_assigned_member_idx
  on public.tickets (assigned_member);

-- Default to creator when not supplied.
create or replace function public.set_default_ticket_assignee()
returns trigger language plpgsql as $$
begin
  if new.assigned_member is null then
    new.assigned_member := new.created_by;
  end if;
  return new;
end;
$$;

create trigger set_ticket_assigned_member_default
  before insert on public.tickets
  for each row execute function public.set_default_ticket_assignee();

update public.tickets set assigned_member = created_by
  where assigned_member is null;
```

Notes:
- The **composite FK on `(organization_id, user_id)`** is required because
  `members` has no single‑column `id`; its PK is `(organization_id, user_id)`.
  This also enforces same‑org assignment for free.
- Field stays **nullable** so an explicit unassign (null) is allowed; on
  unassign we store `null` rather than falling back to the creator.
- The name `assigned_member` physically stores a `user_id` — slightly
  misleading, but it is the name requested; document it in the migration.

### 4.3 Types & seed

- `yarn generate` to refresh `types/database.types.ts`.
- Update `seed.ts` (never `seed.sql`) so seeded profiles get usernames and a
  couple of seeded tickets exercise a non‑creator assignee, then
  `yarn seed:sync`.

---

## 5. CLI / Protocol Changes

The `--assigned-to` flag must thread through all three creation paths in
`packages/overlord-cli/bin/_cli/protocol.mjs`:

- **standalone `create`** → `POST /api/protocol/tickets`
- **follow‑up `create` / `create-ticket`** → `POST /api/protocol/create-ticket`
- **`prompt`** (create + execute) → its create payload

Steps:

1. **CLI (`protocol.mjs`):** read `flags['assigned-to']` and add
   `...(flags['assigned-to'] ? { assignedTo: String(flags['assigned-to']) } : {})`
   to each create body. Add `--assigned-to <username|email|user-id>` to the
   `create`, `prompt`, and `create-ticket` help/usage blocks.
2. **Validation (`lib/overlord/validation.ts`):** add
   `assignedTo: z.string().trim().max(320).optional()` to
   `createStandaloneTicketSchema`, `createFollowUpTicketSchema`, and the prompt
   schema.
3. **Resolver (`lib/overlord/…`):** new helper
   `resolveAssignedMemberUserId(supabase, organizationId, assignedTo)` that:
   - returns `null` when `assignedTo` is absent (lets the trigger default to
     creator),
   - strips an optional `orgid:` prefix and validates it matches the target org,
   - resolves UUID → as‑is, else username (citext match on `profiles`), else
     email (`profiles.email`),
   - **verifies the resolved user is a member of `organizationId`** (join
     `members`), returning a typed error otherwise.
4. **Routes:** in `create-ticket/route.ts`, `tickets/route.ts`, and the prompt
   route, call the resolver and pass `assigned_member` into the `tickets`
   insert. On a resolution error, return `400` with a clear message
   (`Cannot assign ticket: "<handle>" is not a member of this organization.`).
5. **Docs:** update the CLI reference pages under
   `apps/web/app/docs/for-agents/cli-reference` and the plugin skill reference
   (`packages/overlord-cli/plugins/*/skills/overlord-ticket/reference/cli.md`)
   to document `--assigned-to`. Run the `drift-review` / `update-docs` skills to
   keep API/CLI/MCP/docs aligned.

---

## 6. Server Actions (web/mobile shared)

- **`setTicketAssignedMemberAction(ticketId, userId | null)`** in
  `lib/actions/…`, mirroring `setTicketProjectAction`. It is a normal ticket
  `UPDATE`, so it is already gated by the existing `tickets_update_agent_plus`
  RLS policy (AGENT/MANAGER/ADMIN can update, VIEWER cannot) — **no new write
  policy is needed.** Validate that the target user is an org member (defense in
  depth; the composite FK also enforces it).
- **`updateUsernameAction(username)`** in the profile settings action module:
  Zod‑validate the slug, then `update profiles set username = …` (gated by
  existing `profiles_update_own`). Surface a friendly "handle already taken"
  error on unique‑violation.
- Reuse / fix **`getOrganizationMembersAction`**: with the new co‑member
  `profiles` SELECT policy it now returns real names/avatars; return
  `{ user_id, name, image_url, username, email, role }` for the picker.

---

## 7. Web UI

- **`apps/web/components/features/TicketPanelHeader.tsx`:** add a new
  `TicketMemberSelect` immediately before `TicketProjectSelect` (rendered at
  line ~80). It lists org members (name + avatar + `@username`), shows the
  current `assigned_member`, supports an "Unassigned" option, and calls
  `setTicketAssignedMemberAction`. Thread `members` and `assigned_member`
  through the header props the same way `project` is threaded today.
- **Profile settings:** add a username field (with availability/validation
  feedback) wired to `updateUsernameAction`.

## 8. Mobile UI

- **Correct path:** the header is
  `apps/mobile/components/ticket-detail/TicketDetailHeader.tsx`, **not** the
  stale `app/(tabs)/tickets/[ticketId]/_components/…` path in the original
  objective. There is **no project selector** in the mobile header, so "to the
  left of the project selector" doesn't map.
- Add an **assignee row inside `TicketHeaderSheet`** (the expandable sheet),
  distinct from the existing `assignedSelection` which refers to the **AGENT**,
  not the human owner. Reuse the same members list + server action as web.

---

## 9. Build Order

1. Migration A: `profiles.username` (citext + unique + CHECK), username
   generator, update `handle_new_user_profile()`, backfill.
2. Migration B: `tickets.assigned_member` (composite FK + default trigger +
   backfill).
3. Migration C: `profiles_select_co_member` RLS policy.
4. `yarn generate`; update `seed.ts`; `yarn seed:sync`.
5. Validation schemas + `resolveAssignedMemberUserId` helper.
6. Wire `--assigned-to` through CLI `create` / `prompt` / `create-ticket` and
   the three routes.
7. `setTicketAssignedMemberAction`, `updateUsernameAction`, fix
   `getOrganizationMembersAction`.
8. Web `TicketMemberSelect` + profile‑settings username field.
9. Mobile assignee row in `TicketHeaderSheet`.
10. Docs (CLI reference + plugin skill refs); run `drift-review` / `update-docs`.

## 10. Testing

- **DB:** trigger defaults assignee to creator; explicit `--assigned-to` is
  respected; assigning a non‑member fails the FK; removing a member nulls their
  assignments; username generation produces unique slugs and survives
  collisions.
- **RLS / multi‑tenancy:** a member can read co‑members' profiles but **not**
  profiles of users in orgs they don't belong to; VIEWER cannot change the
  assignee; cross‑org assignment is rejected.
- **CLI:** `--assigned-to` by username, by email, by UUID, and `orgid:username`;
  omitted flag defaults to creator; bad handle returns a clear 400.
- **UI:** web/mobile pickers render names/avatars, change + unassign persist.

## 11. Open Questions for Product

- **Username uniqueness scope:** global (recommended, simplest for
  `[orgid]:username`) vs. org‑scoped on `members`. Confirm global is acceptable.
- **Make `username` `NOT NULL`** after backfill, or keep it optional?
- **Unassign semantics:** confirmed as explicit `null` (no fallback to creator)
  — flag if instead the creator should always be retained.
- **Assignee on cards + filtering:** confirm this is a separate follow‑up
  ticket, as recommended.
