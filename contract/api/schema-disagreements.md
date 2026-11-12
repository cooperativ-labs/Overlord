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

## 5. Operations left as stubs

None from batch 1: every operation tagged missions, objectives, deliveries, activity,
inbox, projects, project-statuses and project-resources (81) has schemas.
