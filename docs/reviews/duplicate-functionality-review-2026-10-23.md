# Duplicate functionality review — 2026-10-23

Scope: duplicated helpers, functions and code paths across backend, core, CLI, database, desktop, scripts and webapp.
Method: scan of top-level function declarations repeated across files, then manual comparison of the candidates.

## Consolidated in this change

| Duplicate | Copies | Canonical home |
| --- | --- | --- |
| `slugify` + `deriveProjectResourceKey` (byte-identical to core) | `backend/repository.ts` | `packages/core/service/util.ts`, `project-resource-key.ts` |
| `isTruthyFlag` | `backend/repository.ts`, core `missions.ts`, `projects.ts`, `objective-parallelism.ts` | `packages/core/service/util.ts` |
| `checksum`, `migrationComponent`, `MIGRATION_FILE_PATTERN` | `database/src/{connection,launch-local,migrate-postgres}.ts` | new `database/src/migration-files.ts` |
| `normalizeBaseUrl` | `cli/src/{auth-credentials,auth-login,auth-status,backend-client}.ts` | new `cli/src/base-url.ts` |

Behavior is unchanged: each removed copy was identical to the surviving one.
The backend's `deriveProjectResourceKey` and `slugify` were the likeliest to drift because core already owned them (the backend already imports core), so a rule change in one would have silently produced different resource keys in the other.

## Found but intentionally left

- `database/src/project-resources-resource-key-migration-runtime.ts` has its own `slugify`/`deriveProjectResourceKey`. A migration runtime must stay frozen to the algorithm at the time of the migration, so sharing it would let later edits change migration results.
- `backend/workspaces.ts` `slugify` differs (fallback `workspace`, own max length) — not a duplicate.
- `normalizeBaseUrl` in `desktop/src/cli-auth-sync.ts`: desktop does not depend on the CLI package; sharing needs a new shared package (contract impact), so left.
- `normalizeEnvFileValue` / `loadRepoEnvForProfile` ×3–4 (`backend/`, `webapp/`, `cli/`, `scripts/load-repo-env.mjs`): near-duplicates, but the `.mjs` script runs before TypeScript tooling is available. Recommend one shared `.mjs` module imported by the TS wrappers.
- `asRecord` (×6, cli + core), `requiredString`/`optionalString` (×3–5, mcp, connectors, backend), `isRecord` (×3 in `mcp/`), `shellQuote` (×3), `promptLine` (×3 in cli), `tomlString` (×3 in cli/desktop): small guards worth moving into a shared util per package in a follow-up.
- Webapp: `ProjectColorDot` defined in three components; three settings `GeneralPage` components share structure. Candidates for a shared component.
- `resolveGlobalDataDir` / `resolveDatabasePath` exist in `cli/src/config.ts`, `database/src/local-paths.ts`, and `backend/db.ts`; `cli` and `desktop` should call the database package's `local-paths` instead of recomputing the path.

## Verification

Dependencies were not installed in the review environment, so typecheck and tests were not run; the changes are import moves of identical code. CI should confirm.
