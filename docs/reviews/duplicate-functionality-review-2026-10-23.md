# Duplicate functionality review — 2026-10-23

Scope: duplicated helpers, functions, and whole code paths across backend, core, CLI,
database, desktop, MCP, connectors, scripts, and webapp. The question was where an
agent wrote functionality that already existed.

Method:
1. Scan for top-level function names declared in more than one file.
2. Compare every candidate pair by hand.
3. For `backend/repository.ts` against `packages/core/service`, read all 24 same-named
   pairs in full.
4. Diff the hosted MCP catalog field by field against the local connector shim's
   `tools/list` output.

Contract impact: version 164 (see `CONTRACT.md`).

## Findings that had already caused bugs or drift

| Finding | Consequence | Fix |
| --- | --- | --- |
| The backend kept its own `nextMissionSequence`: read the counter, then write `next_value = <read + 1>`. Core's is an atomic `UPDATE … RETURNING`. | A scheduled duplicate created alongside any other mission create could overwrite the counter and reuse a mission number. The unique display-id index then rolls back the status change that triggered it (mainly on Postgres). | The scheduled-duplicate path calls core's allocator. |
| The two MCP tool catalogs were maintained by hand. The local shim drifted on 114 fields across 24 tools. | Local agents (Codex, Cursor, Antigravity) were never told about `agent`/`model` on `overlord_add_objectives` items, which the contract promised. They also had no typed delivery-report arrays, no `dateField` enum, no strict human-action items, and no safety annotations. The parity test compared only property names, so none of this was caught. | One catalog in `@overlord/contract/mcp-tools`. The shim's `tools` array is generated from it, and the test now checks deep equality. |
| REST `listObjectives` authorized a mission reference (a UUID or display id), then queried by the raw reference. | `GET /api/missions/<display-id>/objectives` returned `[]`. | Query by the resolved UUID. Regression test added. |
| CLI `resolveGlobalDataDir` did not resolve a relative `OVLD_HOME`. The database package's copy did. | A relative `OVLD_HOME` could make the CLI and the backend open different data directories. | The CLI and desktop use `database/src/local-paths.ts`. |
| Core `listProjects` was exported with no callers and ignored the token project allowlist. | It was a trap waiting for the first caller. | Removed. |

## Consolidated (behavior-preserving)

| Duplicate | Copies removed | Canonical home |
| --- | --- | --- |
| Mission schedule preview, get, upsert, and clear, plus the schedule row reader and DTO mapping | `backend/repository.ts` (~250 lines; core's module had no callers) | `packages/core/service/mission-schedules.ts` |
| Profile metadata parse, readers, and merge | `backend/repository.ts` | `packages/core/service/profiles.ts` (gains `editorScheme`) |
| Default project status seeding | `backend/repository.ts` | `seedDefaultProjectStatuses` in `packages/core/service/projects.ts` |
| Top-of-column board position | `backend/repository.ts` | `topBoardPosition` in `packages/core/service/missions.ts` (gains `excludeMissionId`) |
| `slugify` and `deriveProjectResourceKey` | `backend/repository.ts` | `packages/core/service/util.ts`, `project-resource-key.ts` |
| `isTruthyFlag` | `backend/repository.ts`, core `missions.ts`, `projects.ts`, `objective-parallelism.ts` | `packages/core/service/util.ts` |
| Migration `checksum`, `migrationComponent`, and `MIGRATION_FILE_PATTERN` | `database/src/{connection,launch-local,migrate-postgres}.ts` | `database/src/migration-files.ts` |
| `normalizeBaseUrl` | four CLI files and `desktop/src/cli-auth-sync.ts` | `packages/contract/src/base-url.ts` |
| `resolveGlobalDataDir` (`~/.ovld`) | `cli/src/config.ts`, desktop `cli-auth-sync.ts`, `backend-config.ts`, and `main.ts` | `database/src/local-paths.ts` |
| `overlord.toml` writer and `tomlString` | desktop `main.ts` (a second renderer of the same file) | `renderOverlordToml` in `desktop/src/backend-config.ts` |
| `load-repo-env.ts` | `webapp/load-repo-env.ts` (byte-identical to the backend copy) | `backend/load-repo-env.ts` |
| `normalizeEnvFileValue` | `backend/load-repo-env.ts` | `cli/src/env.ts` |
| `parseEnvValue` | `scripts/build-desktop.ts` | `scripts/load-repo-env.mjs` |
| `promptLine` | `cli/src/{setup,auth-login,management}.ts` (they differed only in the TTY error text) | `cli/src/prompt.ts` |
| `isRecord` | `mcp/{server,search-detail,run-queue-detail}.ts` | `mcp/records.ts` |

REST routes keep their paths, request shapes, success shapes, RBAC, and change-feed
attribution. The only visible difference: schedule validation errors keep their
status and `error` text and add `code: validation_error`.

## Found and intentionally left

- **Frozen migration copies.** `database/src/project-resources-resource-key-migration-runtime.ts` keeps its own `slugify`/`deriveProjectResourceKey`. A migration must stay frozen to the algorithm it shipped with.
- **Same names, different meaning.** These are not duplicates:
  - `backend/workspaces.ts` `slugify` (different fallback and length);
  - `desktop/src/local-target-bridge.ts` home resolution (also honours `OVERLORD_HOME`);
  - `cli/src` `asRecord`, whose two variants return `null` and `{}` respectively.
- **REST and core functions that share a name but return different projections.** Each serves a different consumer, so a merge would change one of the response contracts:
  - `listMissions` (board list versus agent summary);
  - `getProject`, `listProjects`, `listProjectStatuses`, and `listProjectResources` (different DTOs and scope);
  - `listObjectives`, `listMissionEvents`, and `listArtifacts`;
  - `createProject` (REST adds color, primary resource, and target workspace);
  - `searchMissions` (both already share `searchWorkspaceMissions`);
  - `updateObjective` (the full PATCH versus core's auto-advance toggle).
- **Already thin wrappers over core.** REST `assignMissionTags` and `insertObjective`.
- **Copies that load before shared code is available.** The desktop `main.ts` `.env` loader (Electron main runs before any repo env loader can be imported into the CommonJS bundle) and `scripts/load-repo-env.mjs` (runs without `tsx`).
- **Shim response compaction.** `compactSearchResponse` and `compactRunQueueResponse` exist both in `mcp/` and in the local shim. They are small, covered by tests on both sides, and the shim must stay standalone. They could be generated the same way as the tool catalog in a follow-up.
- **Webapp UI duplication.** `ProjectColorDot` is defined in three components, and the three settings `GeneralPage` components share structure. This is a candidate for a UI-focused follow-up.

## Verification

See the PR description for the exact commands and the before/after test comparison.
