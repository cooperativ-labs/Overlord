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
- `--password <password>`: optional. The CLI should recommend using a password manager and supplying a generated password. If omitted, the CLI can still complete signup through email OTP/magic-link login, but future password login will not be available unless the user later sets/resets a password.
- `--no-agent-token`: optional escape hatch. By default, successful CLI signup should mint and persist an Overlord agent token for durable headless authentication.
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

### 2. Add public auth endpoints for CLI signup and login

Add public CLI signup and email-code login routes under `apps/web/app/api/auth/`, plus one authenticated agent-token minting route:

#### `POST /api/auth/cli-signup/request`

Payload:

```json
{
  "email": "agent@example.com",
  "name": "Build Agent",
  "password": "optional-user-provided-password",
  "inviteToken": "optional"
}
```

Behavior:

- Validate email, name, password length, and optional invite token with Zod.
- Call Supabase `auth.signUp()` from a server-side client with user metadata `{ name, full_name: name }`.
- Use the existing confirmation redirect target for parity, but do not depend on browser redirects.
- If the email already has an unconfirmed signup, call `auth.resend({ type: 'signup', email })` just like `signUp()` does today.
- If no password is supplied, use Supabase OTP/magic-link signup semantics instead of creating an unknown password that the account owner can never recover. The CLI should make it clear that password login is unavailable until a password is set/reset.
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
- If the caller supplied a password and Supabase does not return a session for this verification shape, immediately call `signInWithPassword()` with that same password after successful verification and return that session.
- Return clear machine-readable errors for expired code, invalid code, duplicate/confirmed account, and rate limits.

#### `POST /api/auth/cli-login/request`

Payload:

```json
{
  "email": "agent@example.com"
}
```

Behavior:

- Validate and normalize the email.
- Send an OTP/magic-link code for an existing account only, using Supabase email OTP login with user creation disabled.
- Return `{ email, status: 'confirmation_required' }`.
- Rate-limit by IP and normalized email.

#### `POST /api/auth/cli-login/verify`

Payload:

```json
{
  "email": "agent@example.com",
  "token": "12345678"
}
```

Behavior:

- Verify the login OTP using the Supabase email OTP flow.
- Return the resulting Supabase access token, refresh token, expiry, and canonical `platform_url`.
- Return clear machine-readable errors for unknown account, expired code, invalid code, and rate limits.

#### `POST /api/auth/agent-token`

Payload:

```json
{
  "label": "CLI: build-hostname"
}
```

Behavior:

- Require a valid Supabase authenticated session.
- Reuse the existing `user_agent_tokens` model and token generation semantics from `lib/actions/user-agent-tokens.ts`.
- Insert only a SHA-256 hash and prefix server-side.
- Return the full `oat_...` token once, plus token metadata.
- Keep revocation/listing in the existing Agent Tokens settings surface.

The CLI should never require service-role secrets. The server endpoints own interaction with Supabase and return only the authenticated user's session.

### 3. Integrate with existing onboarding

After `cli-signup/verify` returns credentials, the CLI should reuse the existing `completeCliOnboarding()` path:

1. Save tokens only after verification succeeds.
2. Unless `--no-agent-token` is passed, call `POST /api/auth/agent-token` with the just-issued Supabase session and save the returned `oat_...` token in the existing CLI credential store. The saved agent token should become the preferred future credential for protocol commands, matching the current `OVERLORD_AGENT_TOKEN` / `ovld auth login --token` behavior.
3. If onboarding is enabled, call `POST /api/auth/cli-onboarding` with:
   - `name`
   - `organizationName` unless an invite token is present
   - `projectName`
   - `directoryPath`
   - `deviceFingerprint`, `deviceHostname`, `devicePlatform`
   - `inviteToken` when supplied
4. Save credentials and write `.overlord/project.json` exactly as `ovld onboard` does today.

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

For future login after local logout:

```bash
ovld auth login --email agent@example.com
```

The command sends a fresh email OTP/magic-link code for an existing account, verifies the code in the terminal, mints a new agent token by default, and saves that token locally for future headless use. Password login remains available only when the account has a known password, either supplied during signup from a password manager or set later through password reset.

The split request/verify subcommands are useful for agents that need to pause while another tool reads email. The single `ovld onboard --email ...` command should remain the ergonomic default.

### 5. Security and abuse controls

- Treat email OTP as the proof of inbox control. Do not bypass Supabase email confirmation.
- Recommend a password-manager-generated password during signup when the agent can access one. Do not generate an unknown durable password and hide it from the account owner.
- If no password is supplied, rely on OTP/magic-link login for future account recovery and CLI re-authentication.
- Mint an Overlord agent token after successful CLI signup/login by default. Supabase access JWTs are short-lived; refresh-token sessions are usable, but the existing `user_agent_tokens` / `oat_...` model is the cleaner durable credential for headless agents and CI. Store only the full token locally; store only its hash server-side.
- Add `--no-agent-token` for environments that explicitly want only the Supabase refresh session.
- Rate-limit signup request and verify attempts by IP and normalized email.
- Rate-limit login request and verify attempts by IP and normalized email.
- Preserve duplicate-unconfirmed behavior from `lib/actions/auth.ts`: resend a fresh confirmation email instead of failing confusingly.
- For invite tokens, keep the current single-use, expiring bearer-token model and pass the token into `cli-onboarding`; do not accept the invite during signup request.
- Log server-side signup attempts without storing OTPs or passwords.

## Implementation Plan

### Phase 1: shared validation and endpoints

- Add `cliSignupRequestSchema` and `cliSignupVerifySchema` in `lib/overlord/validation.ts`.
- Add `cliLoginRequestSchema`, `cliLoginVerifySchema`, and `agentTokenCreateSchema` in `lib/overlord/validation.ts`.
- Add `apps/web/app/api/auth/cli-signup/request/route.ts`.
- Add `apps/web/app/api/auth/cli-signup/verify/route.ts`.
- Add `apps/web/app/api/auth/cli-login/request/route.ts`.
- Add `apps/web/app/api/auth/cli-login/verify/route.ts`.
- Add `apps/web/app/api/auth/agent-token/route.ts`.
- Extract shared duplicate-unconfirmed resend behavior from `lib/actions/auth.ts` if needed so web signup and CLI signup stay aligned.
- Extract/reuse agent-token creation helpers from `lib/actions/user-agent-tokens.ts` so the server action and API route share generation, hashing, validation, and insert behavior.
- Add endpoint tests for successful signup request, duplicate unconfirmed resend, invalid payload, signup verify success, login request/verify success, unknown-account login rejection, agent-token minting, expired/invalid code, and rate limiting.

### Phase 2: CLI command helpers

- Add signup request/verify network helpers to `packages/overlord-cli/bin/_cli/auth.mjs` or a new `signup.mjs`.
- Add login request/verify network helpers for `ovld auth login --email`.
- Add an agent-token minting helper that runs after successful CLI signup/login unless `--no-agent-token` is set.
- Extend `packages/overlord-cli/bin/_cli/index.mjs` help to include `ovld auth signup`.
- Add parser support for:
  - `ovld auth signup`
  - `ovld auth signup request`
  - `ovld auth signup verify`
- Extend parser support for:
  - `ovld auth login --email <email>`
  - `ovld auth login request --email <email>` if a split login flow is useful for agents
  - `ovld auth login verify --email <email> --code <code>` if a split login flow is useful for agents
- Persist returned credentials through the existing `saveCredentials()` function.
- When an agent token is minted, persist it through the existing `agent_token` credential field so future CLI calls use the current durable-token path.
- Add CLI tests covering flag parsing, password-supplied signup, passwordless OTP signup, email OTP login, agent-token auto-mint/persistence, `--no-agent-token`, JSON mode, and error rendering.

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

1. Should CLI-native signup require a password supplied by the caller, or should generated-password be the default? **answer:** recommend a password-manager-generated password when the agent can supply one; otherwise allow passwordless OTP/magic-link signup. Do not generate an unknown hidden durable password. Future login after logout should use `ovld auth login --email` OTP/magic-link, and successful signup/login should mint and persist an `oat_...` agent token by default for durable headless auth.
2. Should `ovld auth signup` create only an account, or should the top-level command default to full onboarding? Recommendation: keep account-only under `ovld auth signup`, full provisioning under `ovld onboard --email`. **answer:** keep account-only under `ovld auth signup`, full provisioning under `ovld onboard --email`.
3. Do agents have a reliable email-reading tool in the intended environment? If yes, provide JSON output and split request/verify commands. If no, keep the interactive code prompt as the primary flow. **answer:** keep the interactive code prompt as the primary flow.

## Acceptance Criteria

- An agent can create an Overlord account from the CLI using only an email address, name, and the email confirmation code.
- The CLI receives and stores valid Supabase credentials without requiring browser signup.
- After CLI signup or email-code login, the CLI can mint and save an `oat_...` agent token for durable future headless authentication.
- After local logout, an existing agent can log back in with `ovld auth login --email ...` using a fresh email OTP/magic-link code, without needing the original signup password.
- `ovld onboard --email ...` creates or joins the correct organization, creates/reuses the project, registers the current directory, and writes `.overlord/project.json`.
- Existing browser login, device auth, OAuth loopback, and invite onboarding continue to work.
- Public signup endpoints are rate-limited and covered by tests.
