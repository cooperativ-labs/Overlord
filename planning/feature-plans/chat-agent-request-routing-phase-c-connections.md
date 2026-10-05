# Account connections and Knowledgebase reads — coo:1108.zb9x

Phase C, objective 05. Builds on contract v152 (coo:1108.vasc), the durable
conversation services (coo:1108.a1ac), and the Phase A Knowledgebase findings
(coo:1108.cag9). Codex, Local, provider fallback, coo:1109, and coo:1110 are out of
scope.

## What was built

`backend/connections/` is the account-connections module. It is the only writer of
`account_connections` and the only reader of credentials.

| File | Responsibility |
| --- | --- |
| `crypto.ts` | Shared AES-256-GCM `v1` envelopes and the state hash. Everhour and GitHub now call it; their AAD, keys, flows, ownership and error text are unchanged (coo:1110 owns migrating them) |
| `config.ts` | `KNOWLEDGEBASE_MCP_URL`, `KNOWLEDGEBASE_EGRESS_ORIGINS`, `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY[_ID]`; HTTPS-only validation |
| `egress.ts` | Approved-origin HTTPS fetch with no redirects, a timeout, and a streamed byte cap |
| `oauth.ts` | RFC 9728/8414 discovery (resource and endpoint origins verified), PKCE S256, RFC 8707 `resource`, code exchange, refresh, best-effort revocation |
| `service.ts` | `AccountConnections`: owner/organization-scoped list/start/callback/disconnect, owner-bound envelopes, lease-serialized refresh, reauthorization |
| `policy.ts` | Reviewed tool policy v1: allowlist, Overlord-authored descriptions and closed schemas, namespaced ids, argument validator |
| `mcp-client.ts` | Outbound Streamable-HTTP JSON-RPC client: sessions, 401 → coalesced refresh → reauthorization, bounds, provenance, `checkNode` |
| `source-check.ts` | `composeSourceCheckers` and the live Knowledgebase checker (per-owner 15 s positive cache, in-flight dedupe) |
| `routes.ts` | Authenticated `/api/connections`; public callback and client metadata document |
| `index.ts` | `createConnectionsRuntime`: one wired instance per process |

`backend/index.ts` mounts the public router before session authentication and
`/api/connections` after it (behind the existing project-automation guard). It also
injects `checkSource` into `Conversations` and the `ChatWorker`'s `ChatRuns`. A
malformed optional Knowledgebase setting disables that provider, logs one line, and
leaves the backend running.

Core changes, both small:

- `ChatStore.revalidate(threadId)` and `revalidateConnection(connectionId)` recheck
  sources under the thread lock through the existing shared projection.
- `Conversations.sources()` now records `chat_source_refs.connection_id` for
  Knowledgebase locators. It records it only when the connection belongs to the
  thread owner.

### Key behaviours

- **Envelope binding.** The credential AAD binds owner, organization, provider, and
  connection id, so a ciphertext copied into another row fails and that connection
  moves to `reauthorization_required`. PKCE verifiers are sealed with their own AAD.
  `state` is stored only as a SHA-256 hash and is single use with a 10-minute expiry.
- **Refresh serialization.** A compare-and-set lease on `refresh_lock_owner/until`
  (15 s) is keyed to `credential_revision`. The winner refreshes, persists the rotated
  envelope, and clears the lease in one guarded update. Losers wait and reread. A
  token is used only after it is persisted. If the winner's lease is lost, its tokens
  are discarded unused; the provider's 30 s reuse grace covers the retry. After a
  401, the caller passes `staleRevision`, so concurrent callers coalesce on one
  refresh.
- **Revocation.** `invalid_grant`, or a 401 just after a refresh, erases the
  credential and sets `reauthorization_required` with a `lastErrorCode`. Disconnect
  erases first, then revokes the refresh and access tokens upstream (best effort).
  Both paths call `onAccessLost`, which immediately rechecks every thread citing the
  connection. Content becomes `unavailable` and generations are fenced with
  `source_access_lost`.
- **Tools.** Only policy-v1 names are ever sent. Server annotations can only withhold
  a reviewed tool, and server descriptions and schemas never reach the model.
  Workspace-scoped calls must name an authorized workspace; the list is refreshed once
  from `list_workspaces` when a workspace is unknown.

## Client integration contract (web and mobile)

This is authoritative in `CONTRACT.md` v152 ("Account connections", *Client
integration*). Summary for coo:1108.r2b0 (web) and coo:1108.btc9 (mobile):

1. `GET /api/connections` lists `AccountConnectionDto` for live connections in the
   active organization. Render `connected`, `pending` (offer “Continue sign-in”), and
   `reauthorization_required` (offer “Reconnect”; `lastErrorCode` explains why).
2. `POST /api/connections` takes `{ provider: 'knowledgebase', returnTo: 'mobile' | 'web' }`
   and returns `{ connectionId, authorizeUrl, expiresAt }`. Open `authorizeUrl`:
   - iOS: `ASWebAuthenticationSession` with callback scheme `overlord`.
   - Web: a new tab or popup.
   Errors: 503 `provider_not_ready` (not configured), 429 `limit_exceeded`, 400
   `invalid_request`, 404 `chat_unavailable` (Local).
3. The session completes at `overlord://connections/callback?provider=knowledgebase&status=…`
   on mobile, or `/settings/connections?provider=knowledgebase&status=…` on the web
   origin. `status` is `connected`, `denied`, `expired`, or `failed`. Treat it as a hint
   and reload the list. No code, state, or token ever reaches the client.
4. `DELETE /api/connections/:id` disconnects and returns the `disconnected` DTO.
   Content derived from that connection is replaced with `unavailable` blocks;
   reconnecting does not restore it.
5. `GET /api/chat/providers` (`connections` field) is not built yet. Clients read
   readiness from `GET /api/connections` until coo:1108.vx29 adds engine readiness.

The engine-facing seam for coo:1108.vx29 is
`runtime.knowledgebase.tools(owner)` → `KnowledgebaseToolDescriptor[]` (namespaced id,
reviewed description and schema) and
`runtime.knowledgebase.call(owner, toolId, args, signal)` →
`KnowledgebaseToolResult` (`outcome`, bounded `text`, `truncated`, `sources` with
locator/revision/updatedAt, `observedAt`). Register `result.sources` through
`Conversations.sources()` and cite them.

## Verification

Command (Node 24):

```sh
node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 \
  backend/connections/connections.postgres-conformance.test.ts \
  packages/core/service/chat/chat.postgres-conformance.test.ts \
  backend/chat.test.ts database/src/chat-schema.postgres-conformance.test.ts
```

Result: **84 passed, 0 failed** on SQLite and real Postgres. That is 20 new connection
tests (8 per database plus 4 boundary tests) alongside the unchanged predecessor
suites. The Everhour and GitHub suites still pass (25/25) after the crypto extraction.
Backend typecheck has no new errors (only the two existing
`runner-claim-http.test.ts` errors). Core typecheck, lint (0 errors), conformance
versions, and workspace scoping pass. The suite is in `yarn test:conformance`.

The new suite runs against an in-memory Knowledgebase (`fake-knowledgebase.ts`). It
models the Phase A facts: CIMD client ids, PKCE and `resource`, 30 s refresh-reuse
grace followed by a family wipe, consent revocation killing every token, node 403s,
and generated annotations, including a hostile server description. Covered:

- Sign-in: hashed state, sealed verifier, replayed, expired, denied and forged
  callbacks, and no secret in any row, DTO or HTTP body.
- Tools: write and unreviewed tools never reach the server; argument, workspace and
  output bounds; withheld tools; provenance.
- Isolation: cross-owner and cross-organization denial on every surface, and a
  copied envelope.
- Refresh: eight concurrent calls from two "processes" produce exactly one refresh,
  and a later refresh uses the persisted rotation.
- Revocation: upstream consent revocation leads to `reauthorization_required` and
  erasure, then reconnect.
- Source checks: node revocation, cache expiry, and the disconnect short-circuit.
- Disconnect: upstream revocation plus proactive chat invalidation (unavailable block,
  fenced run, no replay leak).
- HTTP: client metadata document, status-only redirects, owner scoping, Local guard.

Live, unauthenticated, against `https://knowledge.chaselubitz.com/mcp` with the
production `KnowledgebaseOAuth`:

- Discovery validates (issuer `…/v1/auth`; authorize, token and revoke endpoints on
  the MCP origin, so no extra egress origin is needed).
- The authorize URL carries exactly `response_type, client_id, redirect_uri,
  code_challenge, code_challenge_method, scope, resource, state`.
- Unauthenticated MCP returns 401.

## Not verified and remaining limitations

- **Live authenticated reads, refresh, and revocation against the real Knowledgebase
  are still blocked.** Two things are missing:
  - The client metadata document is not reachable: `https://backend.ovld.ai/oauth/clients/knowledgebase.json`
    returns 404 because this code is not deployed.
  - The account holder has not yet signed in.
  To complete it: deploy with `KNOWLEDGEBASE_MCP_URL` and
  `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` set, connect from the phone, then run the
  Phase A revoke steps. This is rechecked in coo:1108.z77k. All passes above use the
  fake server.
- **Phone sign-in UI is not built.** It belongs to coo:1108.btc9; the backend half is
  ready.
- **Login-CSRF residual risk.** Anyone holding an unexpired `authorizeUrl` could
  complete consent to the initiating owner's connection. The callback cannot carry an
  Overlord session from `ASWebAuthenticationSession`. Mitigations:
  - The URL expires in 10 minutes and is single use.
  - The Knowledgebase shows a consent screen.
  - The connected workspaces are visible in the DTO.
- **Revocation lag.** A node revoked upstream is observed within the 15 s positive
  cache. Revoking only a refresh token upstream leaves the current access token
  valid for up to an hour, which is Knowledgebase behaviour from Phase A.
- **Source checks run inside the thread lock.** The predecessor runs `checkSources`
  inside the thread-lock transaction with a 3 s cap. The cache bounds upstream
  traffic, but a slow Knowledgebase can still lengthen snapshot latency.
- **Provenance is heuristic.** It treats any object with a UUID `id`/`node_id` and a
  path, title or version as a node.
- **No key rotation.** Only one credential key id is accepted; any other id requires
  sign-in again.
- **Not built here:** `GET /api/chat/providers` and the Overlord and repository
  source checkers. Those kinds answer `unknown` until vx29 and zg8m register them.
