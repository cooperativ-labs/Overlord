# CLI-Native Account Creation

**Ticket:** 1:1337 — Agents should be able to create their own accounts if they have an email address
**Status:** Plan

## Goal

Make account creation possible from the terminal without requiring an agent to operate the web signup form. An agent that knows an email address should be able to run a CLI command, receive or retrieve the confirmation code from email, enter that code in the CLI, and finish with valid Overlord credentials plus the same org/project/directory setup that `ovld onboard` performs today.

This plan covers account creation, email confirmation, CLI credential persistence, and integration with existing onboarding. It intentionally does not replace OAuth/browser login for humans; it adds a terminal-first path for agents and SSH/headless environments.

## Current State

### `ovld auth login`

`packages/overlord-cli/bin/_cli/auth.mjs` supports two login paths:

- Device authorization flow through `/api/auth/device/request` and `/api/auth/device/poll`.
- Fallback loopback OAuth.

Both paths still require a browser-controlled approval step. The device flow prints a verification URL and code, but the user must sign up/sign in on the web page and click "Approve CLI Access".

### `ovld onboard`

`packages/overlord-cli/bin/_cli/onboard.mjs` already collects name, organization/project/directory details, opens a browser signup URL, receives tokens from the device flow, and calls `POST /api/auth/cli-onboarding`.

The server endpoint at `apps/web/app/api/auth/cli-onboarding/route.ts` then creates or resolves the organization, creates/reuses a project, registers the directory resource, updates onboarding profile state, and creates the starter ticket when appropriate.

Recent work also added invite support (`--invite`) so the onboarding endpoint can join an inviting organization instead of creating a new one. This plan should build on that route instead of duplicating provisioning logic.

### Web Signup

`lib/actions/auth.ts` uses `supabase.auth.signUp()` with email/password and redirects users to `/confirm-email`. `apps/web/app/(auth)/confirm-email/confirm-email-form.tsx` verifies the 8-digit signup OTP with `supabase.auth.verifyOtp({ type: 'signup' })`.

That means the email confirmation primitive already exists; the missing piece is exposing a safe server/API wrapper and CLI flow for it.

## Proposed Design

### 1. Add a CLI account-creation command

Add a new command:

```bash
ovld auth signup --email agent@example.com --name "Agent Name"
```

Supported flags:

- `--email <email>`: required unless prompted interactively.
- `--name <name>`: required unless prompted interactively.
- `--password <password>`: optional. If omitted, the CLI generates a strong random password because the agent only needs a session, not memorable credentials.
- `--organization-name <name>` and `--project-name <name>`: optional provisioning inputs when combined with onboarding.
- `--directory <path>`: defaults to `cwd`.
- `--invite <token|url>` / `--invite-code <token|url>`: reuse the current invite-aware onboarding behavior.
- `--no-onboard`: create and confirm the user only; do not create org/project/directory.
- `--yes`: suppress confirmation prompts.

Keep `ovld onboard` as the main one-shot command for "create account plus workspace". It can call the same underlying signup helper when `--email` is supplied:

```bash
ovld onboard --email agent@example.com --name "Build Agent" --project-name "Repo"
ovld onboard --invite <token> --email agent@example.com
```

### 2. Add public auth endpoints for CLI signup

Add two API routes under `apps/web/app/api/auth/cli-signup/`:

#### `POST /api/auth/cli-signup/request`

Payload:

```json
{
  "email": "agent@example.com",
  "name": "Build Agent",
  "password": "optional-generated-or-user-provided",
  "inviteToken": "optional"
}
```

Behavior:

- Validate email, name, password length, and optional invite token with Zod.
- Call Supabase `auth.signUp()` from a server-side client with user metadata `{ name, full_name: name }`.
- Use the existing confirmation redirect target for parity, but do not depend on browser redirects.
- If the email already has an unconfirmed signup, call `auth.resend({ type: 'signup', email })` just like `signUp()` does today.
- Return an opaque `signup_attempt_id` or minimally `{ email, status: 'confirmation_required' }`.
- Rate-limit by IP and email using the same spirit as device auth issuance. This endpoint is public and sends email, so abuse controls matter.

#### `POST /api/auth/cli-signup/verify`

Payload:

```json
{
  "email": "agent@example.com",
  "token": "12345678",
  "password": "same-password-used-at-request-time"
}
```

Behavior:

- Verify the 8-digit OTP using Supabase `verifyOtp({ email, token, type: 'signup' })`.
- Return the resulting Supabase access token, refresh token, expiry, and canonical `platform_url`.
- If Supabase does not return a session for this verification shape, immediately call `signInWithPassword()` with the same generated password after successful verification and return that session.
- Return clear machine-readable errors for expired code, invalid code, duplicate/confirmed account, and rate limits.

The CLI should never require service-role secrets. The server endpoints own interaction with Supabase and return only the authenticated user's session.

### 3. Integrate with existing onboarding

After `cli-signup/verify` returns credentials, the CLI should reuse the existing `completeCliOnboarding()` path:

1. Save tokens only after verification succeeds.
2. If onboarding is enabled, call `POST /api/auth/cli-onboarding` with:
   - `name`
   - `organizationName` unless an invite token is present
   - `projectName`
   - `directoryPath`
   - `deviceFingerprint`, `deviceHostname`, `devicePlatform`
   - `inviteToken` when supplied
3. Save credentials and write `.overlord/project.json` exactly as `ovld onboard` does today.

This keeps all workspace provisioning in one route and avoids creating a second organization/project implementation.

### 4. CLI user experience

Recommended terminal flow:

```text
$ ovld onboard --email agent@example.com

Name (build-agent):
Organization name (build-agent):
Project name (repo):

We sent an 8-digit confirmation code to agent@example.com.
Enter confirmation code: 12345678

Overlord setup complete.
  Organization: build-agent
  Project: repo
  Directory: /path/to/repo
```

For non-interactive agents:

```bash
ovld auth signup request --email agent@example.com --name build-agent --json
ovld auth signup verify --email agent@example.com --code "$CODE" --json
ovld onboard --use-current-auth --project-name Repo --directory "$PWD" --yes
```

The split request/verify subcommands are useful for agents that need to pause while another tool reads email. The single `ovld onboard --email ...` command should remain the ergonomic default.

### 5. Security and abuse controls

- Treat email OTP as the proof of inbox control. Do not bypass Supabase email confirmation.
- Generate a strong random password when the caller does not provide one. Persisting the refresh token is the important part; the password can be rotated later through the web app.
- Do not print generated passwords by default. If we need recovery, add an explicit `--print-generated-password` flag with a warning.
- Rate-limit signup request and verify attempts by IP and normalized email.
- Preserve duplicate-unconfirmed behavior from `lib/actions/auth.ts`: resend a fresh confirmation email instead of failing confusingly.
- For invite tokens, keep the current single-use, expiring bearer-token model and pass the token into `cli-onboarding`; do not accept the invite during signup request.
- Log server-side signup attempts without storing OTPs or passwords.

## Implementation Plan

### Phase 1: shared validation and endpoints

- Add `cliSignupRequestSchema` and `cliSignupVerifySchema` in `lib/overlord/validation.ts`.
- Add `apps/web/app/api/auth/cli-signup/request/route.ts`.
- Add `apps/web/app/api/auth/cli-signup/verify/route.ts`.
- Extract shared duplicate-unconfirmed resend behavior from `lib/actions/auth.ts` if needed so web signup and CLI signup stay aligned.
- Add endpoint tests for successful request, duplicate unconfirmed resend, invalid payload, verify success, expired/invalid code, and rate limiting.

### Phase 2: CLI command helpers

- Add signup request/verify network helpers to `packages/overlord-cli/bin/_cli/auth.mjs` or a new `signup.mjs`.
- Extend `packages/overlord-cli/bin/_cli/index.mjs` help to include `ovld auth signup`.
- Add parser support for:
  - `ovld auth signup`
  - `ovld auth signup request`
  - `ovld auth signup verify`
- Persist returned credentials through the existing `saveCredentials()` function.
- Add CLI tests covering flag parsing, generated password reuse between request and verify, JSON mode, and error rendering.

### Phase 3: onboarding integration

- Extend `packages/overlord-cli/bin/_cli/onboard.mjs` to accept `--email`, optional `--password`, and `--use-current-auth`.
- If `--email` is present and no valid credentials exist, run CLI signup instead of browser device auth.
- After verification, call the existing `completeCliOnboarding()` implementation.
- Keep browser device auth as the fallback when `--email` is absent.
- Add tests for `ovld onboard --email` and `ovld onboard --email --invite`.

### Phase 4: docs and connector surface review

- Update `packages/overlord-cli/README.md`.
- Update `apps/web/app/docs/quick-start/page.tsx` and `apps/web/app/docs/surfaces/cli/page.tsx`.
- If help text or command references appear in plugin templates, update `plugins/_source/` first and run `yarn plugins:render` plus `yarn plugins:check`.
- Review `ai/guidence/CONNECTOR_SURFACES.md` for any command/help surfaces affected by the new auth command.

## Open Decisions

1. Should CLI-native signup require a password supplied by the caller, or should generated-password be the default? Recommendation: generate by default and avoid printing it.
2. Should `ovld auth signup` create only an account, or should the top-level command default to full onboarding? Recommendation: keep account-only under `ovld auth signup`, full provisioning under `ovld onboard --email`.
3. Do agents have a reliable email-reading tool in the intended environment? If yes, provide JSON output and split request/verify commands. If no, keep the interactive code prompt as the primary flow.

## Acceptance Criteria

- An agent can create an Overlord account from the CLI using only an email address, name, and the email confirmation code.
- The CLI receives and stores valid Supabase credentials without requiring browser signup.
- `ovld onboard --email ...` creates or joins the correct organization, creates/reuses the project, registers the current directory, and writes `.overlord/project.json`.
- Existing browser login, device auth, OAuth loopback, and invite onboarding continue to work.
- Public signup endpoints are rate-limited and covered by tests.
