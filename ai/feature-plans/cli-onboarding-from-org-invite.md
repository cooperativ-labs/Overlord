# CLI Onboarding from Org Invite Emails

**Ticket:** 1:1358 — Add CLI onboarding to org invite emails
**Builds on:** 1:1332 (CLI account creation / `ovld onboard`)
**Status:** Proposal / plan

## Goal

Let an agent that receives an organization invitation email set itself up entirely
from the terminal. The email should direct agents to install the Overlord CLI and
onboard themselves, and — critically — the invitation code must work through the CLI
account-creation path so the new account lands inside the **inviting** organization
with the **invited role**, rather than spinning up a brand-new org.

## Current State

### 1. Invite email — `lib/actions/invitations.ts`
`buildInvitationEmailContent()` renders a single, human-oriented CTA ("Accept
Invite →") that points at the web page `${PLATFORM_URL}/invite/{token}`. There is
no mention of the CLI and the raw invitation token is never surfaced as a
copyable code — it only ever appears embedded in the accept URL.

### 2. Web accept flow — `apps/web/app/invite/[token]/` + `acceptInvitationAction`
- `acceptInvitationAction(token)` requires a signed-in Supabase user **whose email
  matches `invitation.email`**, then upserts a `members` row with `invitation.role`
  and marks the invite `accepted`.
- The not-logged-in branch offers `/login?next=/invite/{token}` and
  `/signup?invite={token}`.
- `/signup` (`app/(auth)/signup/page.tsx`) already understands `?invite=<token>`:
  it looks the invite up, **pre-fills the invited email**, and passes `inviteToken`
  to `AuthForm` so the invite is accepted after signup. This is the web equivalent
  of what we want for the CLI.

### 3. CLI onboarding — `ovld onboard` (`packages/overlord-cli/bin/_cli/onboard.mjs`)
1. Collects `name`, `organizationName`, `projectName`, `directoryPath`.
2. Runs the browser **device flow** (`authLoginViaDeviceFlow`); the browser opener
   wraps the verification URI into `/signup?next=<verify>&name=<name>` via
   `buildSignupUrl()` — note it does **not** pass `invite`.
3. Calls `POST /api/auth/cli-onboarding` with the Supabase JWT plus the collected
   fields and device fingerprint.
4. Persists credentials, writes `.overlord/project.json`, opens Desktop downloads.

### 4. The onboarding endpoint — `apps/web/app/api/auth/cli-onboarding/route.ts`
- Authenticates purely on the Supabase user JWT.
- `resolveOrCreateOrganization()`: **if the user already has any membership, reuse
  the first org; otherwise create a brand-new org** via
  `create_organization_for_current_user`. There is no invitation concept.
- Then creates a project + directory resource + onboarding ticket and finalizes the
  profile (`completed_step: 6`, clears `invited_organization_id`).

## The Gap

There is **no way to thread an invitation token through `ovld onboard`**. An invited
agent who installs the CLI and runs `ovld onboard` today will:
- create a *new* organization (it owns it, the inviter isn't involved), and
- never consume the invitation, so it never joins the org it was invited to.

Two things must change to close this:
1. **Email**: tell agents the CLI path exists and give them the invitation code.
2. **CLI + endpoint**: accept an invite token, and when present, **accept the
   invitation into the inviting org** instead of creating a new org.

A secondary concern is the **email-match constraint**. The web accept path requires
`user.email === invitation.email`. An agent signing up fresh via the device flow may
not use the invited email, so we must decide how strict to be on the CLI/token path
(see Security below).

## Proposed Design

### A. Add CLI onboarding copy + invite code to the email
In `buildInvitationEmailContent()` add a secondary "For AI agents" section to both
the `text` and `html` bodies, below the existing CTA:

- One line explaining agents can self-onboard from the terminal.
- Install line: `npm install -g overlord-cli` (matches the package name in
  `packages/overlord-cli/package.json` and the README install instructions).
- The command, with the token baked in:
  `ovld onboard --invite <TOKEN>`
- The raw code shown as a copyable monospace block (so an agent reading the email
  text/plain part can extract it deterministically).

Keep the human CTA exactly as-is; the agent block is additive and clearly labeled so
it does not confuse human recipients.

### B. Accept `--invite` in `ovld onboard`
In `runOnboardCommand` (`onboard.mjs`):
- Parse `--invite <token>` (alias `--invite-code`). Accept a bare token or a full
  `/invite/<token>` URL (strip to the token) for paste-friendliness.
- When an invite token is present:
  - Pass `invite=<token>` into `buildSignupUrl()` so the browser signup pre-fills the
    invited email and the web fallback stays consistent.
  - Make `organizationName` **optional / ignored** — the org comes from the invite.
    Skip the org prompt; still prompt for `projectName`/`directory` (the agent needs a
    working directory + project to receive tickets).
  - Include `inviteToken` in the `POST /api/auth/cli-onboarding` payload.
- Update `--help` text and the post-onboard summary to print the joined org + role.

### C. Make `/api/auth/cli-onboarding` invitation-aware
In `route.ts`:
- Extend `cliOnboardingSchema` with `inviteToken: z.string().trim().min(1).optional()`.
  Make `organizationName` optional when `inviteToken` is present (superrefine).
- Add `resolveOrganizationFromInvite()` that, when `inviteToken` is set:
  1. Loads the invitation by token (service role).
  2. Validates `status === 'pending'` and not expired (reuse the same guards as
     `acceptInvitationAction`; expire-on-read if past `expires_at`).
  3. Accepts it for `user.id` via a shared helper (below): upsert `members` with
     `invitation.role`, mark the invite `accepted` + `accepted_by`.
  4. Returns `{ created: false, organizationId, organizationName, role }`.
- Branch `resolveOrCreateOrganization`: if `inviteToken` present →
  `resolveOrganizationFromInvite`; else → existing behavior unchanged.
- Everything downstream (project, directory resource, onboarding ticket, profile
  finalize) runs against the resolved invited org. Consider **skipping the auto
  onboarding ticket** for the invite path (the org likely already has work) — see
  Open Decisions.

### D. Extract a shared `acceptInvitationForUser` helper
Pull the accept logic out of `acceptInvitationAction` into a reusable function
(e.g. `lib/actions/invitations.ts` or `lib/overlord/invitations.ts`) that takes
`{ token, userId, userEmail, enforceEmailMatch }` and performs validation + member
upsert + status update. Both the web action and the CLI endpoint call it, keeping a
single source of truth and avoiding drift. The web action calls it with
`enforceEmailMatch: true`; the CLI endpoint's policy is the Security decision below.

## Detailed Agent Flow (end to end)

1. **Invite created.** A manager/admin invites `agent@example.com` as `AGENT`. A row
   lands in `organization_invitations` with a token; the email is sent.
2. **Agent reads the email.** The new "For AI agents" block tells it to install the
   CLI and run `ovld onboard --invite <TOKEN>`. The agent extracts the token from the
   text/plain part.
3. **Install.** `npm install -g overlord-cli` (or `npx overlord-cli`).
4. **Run onboarding.** From the target repo: `ovld onboard --invite <TOKEN>`.
   - CLI parses the token, prompts only for project name + confirms the directory
     (defaults to `cwd`), skips the org prompt.
5. **Browser authorization (device flow).** CLI opens
   `/signup?next=<deviceverify>&invite=<TOKEN>&name=<name>`. The invited email is
   pre-filled. The agent creates the account (or signs in) and approves the CLI.
6. **CLI receives the JWT** and calls `POST /api/auth/cli-onboarding` with
   `{ name, projectName, directoryPath, deviceFingerprint, …, inviteToken }`.
7. **Server validates + accepts the invite.** Token pending & unexpired → upsert
   membership in the inviting org with the invited role → mark invite `accepted`.
8. **Server provisions workspace.** Creates/reuses a project, registers the directory
   as a resource bound to the device fingerprint, finalizes the profile, and
   (optionally) creates the onboarding ticket.
9. **CLI persists state.** Saves credentials, writes `.overlord/project.json`, and
   prints: joined org, role, project, directory.
10. **Agent is live.** It can now `ovld protocol attach`/`prompt` and receive tickets
    in the org it was invited to.

## Security Considerations

- **Invitation token is the bearer secret.** It is already treated this way on the
  web (`getInvitationByTokenAction` uses the service role for unauthenticated
  lookups). Single-use: mark `accepted` on consume; reject non-pending/expired.
- **Email match.** Decision point. The web path enforces
  `user.email === invitation.email`. For agents that may sign up with a different
  address, strict enforcement adds friction. Two safe options:
  - **(Recommended) Pre-fill + soft match.** Pass `invite` to `/signup` so the email
    is pre-filled by default, but on the CLI endpoint **do not hard-fail on
    mismatch** — possession of the (single-use, expiring) token plus an authenticated
    account is sufficient authority to join. Record the accepting user id.
  - **Strict match.** Require the JWT email to equal the invited email; cleaner audit
    trail but blocks agents that authenticate with a different identity.
- **Expiry unchanged** (7 days). Expired tokens are rejected and flipped to
  `expired` on read, same as the web path.
- **Rate limiting / abuse.** The endpoint already requires a valid JWT; the invite
  token must also be valid+pending, so blast radius is one membership per valid token.

## Edge Cases

- **Already a member of the inviting org.** Member upsert is idempotent; mark the
  invite accepted and continue (don't error).
- **Token already accepted/cancelled/declined/expired.** Return a clear,
  agent-readable error (`This invitation is no longer valid / has expired`) so the CLI
  can surface it.
- **User already has other memberships.** With an invite token, still join the invited
  org (do **not** fall back to "reuse first existing org").
- **Invite + no project/directory provided.** Still require project name + directory so
  the agent has somewhere to work; only the org prompt is skipped.
- **Web signup email mismatch from the device flow.** Covered by the email-match
  decision above.

## Surface / Parity Checklist

Per the connector-surfaces discipline, keep these in sync:
- CLI: `onboard.mjs` (`--invite` flag, help text), and the README in
  `packages/overlord-cli/README.md`.
- API: `apps/web/app/api/auth/cli-onboarding/route.ts` (+ schema).
- Email: `lib/actions/invitations.ts` (`buildInvitationEmailContent`).
- Shared helper: `acceptInvitationForUser` consumed by both web action and endpoint.
- Docs: any onboarding docs under `docs/public` / `apps/web/app/docs` that describe
  `ovld onboard` should mention the `--invite` path.

## Testing

- **Unit:** `buildInvitationEmailContent` includes the CLI block + token in both
  `text` and `html`; token is HTML-escaped. Extend
  `tests/lib/actions/invitations.test.ts`.
- **Unit:** `cliOnboardingSchema` accepts `inviteToken` and makes `organizationName`
  optional only when the token is present. Extend the existing
  `tests/lib/overlord/validation-*.test.ts` pattern.
- **Helper:** `acceptInvitationForUser` — pending→accepted, expired rejection,
  idempotent re-accept, email-match policy.
- **Endpoint (integration):** with `inviteToken` → joins inviting org with invited
  role, no new org created; without → unchanged behavior.
- **CLI:** `--invite` parsing (bare token vs URL), org prompt skipped, payload carries
  `inviteToken`, `invite` threaded into the signup URL.

## Open Decisions (for the PM)

1. **Email-match strictness** on the CLI/token path — recommend soft (pre-fill +
   accept on possession). Confirm.
2. **Onboarding ticket on the invite path** — skip it (org likely has work) or keep it
   for consistency? Recommend skip; the agent receives real tickets from the org.

## Phasing

- **Phase 1 (this ticket):** email copy + `--invite` flag + endpoint support + shared
  helper + tests. Delivers the end-to-end agent self-onboarding flow.
- **Phase 2 (optional):** richer email (per-agent install snippets, copy buttons),
  and docs polish.
