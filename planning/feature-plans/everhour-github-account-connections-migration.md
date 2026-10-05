# Move Everhour and GitHub onto the shared account-connections module

Mission: coo:1110 · Objective: coo:1110.papq (planning only, no product code changed)
Prerequisite: coo:1108 shared account-connections module. Shipped in `0c5b91d5` (contract v152), with Knowledgebase as its first provider.
Follow-on objectives: `j8ny` (Everhour), `ykk0` (GitHub personal authorization), `ywx9` (web and mobile connected-accounts experience).

Out of scope: the workspace-scoped GitHub App installation (`/ext/github/integration`, `/install`, `/callback`, `/repos`, project links, pull requests) and composite project initialization. Neither changes.

---

## 0. Summary

The shared module (`backend/connections/`) owns sign-in, storage, encryption, refresh and disconnect for **one** provider, Knowledgebase. As built it is tied to that provider in several ways that block a straight move:

- **Scope.** A connection belongs to a profile *inside one organization*. Everhour and GitHub personal connections belong to the profile across every organization.
- **Edition.** `/api/connections` is Cloud-only (404 `chat_unavailable` on Local). Everhour and GitHub personal connections work on both editions today.
- **Credential kind.** The module supports OAuth only (a public PKCE client with Knowledgebase discovery). Everhour uses a static API key. GitHub uses a confidential OAuth client with a fixed, already-registered callback path.
- **Keys and binding.** The module uses one key (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, id `k1`) and binds envelopes to `(profile, organization, provider, connection id)`. The Everhour and GitHub envelopes use the same `v1` format, but different keys and different bindings (AAD). The module cannot open them as they are.

The plan has five parts:

1. Generalise the module rather than fork it. Add a **profile scope** (nullable `organization_id`) and a **provider registry** with an OAuth adapter and an API-key adapter.
2. Replace the single key with a **key ring** that has a `credential_format` column. Existing envelopes can then be **adopted in place**: the bytes are copied verbatim by a plain SQL migration on both editions, with no key needed at migration time. Each envelope is **re-sealed lazily** under the current key on first use, with a sweep later.
3. Keep the existing environment keys working: they become per-provider fallback keys in the key ring.
4. Turn on the profile-scoped providers on Local while Knowledgebase stays Cloud-only.
5. Keep every existing `/ext/everhour` and `/ext/github` connection route as a thin alias over the shared service, until telemetry shows no older clients still call them.

All of this lands as **one contract bump (v153)** at the start of objective `j8ny`. That covers both providers, so the SQLite table rebuild happens once.

---

## 1. What the shared module provides as built, and the gaps

### 1.1 As built (verified by reading the code)

| Concern | Where | Behaviour |
| --- | --- | --- |
| Store | `account_connections`, `account_connection_authorizations` (`20261004120000_chat_conversations.sql`, both editions) | One live row per `(owner_profile_id, organization_id, provider, server_url)`. States are `pending`, `connected`, `reauthorization_required` and `disconnected`. Holds one `credential_ciphertext` plus `credential_key_id`, with refresh lease columns and `credential_revision`. The CHECK constraint `provider IN ('knowledgebase')` exists on both editions, and `organization_id` is `NOT NULL`. |
| Envelope | `backend/connections/crypto.ts` | `sealSecret` / `openSecret`: AES-256-GCM, `v1.<nonce>.<tag>.<ct>` base64url, with caller-supplied AAD. **Everhour (`ext/everhour/crypto.ts`) and GitHub (`ext/github/user-oauth.ts`) already call these primitives** (also changed in `0c5b91d5`). `hashSecret` is SHA-256 hex for state. |
| Binding | `service.ts` `credentialAad` | `overlord:account-connection:v1:<profile>:<org>:<provider>:<id>` over the JSON `{accessToken, refreshToken}`. |
| Keys | `config.ts` | `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` (32 bytes, base64url) and `…_KEY_ID` (default `k1`). `accessToken()` treats any row whose key id differs from the current key as `credential_unreadable`: it erases the credential and sets `reauthorization_required`. |
| OAuth | `oauth.ts` `KnowledgebaseOAuth` | RFC 9728/8414 discovery, PKCE S256, RFC 8707 `resource`, a public client through a Client ID Metadata Document, and RFC 7009 revoke. Everything is tied to Knowledgebase configuration. |
| Lifecycle | `service.ts` `AccountConnections` | `list`, `start` (hashed single-use state, encrypted PKCE verifier, 10-minute TTL, at most 5 open sign-ins), `complete` (consume, exchange, store), `disconnect` (erase first, then best-effort revoke, then `onAccessLost`), `accessToken` (lease-serialised refresh, rotated credential persisted before use) and `requireReauthorization`. `start` and `complete` hard-code `'knowledgebase'` and the Knowledgebase server URL. |
| Routes | `routes.ts`, mounted in `backend/index.ts:642-710` | Authenticated `GET`/`POST /api/connections` and `DELETE /api/connections/:id`. Public `GET /api/connections/knowledgebase/callback` and `/oauth/clients/knowledgebase.json`. Gated by `chatCloud()` (Postgres or `backendMode === 'cloud'`). The owner must have an active organization. Error bodies use `ChatError` codes. |
| Return targets | `config.ts` | Fixed: mobile `overlord://connections/callback`, web `<OVERLORD_WEBAPP_PUBLIC_URL>/settings/connections`, otherwise a status page. Only `provider` and `status` are carried. |
| DTOs | `packages/contract/src/chat.ts:700-744` | `AccountConnectionDto` has a non-null `organizationId`, `serverUrl`, `state`, Knowledgebase-specific `authorizedWorkspaces` and `toolPolicyVersion`, and `lastErrorCode`. `StartAccountConnectionBody` is `{provider, returnTo: 'mobile' \| 'web'}`. |

### 1.2 Gaps for Everhour (static API key)

| # | Gap | Resolution |
| --- | --- | --- |
| E1 | The connection is profile-wide, but the module requires an organization. | Add profile scope: `organization_id` becomes nullable, with a CHECK that ties the scope to the provider (§6). |
| E2 | There is no API-key credential kind. `start` only does OAuth. | Add `POST /api/connections/api-keys` `{provider, apiKey}` → `AccountConnectionDto`. The provider adapter validates the key upstream first (Everhour `GET /users/me`), then the module seals and stores it. Reconnecting or rotating the key is the same call. |
| E3 | There is no external-account metadata (Everhour `account_id`, `account_name`). | Add generic columns `external_account_id`, `external_account_label`, `external_account_avatar_url`, `granted_scopes_json` and `last_validated_at`, and expose them as `account` and `scopes` in the DTO. |
| E4 | Key: the module reads only `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`. Everhour uses `EVERHOUR_API_KEY_ENCRYPTION_KEY`, falling back to `GITHUB_USER_TOKEN_ENCRYPTION_KEY`. | Use a key ring with a per-provider fallback (§2.3). |
| E5 | The module is Cloud-only. Everhour works on Local. | Gate availability per provider (§5). |
| E6 | Upstream 401 semantics. Today a stored key that no longer works still reports `connected: true` (`getEverhourIntegration`). | Parity first: Everhour does **not** move to `reauthorization_required` on an upstream 401 in `j8ny`. Timer behaviour must not change. See decision D3. |
| E7 | Legacy workspace-key adoption (`adoptUnambiguousWorkspaceConnection`) writes `ext_everhour_user_connections`. | Point it at the module (`connections.adoptApiKey(...)`). The adoption rule stays the same: an unambiguous `entity_changes` actor. |
| E8 | Clearing the key only soft-deletes. The ciphertext stays in the deleted row, and adopted workspace rows keep **plaintext** `api_key_secret` after soft delete. | The module's disconnect erases the credential. The migration scrubs soft-deleted legacy ciphertexts, and plaintext in adopted (soft-deleted) workspace rows (§2.5). |

### 1.3 Gaps for GitHub personal authorization (OAuth with single-use state and callback)

| # | Gap | Resolution |
| --- | --- | --- |
| G1 | The connection is profile-wide. | Profile scope, as for E1. |
| G2 | Confidential client. GitHub uses `GITHUB_CLIENT_ID`/`SECRET` (shared with Better Auth login), not a metadata document, and has no discovery. | An OAuth adapter interface: `authorizeUrl(state, challenge)`, `exchangeCode`, `refresh`, `revoke`, `describeAccount(token)` and `validateGrant(tokens)`. The Knowledgebase adapter wraps today's `KnowledgebaseOAuth`. The GitHub adapter wraps today's `exchangeOAuthToken`, `revokeUpstreamToken` and `/user`. |
| G3 | **Fixed callback.** `/api/auth/callback/github/repository` is a subpath of the registered login callback and must run **before** the Better Auth `/api/auth/*` wildcard. | Callback paths come per provider from the adapter. The module exports `connectionCallbackHandler(provider)`. `index.ts` mounts the GitHub handler at the existing path, in the existing place (line 492). Knowledgebase keeps `/api/connections/knowledgebase/callback`. |
| G4 | Distinct explicit grant: `repo read:org`, with `allow_signup=false`. The callback rejects a grant without both scopes. | Implement `validateGrant` in the adapter. On failure the callback status is `failed`, `lastErrorCode = insufficient_scope`, and no credential is stored. |
| G5 | One GitHub account per Overlord profile (`idx_ext_github_user_connections_github_user_active`; 409 today). | Partial unique index on `(provider, external_account_id) WHERE provider = 'github' AND state <> 'disconnected'`. A collision gives callback status `failed` with `lastErrorCode = account_in_use`. |
| G6 | Arbitrary return URL. Today `returnTo` is any allowed browser origin URL or `overlord://github/callback`, and success appends `githubConnection=connected`. The shared module only knows `mobile` and `web`. | Add a nullable `return_url` to `account_connection_authorizations`. Only the legacy alias route sets it, and keeps today's validation (`validatedReturnUrl`) and the `githubConnection=<status>` query. New clients use `returnTo` plus an optional validated relative `returnPath` (web only, starting with `/` and not `//`), stored in the same column. |
| G7 | PKCE. The `pkce_verifier_ciphertext` column is `NOT NULL`. | Always generate and store a verifier, and send `code_challenge` and `code_verifier`. GitHub support for PKCE on OAuth Apps is **not verified** here. Unknown parameters are ignored, so this is safe either way. Verify in `ykk0`. |
| G8 | Two envelopes (access and optional refresh, each with its own AAD). The module uses one JSON envelope. | The `credential_format` for adopted rows (§2.2). Re-sealing converts the row to the standard single envelope. |
| G9 | Identity re-check on use (`/user` id must equal the stored `github_user_id`). | Stays in the GitHub extension. It reads `external_account_id` from the module's row accessor, and a mismatch calls `requireReauthorization(id, 'identity_changed')`. |
| G10 | GitHub's token endpoint signals errors in the body (the existing code treats a missing `access_token` as failure regardless of HTTP status). | The adapter maps body `error=bad_refresh_token` or `bad_verification_code` to `OAuthError('invalid_grant')`, and anything else to `unavailable`. |
| G11 | Today's disconnect revokes upstream first, then sets `access_token_ciphertext = 'revoked:v1'` and soft-deletes. | The module erases first and revokes best-effort afterwards. This is stricter, and the old behaviour is preserved in effect. |

### 1.4 Gaps common to both

- **Owner type.** `ChatOwner {profileId, organizationId}` becomes `ConnectionOwner {profileId, organizationId: string | null}`. The membership check (`ChatStore.access`) runs only for organization-scoped providers.
- **`onAccessLost`** (chat revalidation) runs only for providers that are chat sources (Knowledgebase).
- **Error codes.** The module throws `ChatError`. Add `credential_rejected` (422, API key refused upstream) and `provider_not_available` (404, this provider is not offered on this edition). Keep `provider_not_ready` (503, a key or provider configuration is missing).

---

## 2. Data migration (SQLite and Postgres)

### 2.1 Can stored envelopes be adopted in place?

**Not by the module as it stands.** AES-GCM authenticates the AAD. The legacy AADs (`overlord:everhour-user-key:v1:<profile>:api-key` and `overlord:github-user-oauth:v1:<profile>:access|refresh`) and the legacy keys differ from the module's, so `openSecret` with the module's AAD fails. Rewriting the AAD requires decrypting.

**They can be adopted in place once the module learns the legacy formats.** Recommendation:

- Copy the legacy envelope bytes **verbatim** in a SQL migration, labelled with a `credential_format` and a legacy `credential_key_id`. The migration needs no key, runs identically on both editions, and never has plaintext in flight.
- The module opens legacy formats through a small format table (format → AAD builder + payload parser). The legacy AAD binds only `profile_id`. The adopted row keeps `owner_profile_id` equal to that profile, so the binding still holds: an envelope copied to another owner's row still fails authentication.
- **Lazy re-seal:** on the first successful open of a legacy-format row, if a current key is configured, `accessToken()` re-seals it to `connection-v1` (standard AAD, JSON payload) under the current key. This happens in the same revision-guarded `UPDATE` that rotation uses (`credential_revision + 1`).
- A bounded, idempotent **re-seal sweep** runs at backend start, when a current key exists, and finishes the remaining rows. It logs counts only.

Re-encrypting inside the migration was rejected. It would need both keys in the migration runner, it cannot run on Local without a configured key, and it would put plaintext credentials into migration code paths.

### 2.2 Schema changes (one migration per edition, `2026101xxxxxxx_account_connections_profile_scope.sql`)

`account_connections`:

- `organization_id`: nullable.
- `provider`: `CHECK (provider IN ('knowledgebase', 'everhour', 'github'))`.
- New CHECK `((provider = 'knowledgebase') = (organization_id IS NOT NULL))`. Knowledgebase stays organization-scoped. Everhour and GitHub are profile-scoped.
- New `credential_format text NOT NULL DEFAULT 'connection-v1' CHECK (credential_format IN ('connection-v1', 'everhour-user-key-v1', 'github-user-oauth-v1'))`.
- New `credential_kind text NOT NULL DEFAULT 'oauth' CHECK (credential_kind IN ('oauth', 'api_key'))`.
- New `external_account_id`, `external_account_label`, `external_account_avatar_url`, `granted_scopes_json` (JSON, default `[]`) and `last_validated_at` (ISO timestamp, with the same GLOB check on SQLite).
- Indexes:
  - Keep `idx_account_connections_live` for organization-scoped rows.
  - Add `idx_account_connections_profile_live ON (owner_profile_id, provider, server_url) WHERE state <> 'disconnected' AND organization_id IS NULL`. NULLs are distinct in unique indexes on both engines, so the existing index cannot enforce this.
  - Add `idx_account_connections_github_account_live ON (provider, external_account_id) WHERE provider = 'github' AND state <> 'disconnected'`.

`account_connection_authorizations`: new nullable `return_url`.

**Postgres:**

- `ALTER COLUMN organization_id DROP NOT NULL`.
- Drop and re-add the provider CHECK. Its name is auto-generated, so look it up through `pg_constraint`, or name it explicitly in the migration.
- `ADD COLUMN …` and `CREATE UNIQUE INDEX …`.

**SQLite** cannot alter a CHECK or `NOT NULL`, so the table must be rebuilt:

- Create `account_connections_v153`, copy the rows, drop the old table, rename, and recreate the indexes.
- `account_connection_authorizations.connection_id` (`ON DELETE CASCADE`) and `chat_source_refs.connection_id` (`ON DELETE SET NULL`, line 88) reference this table. The rebuild must run with `PRAGMA foreign_keys = OFF` and `PRAGMA legacy_alter_table` handled, then `PRAGMA foreign_key_check`.
- **Verify that the SQLite migration runner allows toggling `foreign_keys` inside its transaction.** `PRAGMA foreign_keys` is a no-op inside a transaction. I did not check how the runner wraps migrations. If it always wraps them, use the runner's established rebuild mechanism, or have the migration create the new table under the original name through the "12-step" procedure the runner supports.
- `account_connection_authorizations` gets `ADD COLUMN return_url TEXT`, which needs no rebuild.

### 2.3 Key ring and preserving the existing environment keys

`ConnectionsConfig.encryption` becomes a key ring. Each entry has an `id` and a 32-byte `key`:

| Key id | Source | Used by |
| --- | --- | --- |
| `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID` (default `k1`) | `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` | Current key for every provider |
| `everhour-env` | `EVERHOUR_API_KEY_ENCRYPTION_KEY` ?? `GITHUB_USER_TOKEN_ENCRYPTION_KEY` (the exact fallback order in today's `everhourEncryptionKeyFromEnv`) | Opening adopted Everhour rows. Write fallback for Everhour when there is no current key. |
| `github-user-env` | `GITHUB_USER_TOKEN_ENCRYPTION_KEY` | Opening adopted GitHub rows. Write fallback for GitHub when there is no current key. |

Rules:

- **Write key:** the current key if configured. Otherwise the provider's fallback key (Everhour → `everhour-env`, GitHub → `github-user-env`, Knowledgebase → none, which gives `provider_not_ready` as today). New writes always use the `connection-v1` format. A deployment that has only `GITHUB_USER_TOKEN_ENCRYPTION_KEY` today (the only key `.railway/railway.ts` lists for production) keeps working without a new secret.
- **Open:** look up `credential_key_id` in the ring and `credential_format` in the format table.
- **Missing key id:**
  - For a `connection-v1` row under the current-key id scheme, keep today's behaviour: `credential_unreadable`, erase, `reauthorization_required`.
  - For a legacy-format or env-fallback key id, answer `unavailable` (503) **without erasing**. This matches today's 503 "encryption is not configured". Restoring the env var restores access, so no user reconnects because an operator temporarily removed a variable.
- **Authentication failure** with the key present is real corruption or a rotated key. Both formats get `credential_unreadable`, then reauthorization.
- **Re-seal target:** the current key only. Rows never move from one env-fallback key to another.
- **Retiring legacy keys** (phase 5) is safe once `SELECT COUNT(*) FROM account_connections WHERE credential_key_id IN ('everhour-env', 'github-user-env') AND credential_ciphertext IS NOT NULL` returns 0. Expose this as a startup log line and an operator check.

### 2.4 Row copy (inside the same migration, idempotent)

**Everhour.** From `ext_everhour_user_connections WHERE deleted_at IS NULL`, insert when no `account_connections` row exists for `(profile_id, 'everhour')` in **any** state:

- `id` = the legacy `id`
- `owner_profile_id` = `profile_id`, `organization_id = NULL`
- `provider = 'everhour'`, `server_url = 'https://api.everhour.com'`
- `state = 'connected'`, `credential_kind = 'api_key'`
- `credential_ciphertext = api_key_ciphertext`, `credential_key_id = 'everhour-env'`, `credential_format = 'everhour-user-key-v1'`, `credential_revision = 1`
- `external_account_id = account_id`, `external_account_label = account_name`
- `last_validated_at`
- `connected_at = created_at`, `created_at`, `updated_at`, `revision = 1`
- `tool_policy_version = 1` (unused), `authorized_workspaces_json = '[]'`

> **As built in `j8ny` (2026-10-05):** the v153 migration (`20261005120000_account_connections_profile_scope`) widens the schema for both providers but copies **only Everhour** rows. The GitHub copy below moves to `ykk0` as its own forward migration, which needs no table rebuild. Until `ykk0`, GitHub's legacy routes still write `ext_github_user_connections`. A copy made now could outlive a later legacy disconnect, and the module would then hold a credential the user removed. The `github-user-oauth-v1` opener and the `github-user-env` key-ring entry already exist in `backend/connections/keyring.ts`.

> **As built in `ykk0` (2026-10-05):** the GitHub copy is migration `20261005130000_account_connections_github_adoption` (both editions, no rebuild). Beyond the rules below it also skips a GitHub account already live on another profile, and skips legacy rows whose access ciphertext is already `revoked:v1`. Contract changes were made inside v153 (still unreleased) rather than as a v154 bump, following D2. Behaviour differences from pre-v153, all documented in CONTRACT.md v153:
> - A failed or expired callback that started from the legacy alias now redirects to its `returnTo` with `githubConnection=<status>`. Before, only success redirected and failures returned a JSON error. Mobile ignores the query and refreshes either way.
> - A legacy `authorize` call without `returnTo` returns to the web Connected accounts page when a web origin is configured. Before, it showed the status page. No client was found that omits `returnTo`.
> - An unreadable stored token now requires reconnecting (401 "Reconnect GitHub…"). Before, it returned 503 "cannot be decrypted". An upstream 401 is retried once after a forced refresh and then requires reconnecting. A changed `/user` identity requires reconnecting (`identity_changed`).
> - GitHub PKCE (G7) is sent on every sign-in. GitHub's acceptance of it was verified only against a fake token endpoint, not against github.com.

**GitHub.** From `ext_github_user_connections WHERE deleted_at IS NULL`, the same pattern, except:

- `server_url = 'https://github.com'`
- `credential_ciphertext` = the JSON object `{"access": <access envelope>, "refresh": <refresh envelope or null>}` (Postgres `json_build_object(...)::text`, SQLite `json_object(...)`)
- `credential_key_id = 'github-user-env'`, `credential_format = 'github-user-oauth-v1'`
- `access_expires_at`, `refresh_expires_at`
- `external_account_id = github_user_id`, `external_account_label = github_login`, `external_account_avatar_url = avatar_url`
- `granted_scopes_json = scopes_json`

**Type notes:**

- Postgres timestamptz columns copy directly.
- On SQLite, legacy timestamps come from `nowIso()` (`toISOString`), so they match the `????-??-??T??:??:??.???Z` GLOB. **Test this with real fixture rows**, and fail the migration loudly rather than dropping rows.
- `scopes_json` is jsonb on Postgres. The target `granted_scopes_json` should be the same type per edition.

**Why reuse the legacy ids:** traceability, and the idempotent `NOT EXISTS` guard. The guard is on "no row in any state" so that a user who disconnected in the new code is never resurrected by a later re-run or by lazy adoption.

**Pending OAuth states** (`ext_github_user_oauth_states`, 10-minute TTL) are not migrated. A sign-in in flight across the deploy lands on the "expired" status page and the user retries. This affects at most a 10-minute window. Existing connections are unaffected.

### 2.5 Transition safety

- **Lazy adoption for one release:** when the module finds no row for `(profile, everhour | github)` in any state, it runs the same copy for that profile from the legacy table. This catches rows written by an old instance during a deploy overlap (Railway runs one replica, so the overlap is short) and by Local users who skip a version. Remove it in phase 5.
- **Write-through tombstone:** a disconnect in the new code also soft-deletes the matching legacy row and overwrites its ciphertext with `'revoked:v1'` (both legacy columns are `NOT NULL` and non-empty). A rollback to the previous release then cannot resurrect a credential the user removed. New connects are *not* written back to legacy tables. After a rollback, a user who connected for the first time after the upgrade would need to reconnect. That is acceptable and documented.
- **Scrub in the migration:**
  - Set `api_key_ciphertext = 'revoked:v1'` on soft-deleted Everhour user rows.
  - Set `access_token_ciphertext = 'revoked:v1', refresh_token_ciphertext = NULL` on any soft-deleted GitHub rows not already scrubbed.
  - Overwrite `api_key_secret` on soft-deleted (already adopted) `ext_everhour_workspace_connections` rows. Check that column's constraints in `j8ny`. I did not read its DDL.
  - Live, ambiguous workspace rows keep plaintext at rest. That is pre-existing and is recorded as deferred work.
- **Legacy tables stay** (read-only for the new code) until phase 5. Phase 5 tombstones and scrubs all legacy rows, then drops the tables in a later contract version.

---

## 3. Compatibility aliases under `/ext/everhour` and `/ext/github`

Every legacy route keeps its exact request and response shape. It becomes a thin adapter over the module: the extension maps `AccountConnectionDto` to the legacy DTO. Treat `connected` as true when `state` is `connected`. For GitHub, also report `reauthorization_required` as `connected: false`, so the existing reconnect UI appears.

| Route | Clients today (verified by grep) | Status | Retire when |
| --- | --- | --- | --- |
| `GET/PUT/DELETE /ext/everhour/user-connection` | Web `lib/api/everhour.ts`. Mobile has no Everhour client. | Alias | Web moves to `/api/connections` in `ywx9`. Desktop bundles the shared SPA, so older desktop builds pointed at a newer Cloud backend still call it. Retire after the alias telemetry below reaches zero. |
| `GET/PUT/DELETE /ext/everhour/integration` | None found in web or mobile. Deprecated alias since v90. | Alias | First to retire: one release after `ywx9`, once telemetry shows zero hits. |
| `GET /ext/github/user-connection`, `POST /ext/github/user-connection/authorize` | Mobile `APIClient.swift:174-186` (project creation, `returnTo = overlord://github/callback`). No web client. | Alias. `authorize` keeps `returnTo` URL semantics through `return_url` (G6). | After an OverlordMobile release that uses `/api/connections` has shipped **and** at least 90 days with zero alias hits from mobile user agents. App Store builds update slowly, and I found no forced minimum-version gate (not verified). |
| `DELETE /ext/github/user-connection` | No client found. | Alias | With the other GitHub aliases. |
| `GET /api/auth/callback/github/repository` | GitHub OAuth App registration | **Canonical, not an alias.** The provider callback path stays permanently. | Never, unless the OAuth App registration changes. |
| `GET /ext/github/repository-owners` | Mobile | Feature route, unchanged. It reads its token through the module. | n/a |

**Telemetry:** each alias handler increments an in-process counter and logs once per hour: route, client family from `User-Agent` / `X-Overlord-Client`, and a count. It logs no identifiers or credentials. Removal is a separate contract change that lists the routes it removes.

---

## 4. The unified connected-accounts experience

There is one place: **Connected accounts**.

**Web.**

- `/settings/connections` becomes a real page. Today it redirects to `/chat`.
- It lists `GET /api/connections?scope=all`, one row per offered provider (Knowledgebase, GitHub, Everhour). Each row shows the provider name, account label and avatar, and a status chip: Connected, Needs reconnecting, Not connected, Not available on this server, or Not configured on this server. Each row has **Connect** or **Reconnect** and **Disconnect** (with confirmation), and each provider behaves the same way.
  - Knowledgebase and GitHub open `authorizeUrl` in a tab.
  - Everhour opens an inline API-key field (password input, never echoed back). Errors from `credential_rejected` appear inline.
- The callback lands back here (`?provider=&status=`), shows a toast, and reloads the list. A validated `returnPath` sends the user back to where they started (for example the project-creation flow or chat).
- **Chat** keeps `ChatConnectionsPanel` as a contextual shortcut that renders the same row component for Knowledgebase and links to the page. The existing Knowledgebase callback behaviour (back to chat with the status) is kept through `returnPath=/chat`.
- **Settings → Integrations** keeps only the workspace GitHub App installation. Its copy says it is a workspace setting, distinct from the personal GitHub account, and links to Connected accounts. The Everhour personal-key card moves out.
- The **Everhour timer popovers** (`components/everhour/*`) are unchanged, except that their "connect your Everhour account" call to action deep-links to `/settings/connections?provider=everhour`.

**Mobile (OverlordMobile, delivered from that repository).**

- **Settings** gets a "Connected accounts" section: the same list, rows and actions.
  - OAuth uses `ASWebAuthenticationSession` with `returnTo: 'mobile'`, which returns to `overlord://connections/callback` (already routed by `DeepLinkRouter`).
  - Everhour uses a `SecureField` sheet. This is new on mobile, and timers stay web-only.
- **Project creation:** the "Connect GitHub" step calls `POST /api/connections {provider: 'github', returnTo: 'mobile'}` and resumes in place when the session completes.
- The **chat screen** connection affordance links to the Settings section.
- Keep the `overlord://github/callback` handling in `DeepLinkRouter` for sessions started by older code paths.

**List compatibility.** `GET /api/connections` with no `scope` parameter, and `GET /api/chat/providers.connections`, return only organization-scoped connections (Knowledgebase), exactly as in v152. Older web and mobile builds therefore never see a provider or a null `organizationId` they did not expect. Mobile decodes these as `JSONValue`, which is lenient, but its code may still treat any item as Knowledgebase. `?scope=all` returns every connection plus a `providers` array: `{provider, scope, credentialKind, available, reason}`.

---

## 5. Local edition behaviour

**Today (verified from code):**

- Everhour and GitHub personal routes work on Local only when the backend environment has `EVERHOUR_API_KEY_ENCRYPTION_KEY` or `GITHUB_USER_TOKEN_ENCRYPTION_KEY` (and, for GitHub, `GITHUB_CLIENT_ID`/`SECRET`).
- Without a key they answer 503 "… encryption is not configured on this Overlord server."
- The desktop shell does not provision these keys. `grep` finds no desktop reference, so a packaged Local install most likely shows Everhour and GitHub personal as not configured. I did not run a packaged build to confirm.
- `/api/connections` answers 404 `chat_unavailable` on Local.

**After migration:**

- `/api/connections` is served on both editions. Availability is per provider:
  - Knowledgebase: Cloud only. On Local it gives `provider_not_available` and the row shows "Not available on this server". Chat stays Cloud-only, and the v152 statement holds for `/api/chat/*`.
  - Everhour and GitHub: both editions.
- **No key configured** (neither the current key nor the provider's env fallback): the provider entry is `available: false, reason: 'encryption_not_configured'`. Connect answers 503 `provider_not_ready`. Rows adopted earlier still list their metadata. Credential use answers `unavailable` (503) without erasing anything. Legacy routes return their existing 503 messages unchanged. **There is never a plaintext fallback.**
- GitHub on Local additionally needs the OAuth App configuration and a callback URL reachable from the browser. That is unchanged.
- **Recommended follow-up (decision D1, not part of this mission's objectives):**
  - The desktop shell generates a random 32-byte key on first run and stores it with Electron `safeStorage`. `desktop/src/backend-token-store.ts` already uses `safeStorage`.
  - It passes the key to the supervised backend as `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`.
  - If the OS keychain is lost, envelopes become unreadable, which leads to `credential_unreadable`, then reconnect.
  - This touches the Desktop Shell module, so it needs its own contract note.

---

## 6. Contract changes (v153) and impact on every module

Land **before** any implementation code, at the start of `j8ny`. Bump `Current version` in `CONTRACT.md` and in `contract/components.yaml`, and add a v153 change summary.

### 6.1 Changes

1. **Account connections generalised.**
   - Providers: `knowledgebase` (organization-scoped, OAuth public PKCE client, Cloud only), `github` (profile-scoped, OAuth confidential client, both editions), `everhour` (profile-scoped, API key, both editions).
   - Remove the v152 sentence "The Everhour and GitHub credential stores are unchanged (coo:1110)". Replace it with the adoption and re-seal rules.
2. **Closed vocabularies:**
   - `account_connections.provider` gains `everhour` and `github`.
   - New `account_connections.credential_format`: `connection-v1`, `everhour-user-key-v1`, `github-user-oauth-v1`.
   - New `account_connections.credential_kind`: `oauth`, `api_key`.
   - `lastErrorCode` gains `insufficient_scope`, `account_in_use`, `identity_changed`, `credential_rejected`.
   - `ChatErrorCode` gains `credential_rejected`, `provider_not_available`.
3. **Schema** (`database/docs/09-database-schema-contract.md` "Assistant Conversations" and the Everhour and GitHub extension sections):
   - The columns, CHECKs and indexes from §2.2, and the `return_url` column.
   - Legacy tables `ext_everhour_user_connections` and `ext_github_user_connections` become read-only migration sources.
   - `ext_github_user_oauth_states` is retired from new writes.
4. **Credential envelopes and keys.**
   - Key ring: current key plus the per-provider env fallbacks `everhour-env` and `github-user-env`.
   - The binding rule for each format.
   - The "missing key versus unreadable" rule (§2.3).
   - New server configuration: none. Existing variables keep their meaning.
5. **REST:**
   - `GET /api/connections?scope=all` (default unchanged).
   - `POST /api/connections/api-keys`.
   - `POST /api/connections` accepts `provider: 'github'` and optional `returnPath`.
   - Per-provider callback paths, with GitHub's at `/api/auth/callback/github/repository` before the Better Auth wildcard.
   - `/api/connections` is served on Local, with availability per provider.
   - Legacy `/ext/everhour/{user-connection,integration}` and `/ext/github/user-connection{,/authorize}` are declared **compatibility aliases** of the module, with their retirement rule (§3).
6. **DTOs** (`packages/contract/src/chat.ts`, or better a new `packages/contract/src/connections.ts` re-exported from `chat.ts` for compatibility):
   - `AccountConnectionDto` gains `scope`, `credentialKind`, `account: {id, label, avatarUrl} | null`, `scopes: string[]` and `lastValidatedAt`.
   - `organizationId` becomes `string | null`. It is always a string in the default, organization-scoped listing.
   - `AccountConnectionListResponse` gains an optional `providers`.
   - New `SetAccountConnectionApiKeyBody`.
   - `StartAccountConnectionBody` gains an optional `returnPath`.
7. **Extension surface:** a new sanctioned extension point, the "account-connection provider adapter" (`contract/extension-points.yaml`). An extension supplies the provider-specific HTTP behaviour (validate, exchange, refresh, revoke, describe). The module owns storage, encryption, state, refresh serialisation and DTOs. Adding a provider is still a closed-vocabulary bump.
8. **Interaction surfaces:**
   - Rename "Backend → Outbound MCP (Account Connection Surface)" to keep its MCP scope.
   - Add an "Extension → Account Connections (Credential Surface)" entry: extensions obtain credentials only through `connections.credentialFor(owner, provider)` and never read `account_connections.credential_*`.

### 6.2 Impact by module

| Module | Impact |
| --- | --- |
| Protocol Layer | None. |
| Database Layer | New migration on both editions, including the SQLite table rebuild. Schema contract doc updates. `packages/core/types/db.ts` regenerated (kysely-codegen). Conformance tests updated (`chat-schema.postgres-conformance.test.ts`) and SQLite counterparts added. |
| CLI Layer | None. The CLI does not call these routes (grep found no use). |
| Connector Layer | None. Manifests are only re-validated at the new contract version by the normal sync. |
| Runner Layer | None. |
| REST API Layer | The connections router is generalised and served on Local. Per-provider callback mounting. The new `api-keys` route. Legacy alias handlers. `chatCloud()` gating narrowed to Knowledgebase and `/api/chat/*`. |
| Auth Layer | None functionally. The GitHub callback ordering before `app.all('/api/auth/*')` is preserved. `GITHUB_CLIENT_ID`/`SECRET` are still shared. Document that the repository grant is not a Better Auth account link. |
| Automations Layer | None. A `project_automation` token still reaches no `/api/connections/*` route; the v151 allowlist is unchanged. |
| Extension System | Everhour and GitHub extensions re-implemented on the new extension point. Their manifests are bumped: **the Everhour manifest currently declares `contractVersion: "0"`, which is stale**, and GitHub declares `'33'`. Run `ovld contract check`. `extensions/everhour/README.md` updated. |
| Desktop Shell | None required. Optional D1 (key provisioning) would be a Desktop Shell change with its own contract note. Older desktop builds keep working through the aliases. |
| Mobile REST Consumer | Additive. Default listings are unchanged. New Settings section and new GitHub flow in `ywx9`. |
| MCP Server | None. Hosted MCP tools do not touch connections. |
| Web app (shared SPA) | Connected accounts page, Integrations page split, Everhour client moved to `/api/connections`, new personal GitHub row. DTOs are taken from `@overlord/contract`, and the web app uses REST only. |
| Chat (core service) | `ChatOwner` → `ConnectionOwner` at the module boundary only. `revalidateConnection` is called only for chat-source providers. Behaviour unchanged. |

---

## 7. Phased sequence with tests

| Phase | Objective | Work | Tests (both editions unless noted) |
| --- | --- | --- | --- |
| 0 | `papq` (this one) | This plan. | None |
| 1 | `j8ny`, first commit | **Contract v153** (all of §6.1). Then the schema migration for both providers. The module is generalised: `ConnectionOwner`, provider registry, Knowledgebase adapter (pure refactor), key ring and format table, `credential_kind`, `api-keys` route, `scope=all`, per-provider availability on Local, and the `return_url` / `returnPath` support. **Knowledgebase behaviour is unchanged.** | The existing `connections.postgres-conformance.test.ts` passes unchanged, plus a SQLite run of the same suite. Migration tests: an empty database; a database with v152 Knowledgebase rows (rebuild preserves rows, FKs and the `chat_source_refs` link); `PRAGMA foreign_key_check` is clean. Key-ring unit tests: current versus fallback write key; a missing legacy key gives `unavailable` without erasing; wrong AAD gives `credential_unreadable`. The default list and `/api/chat/providers` byte-compare with v152 fixtures. |
| 2 | `j8ny` | Everhour adapter (`ext/everhour/connection-provider.ts`). The data copy is in the phase-1 migration file; the Everhour branch is tested here. `service.ts` gets keys through `connections.credentialFor`. Workspace-key adoption pointed at the module. Legacy `/ext/everhour` connection routes become aliases. Write-through tombstone. Scrub. Lazy adoption. **Delete `ext/everhour/crypto.ts`** once unused. | Existing `ext/everhour/service.test.ts` and `routes.test.ts` pass with their env (`EVERHOUR_API_KEY_ENCRYPTION_KEY`). New migration tests on SQLite and Postgres: a seeded legacy row encrypted by the *old* code path → after migration, `GET /ext/everhour/user-connection` reports connected and a timer start uses the same key (fake Everhour). Fallback key: only `GITHUB_USER_TOKEN_ENCRYPTION_KEY` set. Current key set: lazy re-seal flips the format to `connection-v1` and `credential_revision` to 2, with the same plaintext. Disconnect, then re-run the migration: no resurrection. Legacy row tombstoned. Leak test: the API key string never appears in any DTO, `entity_changes`, realtime payload or captured log. |
| 3 | `ykk0` | GitHub adapter: confidential client, `validateGrant` (`repo read:org`), `allow_signup=false`, PKCE best-effort, body-error mapping, Basic-auth revoke, `describeAccount`. GitHub callback mounted at the existing path before Better Auth, via `connectionCallbackHandler('github')`. `repository-owners` and project initialisation read the token through the module. Identity re-check, then `identity_changed`. Legacy routes become aliases with `return_url` and `githubConnection=<status>`. **Remove the token crypto from `user-oauth.ts`.** | Existing `ext/github/user-oauth.test.ts`, `routes.test.ts`, `project-initialization.test.ts` and `backend/project-initialization.test.ts`. New: state is single-use (replay gives `expired`); a state for profile A cannot attach a token to profile B; a missing `read:org` gives `insufficient_scope` and stores nothing; one GitHub account on two profiles gives `account_in_use`; a route-order test shows the callback is served before `/api/auth/*`. Migration tests on both editions: a seeded legacy row with access and refresh envelopes → `repository-owners` works; expired access triggers a lease-serialised refresh (two concurrent callers, one upstream refresh) and re-seals. The workspace GitHub App routes are unchanged (snapshot their responses). Leak test as for Everhour. |
| 4 | `ywx9` | Web Connected accounts page, Integrations split, Everhour and GitHub rows, timer call-to-action deep link. Mobile Settings section, GitHub project-creation flow on `/api/connections`, Everhour key sheet. | Web: component tests for row states, and manual verification in a browser (connect, reconnect, disconnect for each provider; timer popover still starts and stops). Mobile: unit tests for the list decoding and `DeepLinkRouter`, and an iOS simulator walkthrough. Older-client check: the default `GET /api/connections` response is unchanged. |
| 5 | Later (new objective) | After telemetry reaches zero: retire aliases (`/ext/everhour/integration` first), remove lazy adoption, finish the re-seal sweep, retire the legacy env keys (operator action), tombstone and scrub the legacy tables, then drop them in a following contract version. | Alias removal contract tests. A sweep test proving the zero legacy key-id count. |

---

## 8. Decisions and risks

- **D1. Local key provisioning by the desktop shell.** Recommended, but outside this mission's objectives. The alternative is leaving Local Everhour and GitHub dependent on hand-set environment variables, which is today's behaviour.
- **D2. One contract bump for both providers** rather than one per objective. Recommended, because the SQLite rebuild should happen once and both providers share the profile-scope change.
- **D3. Everhour upstream 401.** Recommended: parity (stay `connected`). A later decision could mark the connection `reauthorization_required` after a confirmed 401 from `/users/me`. GitHub follows the module rule (refresh once, then `reauthorization_required`), which is a visible improvement on today's "connected but failing".
- **Risk: SQLite rebuild inside the migration runner's transaction** (§2.2). Verify the runner before writing the migration.
- **Risk: rollback after users connect for the first time post-upgrade.** Those users must reconnect on the old version. Disconnects are written through, so security is preserved.
- **Risk: GitHub PKCE support is unverified** (G7). It is harmless either way.
- **Pre-existing security debt:** live, ambiguous `ext_everhour_workspace_connections` rows hold plaintext API keys. Out of scope; recommended as deferred work.

---

## 9. What I verified and what I did not

**Verified by reading code in this repository and OverlordMobile on 2026-10-05:**

- The prerequisite shipped. `backend/connections/*` and contract v152 are in `0c5b91d5`.
- Module behaviour, schema and DTOs as described in §1.1.
- Everhour and GitHub already use the shared `sealSecret`/`openSecret`/`decodeEncryptionKey`, but with their own AAD and keys.
- The legacy table DDL on Postgres.
- The GitHub callback mount order in `backend/index.ts`.
- `chatCloud()` gating.
- `/settings/connections` currently redirects to `/chat`.
- Web clients: Everhour uses `/ext/everhour/user-connection`. There is no web GitHub personal UI.
- Mobile uses `/ext/github/user-connection{,/authorize}` with `overlord://github/callback`, and decodes connection DTOs as `JSONValue`.
- The desktop does not provision these keys.
- The Railway service lists only `GITHUB_USER_TOKEN_ENCRYPTION_KEY`.
- The Everhour manifest's stale `contractVersion: "0"`.
- Adopted workspace rows keep plaintext after soft delete.

**Not verified:**

- Production data: row counts, and whether `EVERHOUR_API_KEY_ENCRYPTION_KEY` or `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` are set in Railway outside `railway.ts`.
- The SQLite DDL of the legacy tables (only Postgres was read), and the constraints on `ext_everhour_workspace_connections.api_key_secret`.
- How the SQLite migration runner wraps transactions and `PRAGMA foreign_keys`.
- GitHub PKCE support and token-endpoint error format, beyond what the existing code assumes.
- Whether OverlordMobile has a minimum-supported-version gate.
- Whether older desktop builds call `/ext/everhour/integration`.
- Packaged Local behaviour.
- I ran no tests. This objective changed no code.
