# Engineering Plan: User Invitation Flow

**Ticket:** d88ce451-6db0-4b17-bb45-9e4917552db0  
**Date:** 2026-05-01  
**Status:** Draft

---

## Overview

Enable organization admins to invite users by email address. Existing Overlord users accept the invitation and are immediately added to the org. Users without an account follow a modified signup → onboarding flow that skips org/project creation and lands them directly in the inviting organization.

---

## Current State

| Area | Status |
|---|---|
| `members` table | Exists — `(organization_id, user_id)` composite PK, `role` enum: `VIEWER \| AGENT \| MANAGER \| ADMIN` |
| Member list UI | `MembersPage.tsx` — read-only, "invitations coming soon" placeholder |
| Email infrastructure | Resend v6.9.2 integrated; `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env vars present |
| RLS helpers | `has_org_role()` and `is_org_member()` database functions already exist |
| Onboarding | Multi-step flow with `onboardingCompletedStep`, `onboardingSkipped`, `desktopSetupDone` in `profiles.onboarding` JSON |
| Auth | Email/password + GitHub/Bitbucket OAuth; confirmation via 8-digit OTP |

---

## 1. Database Changes

### 1.1 New Table: `organization_invitations`

```sql
create table public.organization_invitations (
  id           uuid primary key default gen_random_uuid(),
  organization_id int not null references public.organizations(id) on delete cascade,
  invited_by   uuid not null references auth.users(id),
  email        text not null,
  role         public.organization_role not null default 'VIEWER',
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Prevent duplicate pending invitations for same email+org
create unique index org_invitations_pending_email_idx
  on public.organization_invitations(organization_id, lower(email))
  where status = 'pending';
```

**RLS policies:**

```sql
-- Admins/Managers can view invitations for their org
create policy "invitations_select_admin"
  on public.organization_invitations for select
  using (has_org_role(organization_id, array['ADMIN','MANAGER']));

-- Admins/Managers can create invitations
create policy "invitations_insert_admin"
  on public.organization_invitations for insert
  with check (has_org_role(organization_id, array['ADMIN','MANAGER']));

-- Admins/Managers can cancel/update invitations
create policy "invitations_update_admin"
  on public.organization_invitations for update
  using (has_org_role(organization_id, array['ADMIN','MANAGER']));

-- Unauthenticated lookup by token for the accept page
-- (token is a 256-bit secret; treat as capability URL)
create policy "invitations_select_by_token"
  on public.organization_invitations for select
  using (true);  -- filtered by token in query; token secrecy is the access control
```

> **Note:** The token-based select policy is intentionally permissive because a 256-bit random token is the security primitive. Alternatively, use a Supabase Edge Function to handle token lookups server-side only, bypassing RLS entirely.

### 1.2 `profiles.onboarding` — New Field

Add `invitedOrganizationId?: number` to the onboarding JSON. This is set when an invitation is accepted before an account exists. The onboarding flow reads this field to skip org/project creation.

No migration needed — the field is in a JSONB column.

---

## 2. Server Actions

**File:** `lib/actions/invitations.ts`

```typescript
// Send an invitation email; creates invitation row
inviteUserToOrganizationAction(organizationId, email, role): Promise<ActionResult>

// List pending invitations for an org
getOrganizationInvitationsAction(organizationId): Promise<Invitation[]>

// Cancel a pending invitation (admin only)
cancelInvitationAction(invitationId): Promise<ActionResult>

// Resend invitation email (resets expires_at)
resendInvitationAction(invitationId): Promise<ActionResult>

// Look up invitation by token (no auth required — for accept page)
getInvitationByTokenAction(token): Promise<InvitationWithOrg | null>

// Authenticated user accepts an invitation
acceptInvitationAction(token): Promise<{ organizationId: number }>

// Authenticated user declines an invitation
declineInvitationAction(token): Promise<ActionResult>
```

**File:** `lib/actions/organizations.ts` — additions

```typescript
// Update a member's role (admin only)
updateMemberRoleAction(organizationId, userId, role): Promise<ActionResult>

// Remove a member from an org (admin only; not self — use leaveOrganizationAction)
removeMemberAction(organizationId, userId): Promise<ActionResult>
```

---

## 3. Email Template

**Sent via Resend** from `lib/actions/invitations.ts`.

**Subject:** `You've been invited to join {orgName} on Overlord`

**Body (plain + HTML):**
- Inviter's name and org name
- Assigned role with brief description
- CTA button → `https://overlord.cooperativ.io/invite/{token}`
- Expiry notice: "This invitation expires in 7 days"
- If no account: secondary CTA → sign up with same email

Email helper lives at `lib/email/send-invitation.ts` (mirrors pattern in `lib/actions/early-access.ts`).

---

## 4. Invitation Accept Flow

### 4.1 New Route: `/invite/[token]`

**File:** `apps/web/app/invite/[token]/page.tsx`

This is a public page — no auth required to view. It:

1. Calls `getInvitationByTokenAction(token)` server-side
2. If token is invalid/expired → shows error UI with "Request a new invitation" link
3. If token is `accepted` → "You're already a member" state
4. **Happy path:**
   - Shows org name, inviter, assigned role
   - Two branches depending on auth state:

#### Branch A — User is already logged in

- "Accept Invitation" button → calls `acceptInvitationAction(token)`
  - Inserts row into `members` table
  - Sets invitation `status = 'accepted'`
  - Redirects to `/{organizationId}/feed`
- "Decline" link → calls `declineInvitationAction(token)`, shows confirmation

#### Branch B — User is not logged in

Show two options:
- **"Sign in and accept"** → `/login?next=/invite/{token}` (after login, the `/invite/[token]` page re-renders and hits Branch A)
- **"Create account and accept"** → `/signup?invite={token}` (new user flow — see §5)

### 4.2 Post-Login Redirect

`/login` and `/auth/callback` already support a `next` query param. The `/invite/[token]` page handles the rest once the user is authenticated.

---

## 5. Signup Flow for Invited New Users

### 5.1 Modified Signup

**File:** `apps/web/app/(auth)/signup/page.tsx`

When `?invite={token}` is present:
- Pre-fill the email field with the invited email (fetched server-side via `getInvitationByTokenAction`)
- Lock the email field to prevent changing it (invitation is address-specific)
- Store the token in a hidden field / cookie

After OTP confirmation (`/confirm-email`), the auth callback:
1. Reads the stored invite token from cookie/param
2. Calls `acceptInvitationAction(token)` — adds user to org and sets `invitedOrganizationId` on their profile
3. Redirects to `/onboarding?invited=true`

### 5.2 Modified Onboarding

**File:** `apps/web/app/onboarding/page.tsx` + `lib/actions/onboarding.ts`

When `profiles.onboarding.invitedOrganizationId` is set (or `?invited=true` query param):

**Steps shown:**
1. ~~Create your organization~~ — **SKIPPED**
2. ~~Create your first project~~ — **SKIPPED**  
3. Name / profile setup — **INCLUDED**
4. Download the desktop app — **INCLUDED** (existing `desktopCompletedStep` logic)
5. Done → redirect to `/{invitedOrganizationId}/feed`

The `updateOnboardingProgressAction` already persists step state; we add handling for `invitedOrganizationId` and skip the org/project creation server actions for invited users.

---

## 6. UI Changes

### 6.1 Members Page — `MembersPage.tsx`

Replace the "coming soon" placeholder with:

**Pending Invitations section** (above member list, visible to ADMIN/MANAGER):
- Table: email, role, invited by, sent date, expires date, status badge
- Per-row actions: **Resend**, **Cancel**
- "Invite Member" button at top right

**Active Members section** (existing list, enhanced):
- Add **Role** dropdown (editable for ADMIN/MANAGER, read-only for others)
  - Changing role calls `updateMemberRoleAction`
  - Prevent downgrading the last ADMIN
- Add **Remove** button (ADMIN/MANAGER only; hidden for self — use "Leave Org" in danger zone)

### 6.2 Invite Member Modal — new component

**File:** `apps/web/components/modals/InviteUserModal.tsx`

Fields:
- **Email address** — text input with validation
- **Role** — dropdown: `VIEWER | AGENT | MANAGER | ADMIN` with tooltip descriptions per role
- **Send Invitation** button (uses `LoadingButton`)

Validation:
- Valid email format
- Duplicate pending invitation for same email → show inline warning "An invitation is already pending for this address"
- Cannot invite yourself

### 6.3 Role Descriptions (tooltip copy)

| Role | Description |
|---|---|
| VIEWER | Can view tickets, feed, and project activity. Cannot create or modify. |
| AGENT | Can create and run agent sessions. Cannot manage org settings. |
| MANAGER | Can manage projects, members, and agent sessions. Cannot change org settings. |
| ADMIN | Full access including org settings, billing, and member management. |

### 6.4 Navigation / Notification Hooks (optional, Phase 2)

- In-app notification when user receives an invitation (via existing push notification infrastructure in `supabase/functions/send-push-notification/`)
- Badge on Settings icon if the logged-in user has a pending invitation to another org

---

## 7. Security Considerations

- **Token entropy:** 256-bit random hex via `gen_random_bytes(32)` — brute-force infeasible
- **Expiry:** 7-day TTL enforced both in DB (`expires_at`) and in application logic
- **Email binding:** Invitation is bound to the invited email. On `acceptInvitationAction`, verify `auth.users.email == invitation.email` (case-insensitive). Reject if mismatch.
- **One ADMIN minimum:** `updateMemberRoleAction` and `removeMemberAction` check that at least one ADMIN remains in the org after the change.
- **Rate limiting:** Apply per-org invitation rate limit in the server action (e.g. max 20 pending invitations per org) to prevent spam.
- **RLS:** All DB access from server actions uses the authenticated Supabase client; `has_org_role()` enforces ADMIN/MANAGER checks at the DB level.

---

## 8. Implementation Order

| Phase | Work | Notes |
|---|---|---|
| 1 | DB migration — `organization_invitations` table + RLS | Run `yarn generate` after |
| 2 | `lib/actions/invitations.ts` + `updateMemberRoleAction` / `removeMemberAction` in organizations.ts | Core logic |
| 3 | Email template — `lib/email/send-invitation.ts` | Resend integration |
| 4 | `/invite/[token]` accept page | Handles both auth states |
| 5 | Modified signup (`?invite=`) + OTP callback token handoff | Cookie-based token carry |
| 6 | Modified onboarding — skip org/project steps for invited users | `invitedOrganizationId` field |
| 7 | `MembersPage.tsx` — invite button, pending invitations table, role editing, remove | UI polish |
| 8 | `InviteUserModal.tsx` | Reuse `LoadingButton` |

---

## 9. Open Questions

1. **Multi-org invitations:** Should an existing member of one org be invited to another org simultaneously? (Current schema supports it — no unique constraint on `user_id` across orgs.) ✅ Already works.
ANSWER: Yes, we should allow existing members of one org to be invited to another org simultaneously.
2. **OAuth signup for invited users:** If the invitee signs up via GitHub/Bitbucket instead of email, how do we match the invitation? Options: (a) require email match post-OAuth, (b) pass invite token through OAuth `state` param. Recommend option (b).
ANSWER: We should pass the invite token through the OAuth `state` param.
3. **Invitation to the invitee's existing account under a different email:** Out of scope for v1 — the invitation is address-bound.
ANSWER: Out of scope for v1 — the invitation is address-bound.
4. **Notification for existing users:** Should existing Overlord users get an in-app notification in addition to email? Recommend yes — use the push notification Edge Function.
ANSWER: Yes, we should send an in-app notification to existing Overlord users in addition to email.
5. **Manager-created invitations:** The plan allows MANAGERs to invite up to and including the MANAGER role. Should MANAGERs be able to invite ADMINs? Recommend: no — restrict invitation role ceiling to the inviter's own role.
ANSWER: No, we should not allow MANAGERs to invite ADMINs.
