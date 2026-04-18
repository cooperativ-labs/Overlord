# GitHub Push from the Current Changes view

This document explains the new "Commit & push to GitHub" feature, the OAuth
scope change it requires, and the GitHub App / Supabase configuration you
need to update before the change takes effect in production.

## What was added

- A `PushToGithubPanel` on the **Current Changes** page. It includes:
  - A free-form commit message textarea.
  - A small sparkle (AI) icon button on the right of the textarea that calls
    Gemini 2.5 Flash to generate a commit message from the aggregate diff.
  - A "Commit & push" button that stages every change (`git add -A`),
    creates a commit, and runs `git push` against the configured upstream.
- New Electron IPC handlers:
  - `filesystem:get-aggregate-diff` — returns the repo-wide diff + short
    status used as the prompt for Gemini.
  - `filesystem:git-commit-and-push` — stages, commits, and pushes via the
    local `git` binary (honors the user's existing credentials / SSH keys).
- New server action `generateCommitMessageAction` in
  `lib/actions/generate-commit-message.ts`, backed by
  `lib/ai/generate-commit-message.ts` (Gemini 2.5 Flash).

## OAuth scope change

`linkGithubIdentityAction` (in `lib/actions/account.ts`) now requests
`user:email repo` instead of `user:email`.

The `repo` scope grants the linked GitHub token read/write access to the
user's repositories. It is required if we ever want to push via the GitHub
REST/GraphQL API (e.g. for users without a local git install). The current
push implementation uses the local `git` binary, so the new scope does not
change today's push flow — but linking the identity after this change will
return a token that *can* perform repository writes when we need it.

## What you need to update in GitHub / Supabase

Overlord uses Supabase Auth for GitHub OAuth (not a standalone GitHub App
install), so the required changes live in two places:

### 1. GitHub OAuth App (the app Supabase is configured with)

1. Go to **GitHub → Settings → Developer settings → OAuth Apps** and open
   the OAuth app Supabase uses for the `github` provider.
2. Confirm the **Authorization callback URL** points at your Supabase
   project's auth callback (`https://<project-ref>.supabase.co/auth/v1/callback`).
3. Nothing else needs to change on this screen — GitHub OAuth Apps do not
   pin allowed scopes; the scopes are requested at authorization time by
   the client (Supabase / Overlord). The newly requested `repo` scope will
   simply appear on the GitHub consent screen the next time a user links
   or re-links their GitHub account.

> If you are using a **GitHub App** (not an OAuth App), you need to add the
> following repository permissions on the app's **Permissions & events**
> page, then bump the app version so installed users are prompted to
> re-authorize:
>
> - **Contents:** Read & write
> - **Metadata:** Read-only (default, required)
>
> For commit-via-API you would also want **Pull requests: Read & write**.

### 2. Supabase GitHub provider settings

1. Open your Supabase project → **Authentication → Providers → GitHub**.
2. Ensure the **Client ID** and **Client secret** match the OAuth App above.
3. No scope field exists on this screen — scopes are passed in from the
   client via `linkIdentity({ scopes })`, which we now do with
   `user:email repo`. You do **not** need to edit anything in Supabase
   itself for the new scope to take effect.

### 3. Existing users

Existing linked identities keep their old token (with only `user:email`).
Any user who needs the new scope must disconnect and re-link their GitHub
account from **Settings → Linked Accounts**. The next auth redirect will
prompt them to grant the `repo` scope.

## Environment variables

The commit-message generator requires `GEMINI_API_KEY` in the web app's
environment (same variable used by `generate-ticket-title.ts`). If it is
missing, the sparkle button returns a friendly error and the rest of the
push flow still works.

## Push transport

Pushes go out through the local `git` CLI (`git push`) spawned by the
Electron main process. The user must therefore have:

- `git` installed on the `PATH`.
- A remote configured for the working directory.
- An upstream branch (`git push` with no arguments). If none is set, git's
  error is surfaced to the user verbatim so they can run
  `git push -u origin <branch>` once.
- Credentials configured (SSH key, credential helper, `gh auth`, etc.). The
  app does not inject any GitHub token into the git command.
