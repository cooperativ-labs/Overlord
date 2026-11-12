# OpenAPI schema disagreements (phase 4b working file)

Running record kept while phase 4b adds request and response schemas to
`openapi.yaml`. The description follows the code (ADR 0006); everything here is where
another source, or the code itself, looks wrong. Phase 4d consumes this file: it
resolves each entry by a contract change, a code fix, or an explicit decision to keep
the behaviour. Batches append; do not renumber entries.

Each entry names the operationIds affected and the file and function that ship the
behaviour. Status is `open` until phase 4d decides.

## 1. Prose and type disagreements

Where `rest-notes.md`, a TypeScript DTO comment, or another document says something
the code does not do.

### Projects, project statuses, project resources (batch 1)

- **P1** (open). `CreateProjectStatusBody.isDefault` and `UpdateProjectStatusBody.isDefault`
  (packages/contract) say only draft-type statuses may be the default; the code
  (`backend/repository.ts` `createProjectStatus`, `updateProjectStatus`) accepts `draft`
  or `next`. Affects `postProjectsByIdStatuses`, `patchProjectsByIdStatusesByStatusId`.
- **P2** (open). `CreateProjectBody.workspaceId` says it "defaults to the caller's active
  workspace". Authenticated requests carry no ambient workspace (CONTRACT/rest-notes
  "REST handlers should … not read a workspace header"), so `createProject` answers 400
  `workspaceId is required when creating a project` when it is omitted; only a
  context-free in-process caller falls back to the bootstrap workspace. `postProjects`.
- **P3** (open). rest-notes.md "Project-resource source declaration semantics" says a
  `sourceUrl` Git source is project-global (`execution_target_id IS NULL`).
  `insertProjectResource` stores `body.executionTargetId` on a `git` source when one is
  given, without checking that the target exists or belongs to the workspace.
  `postProjectsByIdResources`.
- **P4** (open). `ProjectResourceDto.type` is typed as the closed union
  `local_directory | remote_directory | git | source_bundle`; the mapper
  (`toProjectResourceDto`) emits any stored `source_kind` other than `local_checkout`
  verbatim. The schema says `string`.
- **P5** (open, TypeScript optionality). Several DTO members are optional in
  packages/contract but always written by the mappers, so the schemas make them
  required: `ProjectResourceDto.observedAt`/`observationSource`,
  `ProjectResourceSourceDto.launchDefaults`, `ObjectiveDto.queueEntry`/
  `launchConfigOverrides`, `ObjectiveRunQueueEntryDto.waitingReason`/
  `waitingOnObjectiveId`/`waitingOnObjectiveDisplayId`/`attemptCount`,
  `ExecutionRequestDto.localTargetMutationKind`. Conversely
  `MissionDetailDto.branch` is nullable in the type but always an object from
  `getMissionDetail`.

### Missions (batch 1)

- **M1** (open). rest-notes.md "Mission search versioning" calls `GET /api/missions/search`
  "frozen as its v1 array-shaped response"; the handler (`backend/app.ts`) answers an
  object `{ missions: MissionDto[] }`. `getMissionsSearch`.
- **M2** (open). `MissionEventDto` (packages/contract) says events are "ordered
  oldest-first by `createdAt`"; `listMissionEvents` returns them newest first, capped at
  200. `getMissionsByIdEvents`.
- **M3** (open). `GenerateCommitMessageResultDto` and `generateCommitMessage`'s comment
  say the diff is gathered through the local-target provider and that a clean worktree
  answers `BRANCH_NOTHING_TO_COMMIT`. The handler only accepts a client-supplied `diff`;
  without one it answers 409 `LOCAL_FILESYSTEM_UNAVAILABLE`, and it never emits
  `BRANCH_NOTHING_TO_COMMIT`. `postMissionsByIdGenerateCommitMessage`.
- **M4** (open). `MissionBranchListDto` is documented as "available branches in a mission
  project's primary repository"; `listMissionBranches` returns at most the mission's
  current (prepared or pinned) branch. `getMissionsByIdBranches`.
- **M5** (open). `MissionBranchDto.hasUnpushedCommits` and `observationSource: 'server'`
  are declared but never produced by `missionBranchDto` /
  `mergeMissionBranchObservation`; `observedAt` and `observationSource` are absent rather
  than null before an observation.
- **M6** (open). rest-notes.md says mission routes accept a mission display id. `PATCH
  /api/missions/{id}/objectives/reorder` authorizes the display id but then queries by the
  raw reference and answers 404.

### Activity and Inbox (batch 1)

- **A1** (open). rest-notes.md describes the activity feed's `before` as "ISO-8601 UTC";
  `parseFeedBefore` (`backend/activity-feed.ts`) accepts only
  `YYYY-MM-DDTHH:mm:ss.sssZ` exactly and answers 400 for any other form.
  `getActivityFeed`.
- **A2** (open). `ActivityFeedDto.counts` is typed `Record<string, number>`; the code
  always writes exactly `mission_run`, `blocking_question` and `mission_delivered`, which
  the schema requires.
- **A3** (open). `ActivityFeedItemBaseDto.kind` is typed as an open vocabulary; the server
  emits only `mission_run`, `mission_delivered` and `blocking_question`, and the schema
  is closed to those three. Adding a kind is therefore a description change.

### Profile and user tokens (batch 2)

- **U1** (open). `ProfileDto.authProvider` is typed `string | null` ("when the account is
  externally federated"); `toProfileDto` (`backend/repository.ts`) always writes
  `'better-auth'`. The schema keeps the nullable type and says so. `getProfile`,
  `patchProfile`.
- **U2** (open). `UserTokenStatus` (and the `user_tokens.status` CHECK) admit `expired` and
  `rotated`; no route writes either. Expiry is evaluated when the token authenticates, so a
  token past `expiresAt` still lists as `active`. `getUserTokens`.
- **U3** (open). `CreateUserTokenBody.expiresAt` is typed `string | null`; `createUserToken`
  passes any non-null value through `new Date(...)`, so a number is accepted as epoch
  milliseconds (reproduced). `postUserTokens`.

### Organizations and workspaces (batch 2)

- **W1** (open). rest-notes.md says `POST /api/onboarding` "returns `/api/meta`". It returns
  `buildMeta()` evaluated against the request's pre-onboarding authorization snapshot, so
  over HTTP `organization` and `workspace` are null and `workspaces` is empty, while
  `organizations` lists the new organization with `isActive: false` (reproduced).
  `postOnboarding`.
- **W2** (open). `WorkspaceDto.isActive` ("the web server's currently active workspace") and
  `MetaDto.workspace` ("the server's default-scope workspace") describe an ambient workspace
  that authenticated requests never have: `isActive` is always `false` and `workspace`
  always null for session and token callers (reproduced). `getMeta`, `getWorkspaces`,
  `postWorkspaces`, `patchWorkspacesById`, `postInvitationsAccept`.
- **W3** (open). `UpdateWorkspaceBody.sqlStudioEnabled` is documented "Admin-only";
  `updateWorkspace` (`backend/workspaces.ts`) lets a `MANAGER` set it, and stores any JSON
  value without a type check (a non-boolean then reads back as the server default).
  `patchWorkspacesById`.
- **W4** (open). `WorkspaceMemberDto.isOperator` says "belongs to the local operator"; it
  marks the authenticated caller's membership. `OrganizationDto.isActive` is optional in
  packages/contract but always written. `getWorkspacesByIdMembers`, `getOrganizations`.
- **W5** (open). The bootstrap recorded `postWorkspaces` as `workspace:create`. The route
  evaluates it only when the request has an attributed workspace member, which session and
  token requests never have; the effective gate is `canViewOrganizationSettings` (an active
  `ADMIN` role in any live workspace of the organization). The permission is now
  `workspace-admin`.
- **W6** (open). `getWorkspacesByIdObjectivesCsv` checks `workspace:read` in any authorized
  workspace, then an `ADMIN` role in the target workspace (`requireWorkspaceAdmin`). The
  permission stays `workspace:read` with the role gate in the description.

### Meta and sign-in handoffs (batch 2)

- **H1** (open). `GET /api/meta` answers `MetaDto` plus `databasePath`, `backendMode`, `web`,
  `sqlStudio`, `authProviders` and `capabilities` (`backend/app.ts`); no type in
  packages/contract declares those members. The schema is `ServerMetaDto`. `databasePath`
  discloses the server's SQLite file path to every authenticated caller and is also written
  on Postgres, where it means nothing. `getMeta`.
- **H2** (open). rest-notes.md says the desktop callback "redirects only to
  `overlord://auth/callback`". Without a browser session `getAuthDesktopCallback` redirects
  to itself with `error=state_mismatch`, and that request (lacking the native flow marker)
  answers a plain-text 400 page (reproduced).

### Notifications and mobile registrations (batch 2)

- **N1** (open). `PUT /api/profile/notification-preferences` is a partial merge, not a
  replacement: omitted pairs keep their stored mode and an empty body answers the current
  preferences (`updateNotificationPreferences`, `backend/push-notifications.ts`).
  `putProfileNotificationPreferences`.
- **N2** (open). Of the six mobile token routes, `PUT
  /api/mobile/live-activities/{activityId}/push-token` answers 200 `{ ok: true }` and the
  other five answer 204 with no body (reproduced). It is also the only one that needs an
  active workspace membership (403 `No active workspace membership` without one, to address
  the dispatch job). `putMobileLiveActivitiesByActivityIdPushToken`.

### Storage (batch 2)

- **S1** (open). rest-notes.md and the comment on the serve route (`backend/app.ts`) say
  `/storage/:bucketKey/:storageKey` serves bytes "only after an exact active metadata lookup
  for `(storage_bucket_id, storage_key)`". The `organization-images` branch of
  `resolveStoredObject` (`backend/storage.ts`) has no metadata table and reads the key as
  given from the selected organization's bucket. `getStorageByBucketKeyByStorageKey`.
- **S2** (open). An `organization-images` upload writes bytes only: no metadata row, no
  entity change, and the returned `id` names no row (`uploadOrganizationImage`).
  `postUploadsByBucketKey`.

### Realtime (batch 2)

- **R1** (open). rest-notes.md calls `/realtime` (and its alias `/api/stream`) an
  "SSE/WebSocket endpoint"; the backend serves Server-Sent Events only (`RealtimeHub.addClient`,
  `backend/realtime.ts`) and registers no WebSocket upgrade. `getRealtime`, `getStream`.
- **R2** (open). `getStream` keeps `x-overlord-consumers: [unverified]`: no caller of
  `/api/stream` exists in webapp, cli, desktop, mcp or OverlordMobile (all use `/realtime`
  and `/sync/changes`). Its permission is `project:read` (admission needs it in at least one
  authorized workspace), as for `/realtime`.
- **R3** (open). A stream ends whenever any `role_assignment`, `user_token`,
  `user_token_workspace`, `workspace` or `workspace_user` change is committed anywhere on the
  server, not only in the subscriber's workspaces (`reconnectClientsForAuthorizationChange`
  closes every client). Reproduced: renaming a workspace closed an open stream. Clients
  reconnect, so this is load, not data loss.

### Hosted MCP OAuth and the MCP transport (batch 2)

- **O1** (open). rest-notes.md lists `GET /oauth/authorize` as the browser authorization
  redirect; the authorization-server metadata advertises `<base>/oauth/approve` (the web page)
  as `authorization_endpoint` (`oauthAuthorizationServerMetadata`, `backend/oauth.ts`), so a
  client following discovery never calls `/oauth/authorize` (reproduced).
  `getWellKnownOauthAuthorizationServer`, `getOauthAuthorize`.
- **O2** (open). `GET /mcp` reports `endpoint` from `req.protocol` and `Host`
  (`mcpServerInfo`, `mcp/server.ts`), while the OAuth `resource` comes from
  `webPublicBaseUrl` (the configured public URL, else `https` for any non-local host). Behind a
  TLS-terminating proxy the two differ (`http://…/mcp` against `https://…/mcp`). `getMcp`.
- **O3** (open). The token response sets no `Cache-Control: no-store` (RFC 6749 §5.1)
  (reproduced). `postOauthToken`.
- **O4** (open). The `/mcp` endpoint is not MCP Streamable HTTP: `GET` answers a JSON server
  description instead of an SSE stream or 405, and `POST` always answers JSON (no SSE
  upgrade, no `Mcp-Session-Id`). JSON-RPC errors use HTTP 200. `getMcp`, `postMcp`.
- **O5** (open). `POST /oauth/register` accepts a form-encoded body, but a single
  `redirect_uris` value parses as a string and is refused 400 (reproduced); only JSON or a
  repeated key works. `POST /oauth/revoke` revokes any live user token whose secret is
  presented, personal tokens included, without client authentication, and always answers 200.
  `postOauthRegister`, `postOauthRevoke`.

### Account connections (batch 2)

- **C1** (open; reproduced). rest-notes.md says `POST /api/connections` with
  `provider: 'everhour'` answers 400 `invalid_request`. That holds on Cloud only: a non-GitHub
  provider takes the organization path, whose owner gate runs first, so on Local it answers
  404 `chat_unavailable` (`createConnectionsRouter`, `backend/connections/routes.ts`).
  `postConnections`.
- **C2** (open). The default `GET /api/connections` listing writes as it reads: a connected
  Knowledgebase grant whose access and refresh have both expired is moved to
  `reauthorization_required` (`AccountConnections.list`). `getConnections`.
- **C3** (open). `ChatErrorCode` responses from the connections router (`not_found`,
  `chat_unavailable`, `invalid_request`, `stale_revision`, `provider_not_available`,
  `provider_not_ready`, `credential_rejected`, `provider_unavailable`) reach `apiErrorHandler`
  as `ServiceError`s and conform to `ErrorEnvelope` with `error` set to the code with spaces
  (`chat unavailable`); any other failure becomes 500 `Connection request failed` with no
  `detail`, unlike the generic 500.

### Run Queues (batch 3)

- **Q1** (open, TypeScript optionality). `RunQueueEntryDto.waitingReason`,
  `waitingOnObjectiveId`, `waitingOnObjectiveDisplayId` and `attemptCount` are optional in
  packages/contract; `entryDto` (`packages/core/service/run-queue.ts`) always writes them, so
  the schema requires them.

### Execution targets (batch 3)

- **T1** (open). `ExecutionTargetRunnerRegistrationDto` (packages/contract) has no
  `executionTargetId`; `listRunnerRegistrations` (`packages/core/service/execution-target-runners.ts`)
  writes it on every registration in `WorkspaceExecutionTargetDto.runnerRegistrations`, so the
  schema includes it. `WorkspaceExecutionTargetDto.status` is typed `string`; the column admits
  `active`, `disabled` and `unavailable`, which the schema enumerates.
  `getWorkspacesByIdExecutionTargets`, `postWorkspacesByIdExecutionTargets`,
  `patchWorkspacesByIdExecutionTargetsByTargetId`.
- **T2** (open). `GET /api/workspaces/{id}/execution-targets` writes as it reads: devices with no
  live execution target are soft-deleted before the list is built (`softDeleteOrphanDevices`).
- **T3** (open). The two observation routes accept either `launch:configure` or
  `execution_request:claim` (`requireExecutionTargetObservationContext`,
  `backend/branching/execution-target-observation-scope.ts`), so their permission stays `unknown`
  with both as candidates (ADR 0048). `postExecutionTargetsByIdObservations`,
  `postExecutionTargetsByIdMissionBranchObservations`.

### Agent catalog and launch settings (batch 3)

- **L1** (open). The query-addressed agent catalog and launch settings routes
  (`getAgentCatalog`, `putAgentCatalog`, `postAgentCatalogRefresh`, `getLaunchSettings` and the
  four `patchLaunchSettings…` operations) treat `workspaceId` as optional and fall back to the
  request's implicit workspace (`resolveCatalogWorkspaceId`, `backend/agent-catalog.ts`;
  `resolveLaunchSettingsScope`, `backend/execution/launch-settings.ts`). Session and token
  requests never have one, so over HTTP the parameter is required in practice and its absence
  answers 400 `workspaceId is required`. `AgentCatalogModelDto.enabled` is optional in
  packages/contract but `toCatalogDto` always writes it.
- **L2** (open). `GET /api/workspaces/{id}/agent-catalog` and `GET /api/agent-catalog` write
  on first read: a workspace without a stored catalog has the instance default persisted as its
  `agentCatalog` setting (`getAgentCatalog`).
- **L3** (open). `ResolvedLaunchSessionDto.viewer` (packages/contract) declares `kind`,
  `launcher` and `openOnLaunch`; `resolveLaunchSession`
  (`packages/core/service/terminal-profile-types.ts`) also writes `openAs` (`window`/`tab`, from
  the placement) and `background`, which the schema includes. `TerminalProfileDto.executionProvider`
  and `openViewerOnLaunch` are optional in the type but `toTerminalProfileDto` always writes them
  (null when inherited). `getLaunchSettings`, `getWorkspacesByIdLaunchSettings` and the
  launch-settings updates.
- **L4** (open). The terminal-profile updates store `launcher`, `placement`, `chord` and
  `background` without validating them and answer the submitted values, while a later read
  normalizes them (`terminalProfileFromBody`, `parseTerminalProfileJson`); the session-defaults
  update stores `openViewerOnLaunch` and `worktreeBranchAutomationEnabled` without a type check.
  `PUT /api/projects/{id}/launch-preference` is a partial merge, not a replacement.
- **L5** (open). `patchLaunchSettingsWorktreeBranchAutomation` and
  `patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomation` keep
  `x-overlord-consumers: [unverified]`: no caller exists in webapp, cli, desktop, mcp or
  OverlordMobile (the web settings page writes the flag through `session-defaults`).

### Worktrees and the local-target proxy (batch 3)

- **J1** (open). `GET /api/worktrees` always answers `[]` and `PurgeWorktreesResultDto.worktrees`
  is always empty (`listWorktrees`, `removeWorktree`, `purgeMergedWorktrees`,
  `backend/repository.ts`); listing runs on the client through the local-target bridge. The
  comment on the routes in `backend/app.ts` calls them "local-backend-only host-side git
  operations"; removal and purge are queued to the execution target serving the project, and
  without a `projectId` they answer 409 `LOCAL_FILESYSTEM_UNAVAILABLE` on every backend.
  `getWorktrees`, `postWorktreesRemove`, `postWorktreesPurgeMerged`.
- **J2** (open). `POST /api/local-target/invoke` answers capability failures, including the
  default `LOCAL_TARGET_REQUIRED` when the development proxy is off, as 200 results
  (`invokeLocalTargetOnServer`, `backend/execution/local-target-invoke.ts`). Unlike the runner
  routes it has no loopback local-operator fallback (only `/api/protocol/*`, `/api/runner/*` and
  `/mcp` do, `usesNonBrowserAuthSurface` in `backend/auth.ts`).
  `postLocalTargetInvoke`.

### Runner and protocol transport (batch 3)

- **K1** (open). `RunnerExecutionRequestDto` extends `ExecutionRequestDto` in packages/contract,
  but `serviceSummaryToDto` (`backend/execution/runner.ts`) never writes
  `localTargetMutationKind`; it adds `metadata` and `workingDirectory`. The schema is a separate
  `RunnerExecutionRequestDto` with exactly the written members, and `RunnerClaimedRequestDto`
  extends it with `allOf` (G5). `getRunnerStatus`, `postRunnerClaim`, the
  `postRunnerRequestsById…` transitions.
- **K2** (open). The bootstrap recorded `getRunnerStatus`, `postRunnerClaim` and `postRunnerClear`
  as `unknown`. Their handlers resolve scope from the caller's active workspace memberships
  (`resolveRunnerScopes`, `callerWorkspaceMemberships`) and name no RBAC action, so the permission
  is now `authenticated`. The four request transitions check `execution_request:claim` in the
  request's workspace (`requestRunnerContext`).
- **K3** (open). `GET /api/runner/status` writes as it reads: stale claims are expired in each
  workspace before listing (`expireStaleExecutionRequests`). `POST /api/runner/claim` on Postgres
  flushes a 200 status before the body is known, so a failure during the long poll answers
  `{ request: null, longPoll: true }` rather than an error (`sendRunnerClaimResponse`).
- **V1** (open). `postProtocolBySubcommand` keeps `x-overlord-permission: unknown` with every
  action named in the subcommand dispatch table as a candidate (ADR 0048): the action depends on
  the subcommand, and protocol-commands.yaml (ADR 0008) owns the per-subcommand detail. Over
  loopback with no bootstrap workspace member, a subcommand that needs a workspace answers 500
  `No active workspace for this request…` (reproduced).

### Agent requests, session inputs and the adapter channel family (batch 3)

- **X1** (open). No route mints an agent-session channel credential any more:
  `POST /api/missions/{id}/session-channel` answers 410 `session_controls_gone`
  (`prepareMissionSessionChannel`, `backend/agent-session-routes.ts`) and nothing else calls
  `createSessionChannel`. The `/api/agent-session-channels/v1/*` family therefore serves only
  channels created before that change (a credential lives at most 24 hours), and no route
  enqueues session inputs (`enqueueSessionInput` has no caller). The schemas were validated
  against channels and inputs created directly in a scratch database.
- **X2** (open). `postMissionsByIdSessionChannel`, `postAgentRequestsByIdRelease`,
  `postAgentSessionInputs` and `postAgentSessionInputsByIdCancel` answer 410 for every
  authenticated caller without reading the request; their permission is now `authenticated`
  (bootstrap: `unknown`). The web app still calls the last three and the CLI calls
  `POST /api/agent-session-inputs`. `getAgentSessionChannelsV1Self` and
  `postMissionsByIdSessionChannel` keep `x-overlord-consumers: [unverified]`: the CLI channel
  client never calls `/self`, and no client calls the retired mint.
- **X3** (open). `GET /api/agent-session-inputs` answers `{ inputs: [] }` without
  `liveChannelId` and `liveChannel` when the caller has no active membership, and the full
  object otherwise. The routers in
  `backend/agent-session-routes.ts` write service errors as `{ error, code }` themselves (never
  `details`); other failures reach `apiErrorHandler`.

## 2. Non-conforming error shapes

Every route in `backend/app.ts` that forwards errors through `handle()` or `next(err)`
answers with `ErrorEnvelope` (`backend/errors.ts` `apiErrorHandler`). The envelope is
one shape with origin-dependent members: `{ error, detail?, code? }` from `ApiError`,
`{ error, code, details? }` from `ServiceError`, `{ error, code: 'body_too_large' }`
from the body parser, `{ error, detail }` from a SQLite constraint failure and from an
unexpected exception, and `{ error }` from the authentication middleware (401) and the
project-automation route guard (404).

- **E1** (open). The envelope carries both `detail` (string, from `ApiError`) and
  `details` (any JSON, from `ServiceError`). Two near-identical member names with
  different types; a later contract change should pick one.
- **E2** (open). `POST /api/auth/desktop/exchange` (`postAuthDesktopExchange`) and
  `POST /api/auth/browser/exchange` (`postAuthBrowserExchange`) answer 401 with
  `{ message }` (`backend/app.ts`), not `{ error }`.
- **E3** (open). `GET /api/auth/browser/callback` (`getAuthBrowserCallback`) answers 400
  and 401 with `text/plain` bodies (`backend/app.ts`).
- **E4** (open, probably intended). The OAuth endpoints answer RFC 6749 errors
  `{ error, error_description }` (`backend/oauth.ts` `jsonError`), where `error` is an
  OAuth code, not a message.

- **E3 correction** (batch 2, reproduced). The 400 and 401 bodies of
  `getAuthBrowserCallback` are `text/html; charset=utf-8` (Express `res.send` of a string),
  not `text/plain`.
- **E5** (open). `GET /api/auth/desktop/github` (`getAuthDesktopGithub`) passes Better
  Auth's error responses through unchanged, `{ message, code }`; with GitHub sign-in not
  configured that is 404 `{ message: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }`
  (reproduced). Its 503 (too many open flows) and the desktop callback's error page are
  `text/plain`. Described with `MessageErrorBody`.
- **E6** (open, probably intended). The OAuth connection callbacks
  (`getAuthCallbackGithubRepository`, `getConnectionsKnowledgebaseCallback`) answer an HTML
  status page (200 connected, 400 otherwise) when the flow has no return target; they never
  answer JSON.

- **E7** (open). `POST /oauth/authorize/request` and `/oauth/authorize/approve` answer
  `ErrorEnvelope` whose `code` is an OAuth error code (`invalid_request`, `invalid_client`,
  `invalid_scope`, `invalid_target`, `unsupported_response_type`), while the other OAuth
  endpoints answer E4's `{ error, error_description }`. `postOauthRegister` and `postOauthToken`
  fall back to `ErrorEnvelope` for 413 and 500.

## 3. Suspected code defects

Suspected code defects found while writing the schemas are tracked privately by the
maintainers, not in this public file.

## 4. Generator constructs needed

Constructs used beyond the subset Clear Comply's generator
(`scripts/generate-api-contract.mjs`) translates. Phase 4c must support each or the
schema must change.

- **G1** `JsonValue` (a schema with no `type`, any JSON value): artifact `contentJson`,
  shared-context `value`, ServiceError `details`, repository-read `data`. Needs
  `z.unknown()`.
- **G2** `additionalProperties: true` (an open object): `ProjectResourceSourceDto.descriptor`.
  Clear Comply's generator renders it as a plain `z.object({})`, which strips unknown
  keys; it needs `z.record(z.string(), z.unknown())`.
- **G3** Non-JSON request bodies (`'*/*'` raw uploads with `RawUploadBody`, a string
  with `contentMediaType`), header parameters, and `text/event-stream` or file
  responses. The Clear Comply generator reads only JSON success responses.
- **G4** String bounds (`minLength`, `maxLength`) are ignored by the Clear Comply
  generator; they are documentation until 4c renders them.
- **G5** `allOf` for a DTO that extends another (`MissionDetailDto` = `MissionDto` +
  detail projections; `SearchResultV3`, `SearchAppliedFiltersV3`). Needs `.extend()`/`z.intersection`; the alternative is
  repeating every `MissionDto` property in each extension.
- **G6** `$ref` with sibling keywords (`description`) on a property. Valid OpenAPI 3.1;
  the Clear Comply generator ignores the siblings, which is harmless.

- **G7** `format: uuid` on server-minted ids. The Clear Comply generator renders it as
  `z.string().uuid()`, but the backend test fixtures use readable ids
  (`local-workspace`, `operator-workspace-user`, `test-organization`), so validating
  responses in backend tests (ADR 0006) will reject them unless the fixtures move to
  UUIDs or 4c renders the format leniently. Batch 1's own response check accepted any
  string for `uuid` for this reason.
- **G8** A JSON response that is a `oneOf` of two object schemas distinguished only by
  their key sets (`getMissionsByIdFileChanges`: `MissionFileChangesDto` is
  `additionalProperties: false` so it cannot also match `ObjectiveFileChangesDto`).
  Needs `.strict()` on that member, which the generator already emits.

- **G9** A `204` success with no body, written by `handle()` callers that end the response
  with `res.status(204).end()`: `deleteUserTokensById`. The Clear Comply generator reads
  only JSON success responses.

- **G10** Redirect (`302`) success responses with `Location`/`Set-Cookie` response headers,
  and `text/plain` / `text/html` error bodies: the sign-in handoffs and OAuth callbacks
  (`getAuthDesktopGithub`, `getAuthDesktopCallback`, `getAuthBrowserCallback`,
  `getAuthCallbackGithubRepository`). Express's `res.redirect` also writes a short notice
  body that the description does not model.
- **G11** An optional security requirement (`{}` alongside the session schemes) on
  `getAuthDesktopCallback` and `getAuthBrowserCallback`, which read a browser session when
  present and redirect or answer a page without one instead of 401.

- **G12** A JSON request body on `DELETE`: `deleteNotificationsById` (`expectedRevision`).
  G9's 204 responses also cover `deleteMobileLiveActivitiesByActivityIdPushToken`,
  `putMobileLiveActivitiesStartToken`, `postMobileLiveActivitiesStartTokenRevoke`,
  `putMobilePushDeviceToken` and `postMobilePushDeviceTokenRevoke`.

- **G13** A `201` success (`postOauthRegister`), form-encoded request bodies
  (`application/x-www-form-urlencoded`) offered alongside JSON (`postOauthRegister`,
  `postOauthToken`, `postOauthRevoke`), and request or response bodies that are a `oneOf` of an
  object and an array of it (`postMcp`, JSON-RPC batches).
- **G5** also covers `ServerMetaDto` (`MetaDto` plus server fields) and `OAuthApproveBody`
  (the authorization request plus the decision).

- **G12** also covers the optional JSON bodies of `deleteRunQueuesByQueueId` (`moveEntriesTo`)
  and `deleteRunQueuesEntriesByEntryId` (`force`) (batch 3).

- **G14** Error-only operations with no success response: `postMissionsByIdSessionChannel`,
  `postAgentRequestsByIdRelease`, `postAgentSessionInputs` and
  `postAgentSessionInputsByIdCancel` always answer 410 (batch 3).
- **G5** also covers `RunnerClaimedRequestDto` (`RunnerExecutionRequestDto` plus launch
  preparation) and `HumanAgentRequestDto` (`AgentRequestDto` plus `delivery`). **G3** also covers
  the `X-Overlord-Device-Fingerprint` header parameter on the execution-target, launch-settings
  and observation operations, and `postRunnerClaim`'s Postgres long poll, whose headers are
  flushed before the body is written (batch 3).

## 5. Operations left as stubs

None from batch 1: every operation tagged missions, objectives, deliveries, activity,
inbox, projects, project-statuses and project-resources (81) has schemas.

None from batch 2: every operation tagged workspaces, organizations, profile, user-tokens,
notifications, auth, oauth, meta, mcp, storage, realtime, mobile, webhooks and connections
(81) has schemas.

None from batch 3: every operation tagged run-queues, execution-targets, runner,
launch-settings, agent-catalog, agent-requests, agent-session-channels, agent-session-inputs,
worktrees, local-target and protocol (68) has schemas.
