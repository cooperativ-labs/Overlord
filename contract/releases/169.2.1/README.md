# Contract 169.2.1 production baseline

Contract impact of this record: none. It is release evidence under
`contract/releases/`, which the range check does not count as a contract change
([CONTRACT.md](../../CONTRACT.md) section 5, ADR 0052).

## Baseline statement

| Field | Value |
| --- | --- |
| Baseline contract version | `169.2.1` ([ADR 0053](../../decisions/0053-baseline-is-the-version-in-force.md)) |
| OpenAPI `info.version` | `2.2.0` |
| Date | 2026-11-12 |
| Candidate SHA (range start) | `9a71cf44214ab0ea85d655df5139221e91ca2c4b`, contract `169.2.0`, the last commit before the phase 5 work; recorded for the release gate in [../baseline.json](../baseline.json) |
| Baseline SHA | Not named here: a commit cannot contain its own SHA. The first `yarn release:finish` places the `production` tag and the `prod` branch on it; record it in the table below afterwards, in a later commit, without amending the baseline commit. |

`169.2.1` is the first contract version released through the release gate and
the version every later release range is measured from. It covers the whole
contract in `contract/` at that version:

- the entry point [CONTRACT.md](../../CONTRACT.md) and the topic documents
  ([architecture.md](../../architecture.md), [protocol.md](../../protocol.md),
  [authorization.md](../../authorization.md), [conformance.md](../../conformance.md),
  [data/README.md](../../data/README.md));
- the REST surface, [api/openapi.yaml](../../api/openapi.yaml): 279 operations, one
  for every registered route except the listed exclusions, with request and
  response schemas, a schema-stub ratchet of 0, request validation at the route
  boundary and response checks in the backend tests (ADRs 0048 to 0051);
- the machine-readable files (`components.yaml`, `protocol-commands.yaml`,
  `extension-points.yaml`, the manifest and descriptor schemas, golden vectors);
- ADRs 0001 to 0053 in [decisions/](../../decisions/README.md); and
- every conformance manifest in this repository and in `OverlordMobile`, restamped
  to `169.2.1`.

Changelog entries at or below `168` remain non-normative provenance.

### Recorded after the first release

| Field | Value | Recorded by, date |
| --- | --- | --- |
| Baseline SHA (`production` tag after the first `yarn release:finish`) | _pending_ | |
| `yarn release:preflight patch` output (range start to baseline SHA) | _pending_ | |

## Reconciliation of the former single-file contract

The provenance entries `## [95]` to `## [168]` were reconciled with the normative
documents in phase 3. Where every binding statement now lives, which ADR records
each decision and what later versions reversed is in
[decisions/backfill-register.md](../../decisions/backfill-register.md).

## Open disagreements carried forward

[api/schema-disagreements.md](../../api/schema-disagreements.md) records where
another source disagreed with the code while the OpenAPI description was
written. The description follows the code (ADR 0006). At the baseline:

| Section | Entries | Status at the baseline |
| --- | --- | --- |
| 1. Prose and type disagreements | 81 | 64 open; 17 closed (Z1, Z2, Z3, Z7 corrected in phase 4c; F1 to F4 resolved by schema changes and P3, M1, W1, H2, S1, R1, A1, C1, O1 resolved by rewording in phase 4d) |
| 2. Non-conforming error shapes | 9 | E1 to E9 open |
| 3. Suspected code defects | 0 here | Tracked privately by the maintainers |
| 4. Generator constructs | 17 | G1 to G17 supported; nothing open |
| 5. Operations left as stubs | 0 | All 279 operations have schemas |

The open entries are carried into the baseline unchanged; each is resolved later
by a contract change, a code change, or a recorded decision to keep the
behaviour.

### Operations whose permission is `unknown`

Each needs more than one RBAC action, chosen by the request; the description
lists them in `x-overlord-permission-candidates`.

| operationId | Route |
| --- | --- |
| `putProfileDefaultProject` | `PUT /api/profile/default-project` |
| `postUploadsByBucketKey` | `POST /api/uploads/{bucketKey}` |
| `getStorageByBucketKeyByStorageKey` | `GET /api/storage/{bucketKey}/{storageKey}` |
| `getObjectiveTranscript` | `GET /api/objective-transcript` |
| `getProjectsByIdMissions` | `GET /api/projects/{id}/missions` |
| `getMissionsById` | `GET /api/missions/{id}` |
| `postMissionsByIdGenerateTitle` | `POST /api/missions/{id}/generate-title` |
| `postExecutionTargetsByIdObservations` | `POST /api/execution-targets/{id}/observations` |
| `postExecutionTargetsByIdMissionBranchObservations` | `POST /api/execution-targets/{id}/mission-branch-observations` |
| `postProtocolBySubcommand` | `POST /api/protocol/{subcommand}` |

### Operations whose consumers are `unverified`

No caller was found in the web app, CLI, desktop app, MCP server or mobile app.

| operationId | Route |
| --- | --- |
| `getAgentSessionChannelsV1Self` | `GET /api/agent-session-channels/v1/self` |
| `getStream` | `GET /api/stream` |
| `postProjectsByIdRepositoryReads` | `POST /api/projects/{id}/repository-reads` |
| `getExtEverhourUserConnection` | `GET /ext/everhour/user-connection` |
| `putExtEverhourUserConnection` | `PUT /ext/everhour/user-connection` |
| `deleteExtEverhourUserConnection` | `DELETE /ext/everhour/user-connection` |
| `getExtEverhourIntegration` | `GET /ext/everhour/integration` |
| `putExtEverhourIntegration` | `PUT /ext/everhour/integration` |
| `deleteExtEverhourIntegration` | `DELETE /ext/everhour/integration` |
| `getExtGithubUserConnection` | `GET /ext/github/user-connection` |
| `deleteExtGithubUserConnection` | `DELETE /ext/github/user-connection` |
| `postExtGithubUserConnectionAuthorize` | `POST /ext/github/user-connection/authorize` |
| `getMissionsByIdObjectives` | `GET /api/missions/{id}/objectives` |
| `postMissionsByIdSessionChannel` | `POST /api/missions/{id}/session-channel` |
| `patchLaunchSettingsWorktreeBranchAutomation` | `PATCH /api/launch-settings/worktree-branch-automation` |
| `patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomation` | `PATCH /api/workspaces/{id}/launch-settings/worktree-branch-automation` |

### Operations without response-conformance coverage

The backend tests check every response they produce against its operation
(ADR 0051), but 147 of the 279 operations had no response reached by a test at
phase 4d. Their schemas are as good as the code reading behind them and are
not yet exercised. To list them:

```sh
cd backend && node ../scripts/with-ovld-home.mjs node ../scripts/api-conformance-report.mjs --uncovered -- node --import tsx --test '**/*.test.ts'
```

## Verification status

### Verified on 2026-11-12 (phase 5 working tree, contract 169.2.1)

| Check | Result |
| --- | --- |
| `yarn contract:check` | Passed for 169.2.1 |
| `yarn contract:test` | Passed, including the release-gate and `server:deploy` tests |
| `yarn api:generate:check` | Passed |
| `yarn contract:parity` | Passed |
| `yarn check:conformance-versions` | Passed; every manifest at 169.2.1 |
| `yarn connectors:check` | Passed |
| `ovld contract check` on every manifest (and `cli/test/contract-check.test.ts`) | Passed for all 15 manifests here and `OverlordMobile`'s |
| `yarn release:preflight patch --dry-run` from the phase 5 head, range from the candidate SHA | Passed: `Contract impact: patch (169.2.0 -> 169.2.1)` |
| Release gate end to end against throwaway local repositories | Passed: first release from the recorded range start, tag and `prod` placement, a second release from the tag, refusals for a dirty tree, a stale stamp, a non-fast-forward of `prod` and a moved tag |

### Not verified

- **Postgres.** The Postgres conformance batteries (`yarn test:conformance`) did not
  run; the backend suite ran its SQLite batteries only (`TEST_DATABASE_URL` unset).
- **A real S3 provider.** Storage was exercised only against the local object store.
- **Successful provider calls.** No call to GitHub, Everhour, a Knowledgebase server,
  Gemini, APNs or any other external provider succeeded in the verification; their
  operations are described from the code and tested with stubs.
- **The release commands' real side effects.** No npm publish, GitHub release,
  `railway up`, Vercel deployment, `production` tag or `prod` branch was created; the
  gate was exercised by unit tests, dry runs and throwaway repositories only.
- **CI on the baseline SHA.** The Contract workflow has not yet run on the baseline
  commit.
- **Response coverage** of the 147 operations listed above.

## Approvals

Overlord has one owner, who holds every role below. Signing records approval of
the baseline as Overlord's production compatibility promise; it does not waive
the release gate. Sign before the first release so the signature is in its range
(a later signature is also a `none` change, being a release record).

| Role | Holder | Decision | Date |
| --- | --- | --- | --- |
| Product owner | _to be signed_ | _approve / reject_ | |
| Engineering owner | _to be signed_ | _approve / reject_ | |
| Contract owner | _to be signed_ | _approve / reject_ | |
| Security and authorization reviewer | _to be signed_ | _approve / reject_ | |
