# Refactor Review — duplication (all areas) — 2026-11-23

## Scope

This is a scheduled, cross-area review for one smell only: **functionality that agents re-wrote
because they did not notice it already existed**. That means duplicate helpers, duplicate
functions, and parallel code paths for the same workflow. Areas covered: `backend/`,
`packages/core/`, `cli/`, `webapp/`, `desktop/`, `database/`, `auth/`, `automations/` and
`scripts/`. Generated files, build output and tests were excluded, except for test helpers that
are copied across many files.

### Method

- Counted repeated `function <name>` definitions across the repository, then read every copy side
  by side.
- Hashed function bodies, including with parameters renamed, to find identical copies stored
  under different names.
- Grepped for common inline idioms (`value === true || value === 1`, `.map(() => '?')`,
  `x instanceof Error ? x.message : …`, …).
- For each finding, checked which copy already had an export, a test, or the most callers, and
  chose that copy as canonical.

Contract impact: none. Every change in this PR is internal to a module or package. It moves no
REST route, protocol command, MCP tool, connector hook, schema, vocabulary, or shared
deterministic algorithm. Every canonical helper chosen had the same observable behaviour as the
copies it replaces, or the difference is noted below.

## Landed in this PR

| # | Duplicate | Copies removed | Canonical home |
|---|---|---|---|
| 1 | Semver compare + `x.y.z` parse | 5 private `compareSemver`/`compareVersions` and 4 version-regex copies in `cli/` | `cli/src/semver.ts` (old export names kept as re-exports) |
| 2 | `asRecord` / `asRecordOrNull` | 9 identical copies in `cli/` | `cli/src/records.ts` |
| 3 | Atomic "write, keep mode" | `writeSettingsAtomically` (claude-status-line) and `writeConfigAtomically` (codex-status-line), byte-identical | `cli/src/local-file-storage.ts` `writeFileAtomicallyPreservingMode` |
| 4 | `shellQuote`, `isHttpUrl` | private copies in `cli/src/setup.ts` | `terminal-launcher.ts`, `management.ts` (already defined there) |
| 5 | `sleep` / `delay` promises | 7 copies in `cli/src/agent-session/**` | `node:timers/promises` `setTimeout` |
| 6 | Managed worktree root | `resolveServerWorktreeRoot` (backend) and `resolveDesktopWorktreeRoot` (desktop), line-for-line copies | core `local-target/worktree-git.ts` `resolveManagedWorktreeRoot` |
| 7 | `trimmed()` | 7 copies across `latch-*`, `terminal-profile-types`, `execution-target-runners` | new dependency-free `packages/core/service/strings.ts` `trimmedOrNull` (CLI-safe) |
| 8 | "Parse JSON object or `{}`" | 5 copies (`parseProjectPreferenceJson`, `parseLaunchFlagsObject`, `parseMetadataObject`, `parseDetails`, `parseObject`) | `parseMetadataJson`, moved to a light `packages/core/service/records.ts` and still re-exported from `execution-requests.ts` |
| 9 | `isTruthyFlag` | `asBool` (live-activities), `isTruthyPrimary`, `truthy` (run-queue) | core `util.ts` `isTruthyFlag` (already imported by 2 of the 3 files) |
| 10 | `sqlPlaceholders` | private copy in `mission-search.ts` | core `util.ts` |
| 11 | `executionTargetInWorkspace` | identical SQL + 404 in `target-resource-observations.ts` and `mission-branch-observations.ts` | `execution-targets.ts` (both already import it) |
| 12 | `nowIso` / `newId` | second implementation in `backend/db.ts` (16 backend files used it, 9 used core's) | `backend/db.ts` now re-exports core `util.ts` |
| 13 | `iso()` (driver timestamp → ISO) | copies in `mission-narrative.ts` and `delivery-summary-publication.ts` | core `util.ts` `toIsoOrNull` |
| 14 | `formatDeliveryTimestamp` / `formatCardTimestamp` | 2 webapp copies of an existing, tested helper | `webapp/web/lib/format-date.ts` `formatTimestamp` |
| 15 | `CopyField` | byte-identical in `UserTokensPage` and `WebhooksPage` | `webapp/web/components/settings/CopyField.tsx` |
| 16 | `cleanFlags` | 2 webapp copies plus a hand-rolled loop in `recent-agent-launch-flags.ts` | `@overlord/contract` `normalizeAgentLaunchFlags` |
| 17 | `GitHubIcon` SVG | `AuthScreen` and `AccountPage` | `webapp/web/components/GitHubIcon.tsx` |
| 18 | `toDateInputValue` | identical to `dayKeyFromDate` | re-export of `calendar-utils.ts` `dayKeyFromDate` |
| 19 | "click inside the card or its portal menu" | 2 identical `isInsideCard` callbacks plus an inline copy in `BlankMissionCard` | `MentionableTextarea.tsx` `isWithinOwnedOverlay`, next to the attribute it reads |

Behaviour notes:

- **#1.** Some copies returned the raw difference, others -1/0/1. Every caller only tests the sign.
- **#2.** The three cli `asRecord` variants that let arrays through (`commands.ts`, `launch.ts`,
  `setup.ts`) were left as they are on purpose.
- **#5.** Same ref'd timer semantics.
- **#16.** `normalizeAgentLaunchFlags` also accepts legacy `string[]` entries in localStorage,
  which the old loop silently dropped.

Net result: about 330 lines removed across 50 files.

## Divergent copies that look like bugs — need an owner decision

Each of these is duplicated logic where the copies have already drifted apart. Unifying them
changes behaviour, so they were **not** changed here.

1. **The desktop silently drops user `overlord.toml` keys.** `desktop/src/backend-config.ts` has
   its own TOML renderer and parser (`renderOverlordToml`, `readExistingConfig`). It keeps only 9
   keys, so switching desktop profiles erases these:
   - `database_path`
   - `database_url`
   - `default_model`
   - `[agent_catalog]`

   `cli/src/config.ts` (`loadConfig`/`writeConfig` with `smol-toml`) is the canonical path.
2. **The desktop `.env` loader skips `OVLD_HOME` normalisation.** `desktop/src/main.ts:402-430`
   is a line-for-line copy of `scripts/load-repo-env.mjs`, but without `normalizeEnvFileValue`. A
   relative `OVLD_HOME` resolves against the cwd, not the file's directory. There are four `.env`
   loaders in total:
   - `scripts/load-repo-env.mjs`
   - `desktop/src/main.ts`
   - `scripts/build-desktop.ts`
   - `cli/src/env.ts`
3. **`runner-service.ts:440` omits the `USER_TOKEN` fallback.** The
   `OVERLORD_USER_TOKEN || OVLD_USER_TOKEN || USER_TOKEN` chain is written out 5 times in `cli/`,
   and this is the only copy without `USER_TOKEN`. Suggested fix: export a single
   `readEnvUserToken(env)` from `auth-credentials.ts`.
4. **The project lookup skips the token project-scope check.**
   `packages/core/service/project-execution-target.ts:309` has a private `resolveProjectId`.
   - It accepts only a UUID and never calls `requireProjectInScope`.
   - The canonical `context.ts:151` `resolveProjectId` resolves by id, then slug, then name, and
     enforces the scope at each step.
   - Callers: `listEligibleProjectExecutionTargets` and the two functions after it.

   Confirm the route layer gates project scope before relying on this. If it doesn't, switching to
   the canonical resolver is a security fix.
5. **Default mission titles depend on the surface.**
   - Core `util.ts` `initialTitleFromInstruction` uses the first line, 80 characters and `...`.
     Protocol and MCP use this path.
   - `backend/automation/title-automation.ts` uses the whole text, 100 characters and `…`. REST
     uses this path.

   Pick one rule.
6. **Desktop resolves the CLI in two orders.**
   - `runner-service-control.ts:63` tries the bundled CLI first, then PATH.
   - `cli-updater.ts:170` tries PATH first, then the bundled CLI.
7. **The SQLite migration runner exists twice.** `database/src/launch-local.ts` copies the runner
   in `connection.ts`. The copy has drifted: it lacks the rollback and foreign-key restore on
   failure, and the WAL-to-DELETE fallback. Every new `finalize*` hook must be added in both
   places.

## Recommended follow-ups (safe, mechanical, not done here to keep this PR reviewable)

### cli

- **Channel-client bootstrap (×7).** `resolveAgentSessionScope` → `OVERLORD_BACKEND_URL` →
  `createChannelClient` is repeated in `agent-session/{index,sidecar,request,inbox×2,event}.ts`
  and `codex-app-server/index.ts`. Add a `channelClientFromEnv()` helper. `index.ts` also reads
  `process.env` instead of the injected `env`.
- **Owner-only atomic writes (×4).** `writeOwnerOnlyFileAtomically` already exists, but inline
  copies remain in:
  - `operation-attempts.ts`
  - `codex-models.ts`
  - `codex-app-server/state.ts`
  - `agent-session/channel.ts`

  The copies don't clean up the temp file on failure.
- **Response helpers.** `readResponseJson` and `errorMessageFromJson` exist in both
  `auth-login.ts` and `backend-client.ts`.
- **`auth.json` read/write.** `desktop/src/cli-auth-sync.ts` copies `cli/src/auth-credentials.ts`
  and drops `expiresAt` when it rewrites the file.
- **Interactive backend config.** `setup.ts` (`configureBackendForSetup`) and `management.ts`
  (`ovld config`) each implement the "local or cloud, URL, write config" prompt flow.

### backend and core

- **"Active profile or 401".** Three named copies:
  - `activeNotificationProfileId`
  - `activeInboxProfileId`
  - `requireOwnProfileId`

  There are also about 10 inline copies, and the message text has drifted. Add
  `requireActiveProfileId(db)` in `backend/db.ts`.
- **Mission by display id across workspaces (×3).** Copies are in `rbac.ts`, `objective-ref.ts`
  and `protocol.ts`, and their 409 messages differ.
- **`assertProject` / `assertProjectExists`.** Copies are in `ext/github/service.ts` and
  `ext/everhour/service.ts`.
- **`parseSettings`.** `organizations.ts` and `workspace-settings.ts` are byte-identical; they
  could use `parseMetadataJson`.
- **`canonicalJson` (×3).** Copies are in `delivery-finalization.ts`, `repository-reads.ts` and
  `chat/static-cache.ts`.
- **`trimmedOrNull` backend copies.** `optionalString` in `backend/http/query.ts` and its inline
  copies (`launch-channels.ts:31`, `organizations.ts:63`) are the same function.
- **`sqlPlaceholders`.** About 55 inline `.map(() => '?').join(', ')` expressions remain.
- **UUID regex (×6).** There is no shared export; `packages/contract/src/objective-ref.ts`
  `UUID_RE` is private.

### webapp

- **Everhour popovers.** `MissionTimerPopover` and `ProjectTimerPopover` are about 300
  near-identical lines, and so are their `use*TimerControls` hooks. Parameterise them by a hooks
  bundle.
- **Resize hook.** `MissionDrawer` re-implements `use-resizable-sheet-width`; the hook's own
  comment says it mirrors the drawer.
- **Backend profiles.** `BackendLoginPanel` and `BackendPage` have the same desktop
  backend-profile state and handlers. Extract a `useDesktopBackends()` hook.
- **Directory picker.** The handler is copied in `ProjectCreatorModal`, `AddResourcePage` and
  `AddSourceForm`. Extract a `useChooseDirectory()` hook.
- **Default-project window.** The "recently active default project" window and its localStorage
  key are in `NewMissionModal`, `use-quick-task-bar` and `ApplicationPage`.
- **`/api/meta` cache.** `/api/meta` is cached under a second query key in
  `local-target-client.ts`, which duplicates `useMeta()`.
- **Initials.** The initials algorithm appears 4 times (`UserProfilePage`, `GeneralPage`,
  `nav-user`, `LiveActivityFeed`).
- **`errorMessage(err, fallback)`.** It is private in 4 files, with about 60 inline copies.

### scripts, database and automations

- **Release-script helpers.** `fail`, `run` and `runCapture` are copied across `build-desktop.ts`,
  `publish-cli.ts` and `publish-desktop-release.ts`.
- **`postgresSearchPath`.** It is identical in `auth/src/auth/config.ts` and
  `database/src/client.ts`. auth already depends on `@overlord/database`, but exporting it adds to
  the database package surface.
- **Gemini JSON calls.** `generateGeminiText` is re-implemented in
  `automations/src/compose-delivery/compose.ts` and `objective-brief/compose.ts`. Adding
  `responseSchema` and `signal` options to it would cover both.

## Checked and intentionally left alone

- `connectors/core/scripts/overlord-mcp.mjs` ships standalone, so its helper copies are required.
- `database/src/project-resources-resource-key-migration-runtime.ts` `slugify` and
  `deriveProjectResourceKey`: migrations are frozen snapshots, and database cannot import core.
- Same name, different job:
  - `cli/src/update.ts` `compareVersions` handles more than 3 parts.
  - The two `runGit` functions (one throws, one returns `''`).
  - `redactSecrets` (cli vs core).
  - `normalizeBackendUrl` (cli, desktop and contract each normalise differently).
  - `KindBadge`, `Badge`, `BlockingQuestionCard`.
  - The two SSE frame parsers.
