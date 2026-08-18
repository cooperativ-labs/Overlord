# Integration Credential Scoping — User vs Workspace

Status: proposed (recommendation only; no code changed)
Mission: `coo:769` — *Clarify Integration Workspace Association*
Date: 2026-08-18
Related:

- `planning/feature-plans/github-login-and-integration.md`
- `planning/feature-plans/everhour-extension-boundary.md`
- `planning/feature-plans/resource-derived-workspace-scoping.md`
- `planning/feature-plans/active-workspace-transport-retirement.md`

---

## 1. Recommendation

**Adopt the second option — the user connects to the integration once, and that
connection is reflected across every workspace they belong to — but scope it by
what the *provider* actually authenticates, not by a blanket rule.**

The correct invariant is:

> An Overlord integration record is scoped to the same subject the provider
> scoped the credential to. A credential that represents **a person** is
> profile-scoped. A credential that represents **an organization/installation**
> is workspace-scoped. Neither is where the *links* live.

That yields three distinct layers, which today are partly conflated:

| Layer | Subject | Example | Correct scope |
| --- | --- | --- | --- |
| **Provider identity** | a human at the provider | Everhour personal API key; GitHub user OAuth token | `profiles` (one active row per profile per provider) |
| **Provider tenant grant** | an account/org at the provider | GitHub App installation on a GitHub org | `workspaces` (one active row per workspace) |
| **Resource link** | an Overlord object ↔ a provider object | project ↔ Everhour project, project ↔ repo, mission ↔ task/PR | workspace + project/mission (unchanged) |

Applied to what exists today:

- **Everhour** — move the credential from workspace scope to profile scope. It
  is a personal key that Overlord currently stores in a shared place, and that
  mismatch is producing incorrect data (§3).
- **GitHub user OAuth** — already profile-scoped. No change; it is the model to
  copy.
- **GitHub App installation** — keep workspace-scoped. It is *not* a login. It
  is a grant made by a GitHub org owner over a set of repositories, and mapping
  it to the Overlord tenant is right.

The user's intuition ("GitHub sees that *I* log into Overlord, not that I log
into workspace 1 and workspace 2") is correct for everything in the identity
layer, and the codebase already agrees with them for GitHub — the gap is
Everhour, plus a UI that presents both layers in one undifferentiated
"Integrations" panel.

---

## 2. Current state

### 2.1 Storage

| Table | Scope key | Contents | Uniqueness |
| --- | --- | --- | --- |
| `ext_everhour_workspace_connections` | `workspace_id` | `api_key_secret`, `account_id`, `account_name` | one active row per workspace |
| `ext_github_installations` | `workspace_id` | `github_installation_id`, `github_account_login`, permissions | one active row per workspace |
| `ext_github_user_connections` | `profile_id` | AES-256-GCM access/refresh ciphertext, `github_user_id`, `github_login`, scopes | one active row per profile **and** per GitHub user |

`ext_everhour_project_links`, `ext_everhour_mission_links`,
`ext_github_project_links`, and `ext_github_mission_pull_requests` are all
`(workspace_id, project_id | mission_id)`-keyed. Those are resource links and
are correctly scoped in every option below.

### 2.2 Routes and authorization

- `GET|PUT|DELETE /ext/everhour/integration` — gated on `workspace:read` /
  `workspace:update` against the **ambient** workspace
  (`backend/ext/everhour/routes.ts:34-51`).
- `GET /ext/github/integration`, `POST /ext/github/install`,
  `DELETE /ext/github/integration` — same ambient-workspace shape
  (`backend/ext/github/routes.ts:58-82`).
- `GET|POST|DELETE /ext/github/user-connection`, `GET /ext/github/repository-owners`
  — **no** `requires:` permission and no workspace at all; they resolve
  `resolveActiveProfileId()` and act account-wide
  (`backend/ext/github/routes.ts:34-57`, `backend/ext/github/user-oauth.ts:213+`).

### 2.3 UI

`webapp/web/components/settings/SettingsModal.tsx:52-58` puts **Integrations**
in the *Application* nav group of the per-user Settings modal, next to Profile,
Account, and Tokens. The panel itself
(`webapp/web/components/settings/IntegrationsPage.tsx:77`) says "Credentials
are stored on this workspace", and the Everhour help text
(`:150`) tells the user to fetch the key from **their own Everhour profile**.
So the surface simultaneously reads as personal (its location, and where the
secret comes from) and as shared (where it is stored).

`webapp/web/components/projects/project-settings/IntegrationsPage.tsx:105`
completes the loop: when a project's workspace has no key it tells the user
"No Everhour API key is configured for this workspace. Set one in
Settings → Integrations."

---

## 3. Why the current Everhour scoping is not just a modelling preference

These are consequences of the shared-credential model that exist today, not
hypotheticals.

1. **Time is attributed to the wrong person.** Every Everhour write uses the
   single workspace key, and Everhour attributes writes to the key's owner:
   `startMissionTimer` posts `/timers` (`backend/ext/everhour/service.ts:960-966`)
   and `addMissionTime` posts `/time` with **no `user` field**
   (`:1087-1107`). In any workspace with more than one member, all tracked time
   accrues to whoever pasted the key. For a time-tracking integration this is a
   data-correctness defect, not an ergonomics one.

2. **Members see and can stop each other's timer.** Timer state is read from
   `/timers/current` on the shared key (`:899`, read via `getMissionEverhourState` at `:932-934`), which is the key owner's
   timer. Member B's "running" indicator reflects member A's work, and B's
   stop button posts `DELETE /timers/current` against it (`:973`).

3. **A personal secret carries workspace blast radius.** Anyone with
   `workspace:update` can replace or clear the connection, and the key that gets
   replaced is a specific human's personal Everhour credential — usable for
   everything that human can do in Everhour, not only for Overlord's projects.
   Contrast the deliberate isolation applied to the GitHub user token
   (encrypted at rest, never in DTOs/logs/realtime, revocable only by its owner).

4. **A second workspace's key is unreachable from the UI.** Active-workspace
   selection was removed from request transport
   (`planning/feature-plans/active-workspace-transport-retirement.md`), so the
   ambient workspace is now whatever `ensureWorkspaceUser` picks by default:
   the caller's **oldest** active membership
   (`backend/auth.ts:151-162`, applied at `:190-192` and `:215-218`). Settings →
   Integrations therefore always reads and writes the first workspace the user
   ever joined. A user in workspaces A (older) and B who opens a project in B is
   told to "set one in Settings → Integrations" — and that page cannot set it.
   Option A below does not work at all until this is fixed; Option B removes the
   need to fix it for this surface.

5. **Everhour project membership is per-person anyway.** Everhour returns 403 on
   task/section creation in a project the API user is not a member of, which the
   code already works around by adding the key owner to the linked Everhour
   project (`backend/ext/everhour/service.ts:533-552`) and by special-casing "a
   member-level API key" in the 403 handler (`:770-786`). The provider's own
   model is per-user; the shared key merely hides that from Overlord.

6. **The Overlord↔provider mental models do not line up.** Overlord workspaces
   have no counterpart in Everhour, and only a partial one in GitHub (a GitHub
   org). Neither provider can express "this human, but only when acting in
   workspace 1", so making the user assert it N times buys no enforcement.

Nothing equivalent applies to the GitHub App installation: it is one grant made
by one GitHub account owner over a repository set, it is not a person, and it is
already the right shape.

---

## 4. The two options, evaluated

### Option A — the user logs each Overlord workspace into the integration

Each workspace holds its own credential; the same human re-authorizes per
workspace with the same provider account.

**In favor**

- Per-workspace isolation of the credential and its blast radius: leaving
  workspace A cannot affect workspace B's integration.
- A workspace admin can guarantee an integration exists for the whole workspace
  without depending on any individual finishing a personal setup step —
  relevant if unattended/automated writes are ever added.
- Different providers/accounts per workspace fall out naturally (client work in
  one Everhour account, internal work in another).

**Against**

- Does not fix §3.1–§3.3 at all: a workspace credential is still one person's
  identity used for everyone's writes, so time attribution stays wrong.
- Requires fixing §3.4 first (a way to address a specific workspace from the
  settings surface) before it is even usable in a multi-workspace org.
- N× the setup, and N× the re-paste on every key rotation or token expiry, for
  the same human and the same provider account.
- Contradicts the direction already set for GitHub user OAuth and the
  account-wide route family added in contract `31`/`33`.

### Option B — the user logs into the integration once, reflected everywhere (recommended)

One profile-scoped credential per user per provider; every workspace the user
belongs to uses *that user's own* credential for *that user's own* actions.

**In favor**

- Matches what the provider sees. GitHub and Everhour authenticate a person;
  Overlord stops pretending otherwise.
- Fixes attribution: each member's timers and time entries land on their own
  Everhour user, with no `user`-impersonation field required.
- Fixes the shared-secret problem: a personal key is owned, rotated, and revoked
  by its owner, like the GitHub user token already is.
- Sidesteps §3.4 entirely — the settings surface is account-wide, so there is no
  ambient workspace to get wrong. This is the same shape as the existing
  `/ext/github/user-connection` routes and satisfies invariant 7 of the
  active-workspace retirement plan ("when an operation is genuinely
  profile-global, nullable workspace attribution is preferable to a fabricated
  default workspace").
- One setup, one rotation, N workspaces.
- Precedent already exists in the schema for personal-record → workspace-catalog
  layering (`user_harness_extensions` / `workspace_harness_extensions`), and for
  per-user vs per-workspace pairs (`user_execution_target_preferences` /
  `workspace_user_execution_targets`).

**Against (and how it is handled)**

- *A workspace can no longer guarantee coverage.* Handled: the workspace-scoped
  **project link** remains the enablement signal ("this project tracks time in
  Everhour project X"), and a member who has not connected gets a clear
  "Connect Everhour in Settings" prompt on the timer control instead of a broken
  or misattributed write.
- *One key across workspaces means one Everhour account across workspaces.* True,
  and acceptable for v1: a user with genuinely separate provider accounts per
  client is a real but secondary case. Multiple named connections per profile,
  with a per-workspace or per-project choice among them, is a strictly additive
  follow-up (§6).
- *Unattended writes have no human actor.* Not a live problem: the whole
  `/ext/everhour` router sits behind `requireAuthenticatedSession`
  (`backend/index.ts:1570`) and nothing in `backend/` or `automations/` calls the
  service outside that path. It only becomes a question if agents are ever given
  timer control, at which point the workspace service connection is reintroduced
  deliberately, as a *service account*, not as a person's key.

### Recommended synthesis

Option B for the identity layer; keep the workspace record only where the
provider's subject really is the tenant.

| Integration | Subject the provider authenticates | Scope |
| --- | --- | --- |
| Everhour API key | a person | **profile** (change) |
| GitHub user OAuth | a person | profile (already) |
| GitHub App installation | a GitHub org/account | workspace (keep) |
| Everhour / GitHub project + mission links | an Overlord object | workspace + project/mission (keep) |

---

## 5. What implementing this would involve

Sketch only — sizing, not a build plan. Each step is additive before anything is
removed.

1. **Schema.** Add `ext_everhour_user_connections` (`profile_id` FK to
   `profiles` `ON DELETE CASCADE`, `api_key_secret`, `account_id`,
   `account_name`, `last_validated_at`, standard `created_at`/`updated_at`/
   `deleted_at`/`revision`; unique active `(profile_id)`). Mirror the encryption
   treatment already applied to `ext_github_user_connections` rather than
   copying Everhour's current plaintext `api_key_secret` column — the credential
   is moving into the "personal secret" class, so it should get that class's
   protection. Keep `ext_everhour_workspace_connections` readable during
   migration, then drop it.

2. **Service.** Change `requireApiKey(workspaceId)` to
   `requireApiKey()`/`requireActorApiKey()` resolving from
   `resolveActiveProfileId()`. Every current call site already runs under an
   authenticated actor. Add a lazy "ensure the acting Everhour user is a member
   of the linked Everhour project" step on the write paths, reusing the
   membership backfill that `resolveEverhourProject` already performs at link
   time (`service.ts:533-552`) — under per-user keys this must run for whoever
   is acting, not only for whoever linked the project.

3. **Routes.** Add account-wide `GET|PUT|DELETE /ext/everhour/user-connection`
   with no `requires:` permission, matching `/ext/github/user-connection`. Retain
   `/ext/everhour/integration` as a deprecated read during the transition.

4. **UI.** Split the Integrations panel into "Your accounts" (Everhour key,
   GitHub user connection) and "Workspace" (GitHub App installation, which
   should name the workspace it applies to). Replace the "Credentials are stored
   on this workspace" copy, which will be true of only one of the two groups.
   Update the project-settings pointer at
   `project-settings/IntegrationsPage.tsx:105` to say the acting user has not
   connected Everhour, not that the workspace has not.

5. **Migration of existing rows.** The workspace table records no owner, but
   `entity_changes` captures `actor_workspace_user_id` and the connect mutation
   emits a change row, so the original connector is recoverable where that row
   survives; backfill a personal connection for that profile only when the
   attribution is unambiguous, and otherwise prompt each user to connect. Do
   **not** silently adopt a workspace key into some other member's profile — that
   would hand one person's credential to another under their own name.

6. **Contract.** This changes an external-facing surface, so it needs a
   `CONTRACT.md` version entry and a `contract/components.yaml` update in the
   same shape as entries `31`/`33` for the GitHub user connection, plus the
   `ext_everhour_*` section of `database/docs/09-database-schema-contract.md`.
   Modules affected: `backend` (ext routes/service), `database` (migrations, both
   Postgres and SQLite), `packages/contract` (`ext/everhour` DTOs), `webapp`
   (settings + project settings + query keys/invalidation). The CLI, MCP,
   automations, and connector surfaces do not touch Everhour and are unaffected.

---

## 6. Deferred

- **Multiple named connections per profile** with a per-workspace or per-project
  selection. Strictly additive to the model above; only needed once someone has
  genuinely separate provider accounts per client.
- **Workspace service accounts** for unattended/agent-initiated writes. Introduce
  only when an agent path actually needs to write to a provider; the credential
  should then be an explicit service identity, not a member's personal key.
- **Provider-side org ↔ workspace mapping for Everhour.** Everhour has one team
  per account and no sub-tenant concept, so there is nothing to map today.
