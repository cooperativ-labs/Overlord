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

## C1 extension (contract v154) — per:202.62e3

The read-only scope above is superseded for the assistant by authorized writes through
the **same** connection, credential store, and outbound MCP client. Plan of record:
the Knowledgebase repository's `docs/features/KNOWLEDGEBASE_OVERLORD_CONNECTOR.md`
(C1). Normative text: `CONTRACT.md` "Version 154 Change Summary" and "Backend →
Outbound MCP".

### What changed

| Area | Change |
| --- | --- |
| `policy.ts` | Tool policy v2. Reads add `query` and `get_registries`. Writes `create_node`, `edit_file`, `set_properties`, `add_relation`, `update_relation`, `remove_relation` with Overlord schemas that require each revision guard. Values may be untyped JSON, bounded by depth, size, string length, key length, and finiteness; `null` removes a property. Per-tool argument limits apply. Annotations only narrow: reads must stay read-only; only `remove_relation` may be destructive. |
| `mcp-client.ts` | Writes need the run's grant (connection and workspace) or are refused before any request (`write_not_authorized`). 409/412 and `edit_file`'s version check map to `conflict`. A write sent without a usable response maps to `uncertain` and is never retried (401/4xx/dropped-session refusals stay safe). `query`, `get_related`, and `get_registries` fail closed on output over 64 KiB instead of truncating. `authorizeWrite` checks a grant against the stored connection. |
| Core chat | `SubmitChatMessageBody.knowledgebaseWrite` is validated (`ChatOptions.authorizeKnowledgebaseWrite`) and stored on `chat_runs.knowledgebase_write_json`. Continue inherits it; an answer may add one, never change one. The gateway declares write tools only under a grant and passes the stored grant, never model input, to every call. Interrupted `executing` writes become `failed`/`uncertain_write` at the next claim instead of being re-requested or cancelled. |
| Runtime | Writes run sequentially after the turn's reads. Prompt `overlord-assistant-v4` covers read-before-write, guarded retries, uncertainty, linking, Feature server-owned fields, and reporting changes. Fresh-generation recovery includes uncertain writes. |
| Web | The composer shows "Knowledgebase: Read only / Allow edits in <workspace>" per message and resets after each send. The run status shows the granted workspace, and connection wording mentions edits. |

There is no Knowledgebase write OAuth scope. In the Knowledgebase source, an MCP
OAuth connection acts with its user's grants minus their `read_only`/`no_access`
restrictions. Only the `share` and `schema` capabilities are opt-in, and neither is
used here. Existing connections therefore get the v2 tools without reauthorization,
and Knowledgebase 403s stay authoritative. `toolPolicyVersion` on the DTO is the
version recorded at sign-in.

Not done here: Feature handoff and mission interoperability (C2, `per:202.5h64`),
mobile composer support (mobile runs stay research only until it sends the grant), and
canonical Feature guidance. M2 had not shipped when C1 was built, so the prompt
carries only M1 facts and the generic guarded-write rules; adopt M2's skill text when
it lands.

### Validation (2026-10-05)

Fake-upstream validation, run on both database paths (SQLite and real Postgres via
`scripts/with-test-db.mjs`):

```sh
node scripts/with-test-db.mjs node scripts/with-ovld-home.mjs node --import tsx --test --test-concurrency=1 \
  backend/connections/connections.postgres-conformance.test.ts \
  backend/chat/knowledgebase-writes.postgres-conformance.test.ts \
  backend/chat/gemini-runtime.postgres-conformance.test.ts
```

Result: 66 passed, 0 failed. The extended fake (`knowledgebase-test-fixture.ts`)
models Knowledgebase revision guards, null removal, server-owned
`content_updated_at`, a paged Feature `query`, read-only users (403), and a lost
response after an applied write. Covered:

- policy v2 exposure and annotation narrowing;
- grant scoping (owner, organization, connection, workspace);
- note create/edit with version conflicts, and a repeated create caught as a conflict;
- uncertain outcomes and bounded nested JSON;
- a 120-Feature paged candidate query with fail-closed truncation;
- nested citations, votes maps, null removal, ranking-attribute preservation, and stale relation and metadata revisions;
- refresh-then-write applied exactly once, and disconnect revoking writes.

The chat suite drives the real MCP client with a scripted Gemini. It covers:

- a research-only run, where a forged write is never sent;
- a granted run with note and Feature writes, where receipts, sequential order, a conflict, and a foreign-workspace refusal are all recorded;
- a worker crash after the write was sent, resolved as uncertain and never re-sent;
- grant validation, and a read-only Knowledgebase refusal.

Core chat tests pass (34), and webapp chat/connection tests pass. Core, backend, and
webapp typechecks are clean apart from the existing `runner-claim-http.test.ts`
errors. Source cross-check: the Knowledgebase's generated annotations
(`packages/client/coverage.ts`, including M1's read-only `query`) match the reviewed
policy for all 16 tools.

**Live-credential validation was not performed.** No deployed Overlord has a live
Knowledgebase connection, and the production Knowledgebase does not yet serve M1. Until
it does, the server still annotates `query` as non-read-only, so Overlord withholds it,
which is safe. To validate live: deploy both sides, connect, then in Chat allow edits
for a scratch workspace and create, edit, and relink a note and a Feature. Repeat with
the connection restricted to read-only, and again after disconnect.

## C2 Feature handoff (contract v155) — per:202.5h64

Feature handoff and mission-read interoperability through the **same** Knowledgebase
connection and Overlord's existing mission services. Plan of record: the Knowledgebase
repository's `docs/features/KNOWLEDGEBASE_OVERLORD_CONNECTOR.md` (C2). Normative text:
`CONTRACT.md` "Version 155 Change Summary". No Feature backend, reverse credential
store, scheduler, migration, or token export.

### Two credential directions

| Direction | Credential | Path |
| --- | --- | --- |
| Overlord assistant → Knowledgebase | The owner's existing Knowledgebase account connection (C1) | Knowledgebase MCP reads and guarded writes; Overlord missions are read from Overlord's own services, never through a loopback MCP call. |
| External Knowledgebase agent → Overlord | The agent's own authenticated Overlord MCP/CLI credential | `overlord_search_missions` (exact-reference mode), `overlord_load_mission_context`, `overlord_create_mission`. Knowledgebase's server and browser hold no Overlord credential. |

### What changed

| Area | Change |
| --- | --- |
| Contract | `packages/contract/src/mission-reference.ts`: `MissionReferenceSearchResponse`, whole-token matching, and the canonical Feature reference `kb-feature:<origin>/<workspace>/<node uuid>` with link `<origin>/n/<node uuid>`. |
| Core | `packages/core/service/mission-reference-search.ts`: exhaustive lookup in one project over live missions/objectives, mission-id keyset pages, cursor bound to reference and project. SQL `LIKE … ESCAPE` narrows candidates on both dialects; a case-sensitive whole-token check decides, and page boundaries are over candidates so a filtered candidate never hides a later match. |
| Protocol/CLI | `search --reference --project-id [--workspace-id] [--limit] [--cursor]`; ranked flags rejected; authorized like v2/v3 search (organization project resolution, `mission:read`, project_automation selection). |
| MCP | Hosted tool and local shim add `reference`/`cursor`; the response is forwarded uncompacted. Connector version 0.3.50. |
| Chat | `overlord_find_feature_missions` (origin from the owner's live connection), `createdReceipts` in run input, a server-side guard on `set_properties` `overlord` links, prompt `overlord-assistant-v5` with the handoff procedure, label `Checking Feature missions`. Handoff stays `prepare_proposal` + the user's Create: drafts only, never launched. |

Recovery rules the prompt and the shared procedure follow: never infer absence from
ranked search, a failed lookup or an incomplete page; one live non-cancelled match is
linked instead of creating another; a cancelled match is reused only on request; a
`complete` match needs a follow-up Feature; several matches are reported (no
cross-system transaction or exactly-once claim). The link write uses the metadata
revision read before the lookup; on conflict, reread and re-evaluate. Mission `complete`
means live; delivery or `review` does not. Remove link never changes the mission.

### Validation (2026-10-05)

Fake-upstream validation on both database paths:

```sh
node scripts/with-test-db.mjs node scripts/with-ovld-home.mjs node --import tsx --test --test-concurrency=1 \
  backend/chat/feature-handoff.postgres-conformance.test.ts backend/mission-reference-search.test.ts
```

Result: 12 passed (6 per adapter). Covered: absence proven before a draft card;
Create makes one draft mission with draft objectives and no execution request; the
creation receipt reaches the next turn; a stale link write conflicts with a concurrent
edit, the retry recovers the same single mission and preserves the edit; exact identity
across Knowledgebase workspaces, title-only mentions, case and suffix near-misses,
deleted missions, and the wrong Overlord project; two concurrent handoffs both
reported; cursor paging (105 matches over three pages, limit 1 in chat) and cursor
binding; `statusType` after cancellation; another organization's caller gets
`not_found`; links to missing or other-Feature missions refused before any Knowledgebase
request, manual links to unreferenced missions allowed, Remove link leaves the mission
untouched; Protocol rejection of ranked combinations, bad limits, foreign cursors, and
unknown projects. `backend/mcp.test.ts` checks the hosted/local schema parity and the
reference-mode Protocol mapping. Existing chat, proposal, connection, MCP, search, and
protocol suites pass on both adapters (163 tests), core passes (600).

Not verified: live credentials (no deployed Overlord holds a live Knowledgebase
connection and production Knowledgebase does not yet serve M1–M5), and an actual LLM or
external agent run; the flows above are scripted. Project_automation token scoping uses
the existing `authorizedSearchProjectIds` path shared with v2/v3 search and was not
re-tested here. M5 owns the chip, the canonical feature-handoff skill text, and the
end-to-end acceptance exercise.
