# coo:1108 Phase A findings: Gemini recovery, Knowledgebase authorization, hosted target reads

Objective: coo:1108.cag9. Date: 2026-10-04. Plan:
[chat-agent-request-routing.md](chat-agent-request-routing.md).

Proof code lives in `planning/spikes/coo-1108-phase-a/`. It is isolated from product
code, imports no Overlord service, and exposes no route or contract. The saved Gemini
report is `planning/spikes/coo-1108-phase-a/results/gemini-restart-report-2026-10-04.json`.

| Proof | Result |
| --- | --- |
| Gemini 3.8 Flash access, streaming tool loop, kill/restart at each boundary | **Passed live** (8 of 8 restart cases, plus probes) |
| Knowledgebase discovery and client requirements | **Verified live** (unauthenticated) and from server source |
| Knowledgebase authorized reads, access check, revocation, phone sign-in | **Blocked**: no Overlord OAuth client exists yet, and the proof needs a human sign-in |
| Existing mission-less target reads from the hosted backend | **Blocked**: no hosted route invokes them; the real target is registered and reachable |

## 1. Gemini

### Environment

- Model `models/gemini-3.8-flash` ("Gemini 3.8 Flash"): input limit 1,048,576 tokens,
  output limit 65,536. Supported actions are `generateContent`, `countTokens`,
  `createCachedContent` and `batchGenerateContent`.
- SDK `@google/genai` 2.8.0, the version pinned in the root `resolutions`. API key from
  the deployment's `GEMINI_API_KEY`.
- API: `ai.models.generateContentStream({ model, contents, config: { systemInstruction,
  tools: [{ functionDeclarations }], temperature: 0 } })`. History is held locally and
  resent on each request. Nothing uses provider-hosted conversation state.

### Harness

- `gemini-checkpoint-worker.mjs` runs one tool loop for one run.
- `checkpoint-store.mjs` stores state in SQLite (`node:sqlite`, WAL, `synchronous=FULL`).
  Every write runs in a `BEGIN IMMEDIATE` transaction and first checks the run's
  current fence.
- `prove-gemini.mjs` starts the worker as a child process. The worker kills itself with
  `SIGKILL` at a named boundary. A second worker then claims a new attempt, which
  increments the fence, and continues the run.
- Tools are deterministic local read fixtures (`find_project`, `get_project_status`).
  The provider round trips are live; only the tool implementations are fixtures.

Boundaries:

| Boundary | State at the kill |
| --- | --- |
| `request_persisted` | The full model turn (every part, including signatures) and a `requested` receipt for each call are committed. No tool has run. |
| `tool_started` | A receipt is marked as executing. Its result is not recorded. |
| `result_persisted` | Every result is recorded and joined to the checkpoint as one `functionResponse` turn, in call order. No provider request has been sent. |

### Checkpoint format (version 1)

```text
provider_checkpoints(run_id, schema_version, fence, phase, payload, updated_at)
payload = {
  schemaVersion: 1,
  model: "gemini-3.8-flash",
  configDigest: sha256(model + generation config incl. tool declarations),
  contents: Content[],          // provider parts verbatim and in arrival order
  pending: null | { turnIndex, calls: [{ order, providerCallId, callId, name, args }] },
  providerRequests: number
}
tool_receipts(operation_id = run:turnIndex:order, call_id, provider_call_id, call_order,
              name, args, state requested|completed, executions, result,
              requested_fence, completed_fence)
```

A checkpoint is reusable only when the schema version, model and config digest all
match. Otherwise the worker exits with "incompatible", and the caller must choose
fresh-generation recovery explicitly.

### Observations

1. **Streaming shape.** Each function call arrived as one complete part, so no
   `partialArgs` or `willContinue` fragments appeared. Text arrived across several
   parts. Some turns contain an empty `{ text: "" }` part. The adapter keeps every part
   as received; merging text parts could detach a signature from the part it was
   issued on.
2. **Parallel calls.** Two independent lookups came back as two `functionCall` parts in
   one turn. Each part had a provider ID (for example `call_1611577`). Only the first
   function-call part carried a `thoughtSignature`; signatures were 252–756 base64
   characters.
3. **Sequential calls.** A dependent lookup produced one call per turn
   (`find_project`, then `get_project_status`).
4. **Restart results.** All 8 cases ended `completed` on attempt 2. Each case passed
   these checks:
   - An operation that had not started executed exactly once.
   - Only the `tool_started` case ran an operation twice (`executions = 2`). That
     operation was a read, so it was re-executed under the same operation ID.
   - Results were joined in call order.
   - A checkpoint write with the killed attempt's fence raised `StaleFenceError`.
   - Logs contained no signatures, response parts, tool results or API key.

   | Scenario | Boundary | Provider request | Attempts | Executions per operation |
   | --- | --- | --- | --- | --- |
   | sequential | request_persisted | 1 | 2 | 1,1 |
   | sequential | tool_started | 1 | 2 | 2,1 |
   | sequential | result_persisted | 1 | 2 | 1,1 |
   | sequential | request_persisted | 2 | 2 | 1,1 |
   | mixed (parallel ×2) | request_persisted | 1 | 2 | 1,1,1,1 |
   | mixed | tool_started | 1 | 2 | 2,1,1,1 |
   | mixed | result_persisted | 1 | 2 | 1,1,1,1 |
   | mixed | result_persisted | 2 | 2 | 1,1,1,1 |

5. **Signatures are enforced only for the current turn's function calls.**
   - Removing signatures from an in-progress function-call turn returned HTTP 400:
     "Function call is missing a thought_signature in functionCall parts."
   - A completed history with every signature removed, followed by a new user
     message, was accepted.
   - So a checkpoint has to be kept only while a tool turn is in flight. Completed
     exchanges can be rebuilt from stored messages and observations.
6. **The provider does not enforce tool-result integrity.** Each of these requests was
   accepted:
   - reversed result order;
   - results without IDs;
   - a parallel batch with one of its two results missing (the model simply asked for
     that call again).

   Completeness, ordering and call-ID matching are therefore Overlord's invariants,
   enforced before each provider request.
7. **Fresh-generation recovery works.** The recovery request contained only the
   original user message plus recorded observations, presented as untrusted data with
   observation times. It used the same tools and no function-call history. The model
   produced a correct answer and repeated no read.

### Recovery rules derived from the evidence

- **Resume from the checkpoint** when the checkpoint version, model and config digest
  match and the source dependencies reauthorize:
  - Complete every `requested` receipt in call order.
  - Join the results as one `functionResponse` turn.
  - Continue the run.
- **Fresh generation** when the checkpoint is missing, incompatible or invalidated, or
  when an in-flight turn's signatures are unavailable:
  - Build the request from authorized messages and recorded observations, labelled as
    data.
  - Mark any partial text interrupted.
  - Record `recovery_mode = fresh_generation`.
  - Never send a function-call turn without its original signatures.
- **Interrupted operation:**
  - A read whose receipt is still `requested` is re-executed under its original
    operation ID.
  - A target read uses the runner's idempotency key, so it is not enqueued twice.
  - Any future write is reconciled against its receipt and never blindly retried.
- **Visible failure** when neither path is safe.

## 2. Knowledgebase (https://knowledge.chaselubitz.com/mcp)

### Authorization server: verified live

Discovery follows the standard MCP pattern. An unauthenticated `POST /mcp` returns 401
with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
The issuer is `https://knowledge.chaselubitz.com/v1/auth`.

| Field | Value |
| --- | --- |
| Grants | `authorization_code`, `client_credentials`, `refresh_token` |
| PKCE | S256 only |
| Scopes | `openid profile email offline_access` |
| Client ID Metadata Documents (CIMD) | Supported |
| Dynamic registration | Off |
| Device authorization grant | None |
| Public clients | Allowed (`none` token endpoint auth) |
| Introspection | Requires client authentication (`client_secret_*` or `private_key_jwt`) |
| Revocation endpoint | Present |
| DPoP | Supported, not required |

An authorize request whose client ID cannot be resolved returns `400 invalid_client`.
The error page does not redirect.

### Server behaviour (from source, Better Auth 1.7.4)

These facts come from source at `/Users/jake/Development/Tooling/knowledgebase`.

- **CIMD client IDs:**
  - Must be public HTTPS URLs with a path.
  - Localhost and private IPs are rejected.
  - The fetch has a 5 KB limit and a 5 s timeout, and does not follow redirects.
  - The document needs `client_id` equal to its own URL, a `client_name`, and
    `redirect_uris`.
  - The token auth method must be `none` or `private_key_jwt`.
- **Redirect URIs** may be HTTPS, loopback HTTP, or a reverse-domain private-use scheme.
  They are matched exactly; only the port may vary on loopback.
- **Access tokens** are JWTs bound to the audience `https://knowledge.chaselubitz.com/mcp`
  and last 3600 s.
- **Refresh tokens:**
  - Issued only with `offline_access`. They last 30 days and rotate on every use.
  - Reusing a rotated token after a 30 s grace window deletes every token for that
    client and user.
  - Refresh must therefore be serialized per connection, and the rotated token must be
    persisted before it is used.
- **Every MCP request checks the JWT and a live grant:** a consent row or an unrevoked
  refresh token, plus a client that is not disabled.
  - Revoking the connection in the Knowledgebase UI deletes the consent and all tokens,
    so the next call returns 401 immediately.
  - Revoking only the refresh token through `/oauth2/revoke` leaves the consent row.
    The current access token then keeps working until it expires, at most one hour.
- **Tools:**
  - Annotations are generated: `readOnlyHint` is set only when every backing call is a
    GET.
  - `query` only reads, but it is a POST, so it is not annotated read-only and stays off
    the allowlist until reviewed.
  - There is no output cap, and a document file read defaults to 5 MB. The client must
    enforce its own size and time bounds.
- **Per-source access checks:**
  - `get_related(node_id)` maps to `GET /v1/ws/{ws}/nodes/{id}`.
  - It returns 403 once access to that node is revoked. A missing node returns 404, or
    403 when the caller holds only a node-level grant.
  - It serves as the current per-source access check. A failure or an unverifiable
    result is treated as revoked.
- **Revocation is not visible in `list_changes`.** That feed only returns nodes the
  caller can still read, so a revoked node never appears there.
- **Provenance fields:**
  - Nodes: `id`, `path`, `current_version_id`, `updated_at`.
  - Files read with `read_file`: an `expectedVersion` ETag.
  - Resources: `id`, `revision`.
  - Workspace: its slug.
- **Workspaces visible to an already-authorized MCP client** (the claude.ai Knowledge
  connector, not Overlord): `main`, `tough-leaf` and `overlord`, all owned by the same
  actor.

### Auth flows for Overlord

**Backend.** Overlord publishes a CIMD document on a public Overlord origin, for example
`https://backend.ovld.ai/oauth/clients/knowledgebase.json`.
- The document sets `token_endpoint_auth_method: none` for the first proof. Use
  `private_key_jwt` if introspection or stronger client authentication is wanted.
- Its only redirect URI is
  `https://backend.ovld.ai/api/connections/knowledgebase/callback`.
- The backend creates the PKCE verifier and `state`, bound to the owner, organization
  and an expiry.
- The backend exchanges the code with `resource=<mcp url>` and stores the tokens in the
  owner-bound AES-256-GCM envelope.

**Phone.** The phone asks the backend to start a connection and receives the authorize
URL.
- It opens the URL in `ASWebAuthenticationSession`.
- The Knowledgebase redirects to the backend's HTTPS callback, so the code and verifier
  never reach the app.
- The backend then redirects to a universal link, or to an app-scheme completion page
  that carries only a connection status.
- No device flow is needed, and none exists.

**Desktop/web.** Same backend flow in a browser tab or popup.

### Proof client

The client is `planning/spikes/coo-1108-phase-a/knowledgebase-client-proof.mjs`.

- `discover` runs live today.
- These steps are written but not yet run against the server, because they need a
  credential:
  - `authorize`: authorization code with PKCE, RFC 8707 `resource`, and a loopback
    redirect.
  - `reads`: `initialize`, `tools/list` filtered by a reviewed allowlist, local
    rejection of `delete_file`, `list_workspaces`, `search`, and the `get_related`
    access check.
  - `refresh` (rotation) and `revoke`.
- Tokens are sealed in an AES-256-GCM envelope whose additional authenticated data
  binds the owner, so another owner cannot decrypt them.
- The client also accepts a Knowledgebase personal access token through `KB_PAT`. That
  proves the reads and access check only, not the OAuth flow.

### Blockers

1. **No public HTTPS client metadata document exists** on an Overlord origin, and
   dynamic registration is disabled on the Knowledgebase. Without one, no OAuth client
   can be authorized: the server rejects localhost client IDs.

   Unblock with either of:
   - Host the CIMD JSON at a public Overlord HTTPS URL.
   - Temporarily set `KB_OAUTH_DYNAMIC_REGISTRATION=true` on the Knowledgebase (not
     recommended).
2. **Sign-in, revocation and the phone flow need the account holder.** Revoking a
   connection or a node grant also needs that person or a second account. None of this
   can be done unattended.

Once 1 and 2 are available:

1. Run `authorize --client-id <url>`, then `reads --node <id> --workspace overlord`.
2. Revoke the connection in the Knowledgebase UI and run `reads` again. Expect 401.
3. Share a node with a second account, read it, revoke the grant, and rerun
   `reads --node`. Expect `get_related` to report 403.
4. Run `refresh` twice. Expect rotation. Replaying the old token after 30 s should wipe
   the token family.

## 3. Mission-less target reads from the hosted backend

Live facts from `https://backend.ovld.ai`, project `49763405-…` (Overlord):

- `GET /api/projects/:id/execution-target` lists target `cf857924-…` ("Macbook Pro",
  `JCL-MBP.local`) with `reachable: true` and `primaryResourceConnected: true`. Its
  runner runs as `ovld runner supervise` under the desktop app.
- `GET /api/projects/:id/resources` returns the active `local_directory` resources
  `primary`, `latch`, `marketing`, `mobile` and `refinery`, all bound to that target.
- `GET /api/projects/:id/repository?resourceKey=primary&executionTargetId=…` returns 200
  with `status: "unsupported_resource"`. It never queues: `checkoutControlPlaneProvider`
  always resolves to `UnavailableProvider` (`backend/repository.ts:229-232`).

**Blocker.** No hosted REST route, protocol subcommand or CLI command invokes
`observeResource`, `readRepositoryTree`, `listBranches` or `listWorktrees` through the
runner queue.

- The queue transport works for mission-less capability calls:
  - It creates an `execution_requests` row with `metadata_json.kind = "capability_call"`
    and `mission_id` NULL.
  - It uses `operationId` as the idempotency key.
  - Reads time out after 30 s; the job stays live after a timeout.
- The only mission-less callers are the worktree remove and purge-merged mutations.
  They delete worktrees and are not acceptable as a read proof.
- `POST /api/local-target/invoke` is a development-only in-process proxy. It requires
  SQLite plus `OVERLORD_DEV_IN_PROCESS_LOCAL_TARGET=true`.
- Proving this live needs a new authenticated, mission-less read route. The route
  resolves `projectId`, `resourceKey` and `executionTargetId` to a registered binding
  and calls `resolveProjectLocalTargetProvider(...)` for the read. It must be
  contracted and deployed to the hosted backend. A temporary uncontracted production
  route was not added, as the objective requires.

**Constraint found.** At claim time, `resolveWorkingDirectory` resolves a mission-less
capability call's (null) `resource_key` to the project's primary resource
(`packages/core/service/execution-requests.ts:765-777`).
- If the primary resource is not connected on the target, the request is marked failed.
- This holds even when the read is for another resource, such as `mobile`.
- The new read route has to pass the intended resource key through to the claim, or
  the claim has to skip working-directory resolution for capability calls.

## 4. Plan refinements made

These changes were applied to `chat-agent-request-routing.md`:

- **§3:** the existing reads are implemented but not exposed on any hosted path; they
  need the new read route.
- **§5.4:**
  - Overlord, not the provider, enforces result completeness, ordering and call-ID
    matching.
  - Checkpoints are needed only while a tool turn is in flight.
  - The read re-execution rule after an interrupted operation.
- **§6:** the confirmed API surface and SDK version.
- **§7.3:**
  - The CIMD client registration, with the backend-mediated phone flow.
  - Serialized refresh, with the rotation and family-wipe risk.
  - The `get_related` per-source access check.
  - Revocation semantics.
  - Client-side output bounds.
- **§7.4:**
  - The new mission-less read route.
  - Claim-time resolution of the primary resource.
- **§13 Phase A:** status and the remaining human-dependent steps.
