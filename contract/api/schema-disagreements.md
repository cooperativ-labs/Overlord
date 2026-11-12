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
  raw reference and answers 404 (X10).

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

## 3. Suspected code defects

Found while reading handlers; not fixed in phase 4b (no runtime change). Each needs a
decision and, if confirmed, a fix with its own contract impact.

- **X1** (open, all routes). A malformed JSON body answers **500**
  `{ error: <parser message>, detail: <same> }` instead of 400: `apiErrorHandler` maps
  only the body parser's `entity.too.large`, not `entity.parse.failed`. Reproduced
  against `backend/errors.ts`.
- **X2** (open, all routes). A request from an origin CORS rejects answers 500: the
  `cors` origin callback raises a plain `Error` that `apiErrorHandler` treats as
  unexpected.
- **X3** (open, Postgres). `apiErrorFromDatabaseError` maps only `SQLITE_CONSTRAINT*`
  codes; the same unique or foreign-key violation on Postgres answers 500 instead of
  409/400, so the two editions answer differently.
- **X4** (open, raw uploads). `readRawUpload` (`backend/http/raw-upload.ts`) calls
  `decodeURIComponent` on `x-upload-filename` unguarded; a malformed percent-encoding
  answers 500 `URI malformed` instead of 400. Reproduced.
- **X5** (open, raw uploads). The attachment routes' raw parser limit equals
  `MAX_ATTACHMENT_BYTES`, so an oversized upload is always refused by the parser
  (`body_too_large`) and `assertAttachmentBytes`'s own 413 message is unreachable.
- **X6** (open, many routes). Handlers call string methods on body members without a
  type check (`body.name.trim()`, `body.label.trim()`, `body.title.trim()`,
  `body.instructionText.trim()`, …). A member of the wrong JSON type (number, object)
  answers 500 with a `TypeError` message instead of 400. The schemas declare the
  intended types; the code does not enforce them.
- **X7** (open, high). `DELETE /api/projects/{id}/tags/{tagId}`
  (`deleteProjectsByIdTagsByTagId`) and `DELETE /api/projects/{id}/resources/{resourceId}`
  (`deleteProjectsByIdResourcesByResourceId`) call the async `deleteProjectTag` /
  `deleteProjectResource` without `await` (`backend/app.ts`). The route answers 200
  `{ ok: true }` before authorization or lookup runs; a forbidden or missing id is never
  reported, and the rejected promise is unhandled. The backend installs no
  `unhandledRejection` handler, so on Node's default (`--unhandled-rejections=throw`)
  such a request terminates the server process.
- **X8** (open). `PATCH /api/projects/{id}/statuses/reorder`
  (`patchProjectsByIdStatusesReorder`) checks the list's length and membership but not
  uniqueness, unlike the project and board reorders; a list repeating one id and
  omitting another leaves two statuses on the same position.
- **X9** (open). `PATCH /api/projects/reorder` (`patchProjectsReorder`) requires every
  project, archived included, but answers with `listProjectsForWorkspace`'s default
  `active` lifecycle, so the reordered archived projects are missing from the response.

- **X10** (open). `reorderFutureObjectives` (`backend/repository.ts`) resolves the mission
  reference for authorization but reads the mission and its objectives with the raw
  `missionId` argument, so a display id answers 404 `Mission not found`.
  `patchMissionsByIdObjectivesReorder`.
- **X11** (open, authorization). `POST /api/missions/{id}/generate-title`
  (`postMissionsByIdGenerateTitle`) rewrites the mission title after checking only
  `mission:read` and `objective:read` (`generateMissionTitle` → `getMissionDetail`); no
  `mission:update` check.
- **X12** (open, authorization). `POST /api/missions/{id}/terminal-sessions/forget`
  (`postMissionsByIdTerminalSessionsForget`) rewrites an execution request's metadata
  after checking only `session:read` (`forgetMissionLatchSession`).
- **X13** (open, authorization and isolation). `POST /api/missions/{id}/branch-prepared`
  (`postMissionsByIdBranchPrepared`, `recordBranchPrepared` in
  `backend/execution/runner.ts`) evaluates no RBAC action: any active member can move a
  mission's active branch. It resolves the mission across every active membership of the
  profile (`callerWorkspaceMemberships`), not the request's organization-bounded and
  token-consented workspace set, and takes the first row when a display id matches in
  several workspaces instead of answering 409. Its permission is recorded as
  `workspace-member` to describe what the code does.
- **X14** (open). Mission search `limit` (v1, v2, v3) has no upper bound
  (`searchWorkspaceMissions`, `allocateWorkspaceSearchLimits`), and `statusTypes` values
  are not validated. `getMissionsSearch`, `getMissionsSearchV2`, `getSearchV3`.
- **X15** (open, SQLite). A cross-project `PATCH /api/missions/{id}` turns
  `PRAGMA foreign_keys` off on the shared SQLite connection around its transaction
  (`updateMission`); any statement another request runs in that window is not
  foreign-key checked. `patchMissionsById`.
- **X16** (open). `PUT /api/missions/{id}/context` stores every non-object value as its
  string form (`writeSharedContext`): `null` reads back as the string `"null"` and `5` as
  `"5"`. `putMissionsByIdContext`.

- **X17** (open). `PATCH /api/objectives/{id}` (`patchObjectivesById`, `updateObjectiveTx`)
  writes a requested `position` as given; a position another live objective of the
  mission holds violates the `(mission_id, position)` uniqueness and answers SQLite's
  generic 409 `Database constraint violation.` (500 on Postgres, X3) instead of
  renumbering like the reorder route.

- **X18** (open). Due dates are validated with `Date.parse` only (`createMission`,
  `updateMission`, `validateInboxBody`), which is looser than storage: SQLite's CHECK
  accepts only `YYYY-MM-DDTHH:mm:ss.sssZ`, so other parseable text answers 409
  `Database constraint violation.`; Postgres normalizes what it can parse and fails (500)
  on what it cannot. Inbox create and update also echo the request text instead of the
  stored value. `postMissions`, `patchMissionsById`, `postInbox`, `patchInboxById`.

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

## 5. Operations left as stubs

None from batch 1: every operation tagged missions, objectives, deliveries, activity,
inbox, projects, project-statuses and project-resources (81) has schemas.
