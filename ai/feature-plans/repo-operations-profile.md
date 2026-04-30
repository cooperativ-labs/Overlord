# Repo Operations Profile for Feed-Post Follow-Up Actions

## Problem

`generate-feed-post` (Supabase edge function, `supabase/functions/generate-feed-post/index.ts`) asks Gemini to emit a `human_actions: string[]` array — proactive tasks the user must do (run a migration, deploy a function, set an env var, etc.). Today the LLM only sees:

- ticket title / objective / acceptance criteria / constraints
- a chronological list of `ticket_events`
- per-file `change_rationales` (path, summary, why, impact)

It never sees what *kind* of file paths those are in this repo. So Gemini has to guess from path strings whether a change implies "run `yarn generate`", "redeploy the edge function", "regenerate types", "reseed", etc. Recall on these actions is poor and the failure mode is silent — the user never sees the suggestion.

The temptation is to dump the full file tree (or an "architecture summary") into the prompt. Both are too noisy and too expensive for a per-delivery edge-function call. We want a **narrow, deterministic, operations-only** layer.

## Approach

Build a small pipeline with three pieces:

1. **Profile** — a compact JSON document, derived per-project from the file tree + a few manifest files, that classifies the repo's operational surfaces (deployable apps, migration system, codegen, test entrypoints, workspaces).
2. **Rule engine** — a deterministic function `(profile, changedPaths) → CandidateAction[]` that runs in JS/TS, no LLM, before the prompt is built.
3. **Refresh strategy** — regenerate the profile only when the *structure* of the repo changes (manifests added/removed, new top-level workspace), not on every delivery.

The rule engine output is fed to Gemini as a small "candidate follow-up actions" block; the LLM's job collapses from "infer from paths" to "include relevant ones, drop irrelevant ones, write them in the user's voice." The free-text `human_actions` field stays — the rules just seed it with high-recall candidates.

## Schema: `RepoOperationsProfile`

Stored as a JSONB column on `projects` (new column `operations_profile`) with companion `operations_profile_fingerprint TEXT` and `operations_profile_generated_at TIMESTAMPTZ`. Target serialized size **≤ 4 KB** per project.

```ts
type RepoOperationsProfile = {
  schema_version: 1;
  // Workspace / package boundaries
  workspaces: Array<{
    path: string;                 // posix, repo-relative; "" = root
    name: string;                 // from package.json "name" if present
    manager: 'yarn' | 'npm' | 'pnpm' | 'bun' | null;
    has_lockfile: boolean;        // true if its own lockfile (mostly root)
  }>;

  // Deployable surfaces
  deployables: Array<{
    kind:
      | 'nextjs-app'              // next.config.* + app/ or pages/
      | 'expo-app'                // app.json/app.config.* + expo dep
      | 'electron-app'            // electron in deps + main entry
      | 'edge-function'           // supabase/functions/<name>/index.ts
      | 'vercel-project'          // vercel.json
      | 'cloudflare-worker'       // wrangler.toml
      | 'static-site'             // public/ + no framework
      | 'cli'                     // bin field in package.json
      | 'library';                // package with main/exports, no app shell
    path: string;                 // root of the deployable, posix
    name: string;                 // package or directory name
    deploy_target?: string;       // 'vercel', 'supabase', 'eas', 'testflight'
  }>;

  // Database / migration system
  migrations: {
    system: 'supabase' | 'prisma' | 'drizzle' | 'knex' | 'flyway' | null;
    migrations_dir: string | null;        // e.g. 'supabase/migrations'
    types_output: string | null;          // e.g. 'types/database.types.ts'
    seed_files: string[];                 // e.g. ['seed.ts', 'supabase/seed.sql']
    generate_command: string | null;      // discovered from package.json scripts
    seed_sync_command: string | null;
  } | null;

  // Codegen / type generation steps (beyond migrations)
  codegen: Array<{
    name: string;                 // 'graphql', 'openapi', 'protobuf', 'shadcn'
    triggers: string[];           // glob-ish source path prefixes
    outputs: string[];            // generated path prefixes
    command: string | null;       // from scripts
  }>;

  // Test entrypoints
  tests: {
    runner: 'jest' | 'vitest' | 'playwright' | 'cypress' | 'detox' | null;
    config_files: string[];       // ['jest.config.js']
    test_dirs: string[];          // ['tests', 'apps/web/__tests__']
    script: string | null;        // 'yarn test'
  } | null;

  // Dependency manifests (for reinstall/rebuild detection)
  manifests: Array<{
    path: string;                 // 'package.json', 'apps/mobile/package.json'
    lockfile: string | null;      // sibling lockfile path if present
  }>;

  // Discovered package.json scripts (name → command), one entry per workspace
  scripts_by_workspace: Record<string, Record<string, string>>;

  // Misc operationally-relevant config files (presence only — for rules)
  signals: {
    has_dockerfile: boolean;
    has_docker_compose: boolean;
    has_github_actions: boolean;
    has_eas_json: boolean;
    has_app_store_config: boolean;
    has_env_example: boolean;
    env_example_paths: string[];
  };
};
```

Notes:
- No source-code summaries, no dep graphs, no LOC counts. Operational signals only.
- All paths posix, repo-relative. Kept compact by avoiding nested `files: []` arrays.
- `schema_version` so we can evolve the rule engine without re-validating old rows.

## Inputs to the Profile Builder

Reads only:

1. **File tree** via existing `listProjectFiles()` in `lib/filesystem/project-file-tree.ts` (already prunes `node_modules`, `.next`, etc.).
2. **Selected manifest/config files** by full read — bounded list, all small text:
   - All `package.json` files (one per workspace).
   - All lockfiles (existence check only, not contents).
   - `next.config.*`, `app.config.*`, `app.json`, `expo.json`.
   - `vercel.json`, `wrangler.toml`, `eas.json`.
   - `supabase/config.toml`, `supabase/seed.sql` (existence).
   - `tsconfig.json` (workspace presence + `references` array).
   - `jest.config.*`, `vitest.config.*`, `playwright.config.*`.
   - `Dockerfile`, `docker-compose.y*ml`, `.env.example` files (existence).
   - GitHub Actions workflow filenames (no contents).
3. **No `git log`, no source files, no LLM calls.** Pure deterministic parse.

Hard cap: build never reads more than ~50 files, total bytes under ~500 KB. If the repo is larger than expected we degrade gracefully (skip unknown workspaces) rather than expand the read budget.

## Refresh Strategy

The profile only changes when **structural** things change. So we fingerprint the inputs and only rebuild on fingerprint mismatch.

```
fingerprint = sha256(sorted_join([
  ...all_manifest_paths_with_mtime_or_hash,
  ...all_lockfile_paths,
  ...all_config_file_paths,
  workspace_root_dir_listing_hash
]))
```

Triggers:

- **Eager**: a Supabase trigger / queue worker watches for project linked-directory rebinds and pushes a build job.
- **Lazy**: each call into `generate-feed-post` checks if a profile exists for `project_id`; if missing, it requests a build via a non-blocking RPC and proceeds with no profile (Gemini falls back to today's behavior). The next delivery picks up the freshly-built profile.
- **Periodic drift check**: a scheduled job (daily) recomputes the fingerprint per active project; rebuilds if changed. Cheap because fingerprint inputs are small.
- **On-demand**: server action `rebuildOperationsProfileAction(projectId)` exposed to the project settings UI.

Importantly: a feed delivery that *changes only `.tsx` files in `components/`* does not invalidate the profile, so we never rebuild on hot paths.

## Deterministic Rule Engine

`lib/feed/operations-rules.ts` exposes:

```ts
type CandidateAction = {
  id: string;                   // stable rule id, e.g. 'supabase.regenerate-types'
  text: string;                 // human-readable, ready to drop into human_actions
  reason: string;               // which paths/profile signals matched
  confidence: 'high' | 'medium';
  category:
    | 'redeploy' | 'migration' | 'codegen' | 'seed'
    | 'install' | 'test' | 'config' | 'rebuild';
};

function deriveCandidateActions(
  profile: RepoOperationsProfile,
  changedPaths: string[]
): CandidateAction[];
```

Rules are small, ordered, and pure. Each rule looks at `changedPaths` × `profile` and emits zero or one candidate. Examples (illustrative subset):

| Rule id | Match condition | Candidate text |
| --- | --- | --- |
| `supabase.run-migrations` | Any changed path under `profile.migrations.migrations_dir` | "Run new Supabase migrations against staging/production" |
| `supabase.regenerate-types` | Above match AND `profile.migrations.types_output` exists | "Run `{generate_command}` to regenerate `types/database.types.ts`" |
| `supabase.seed-sync` | Any changed path in `profile.migrations.seed_files` AND `seed_sync_command` set | "Run `{seed_sync_command}` to apply seed changes" |
| `supabase.deploy-edge-fn` | Path matches `supabase/functions/<name>/**` for a `kind: 'edge-function'` deployable | "Deploy edge function `<name>`: `supabase functions deploy <name>`" |
| `vercel.redeploy` | Any change inside a `kind: 'nextjs-app'` deployable AND `deploy_target === 'vercel'` | "Redeploy `<name>` to Vercel (or wait for auto-deploy)" |
| `expo.rebuild-dev-client` | Native code touched (`ios/`, `android/`, `app.config.*`, native deps in `package.json`) under an `expo-app` | "Rebuild Expo dev client (native code or config changed)" |
| `expo.publish-update` | JS-only change under an `expo-app` AND EAS Update used | "Publish an EAS Update for `<name>`" |
| `pkg.reinstall` | Any `package.json` `dependencies`/`devDependencies` diff (manifest in changedPaths) | "Run `{manager} install` in `<workspace>`" |
| `pkg.lockfile-conflict` | Lockfile in changedPaths but no manifest change | "Lockfile changed without manifest change — verify intentional" |
| `env.new-vars` | `.env.example` in changedPaths | "Add the new env vars to your local `.env` and to the deployed environment" |
| `codegen.regenerate` | Changed paths intersect any `codegen[*].triggers` | "Run `{codegen.command}` to regenerate `{codegen.name}` outputs" |
| `tests.run-targeted` | Source change in workspace `<w>` AND `profile.tests.script` set | "Run `{tests.script}` for `<w>`" — *low confidence; gated, see below* |
| `ci.workflow-changed` | `.github/workflows/*.y*ml` in changedPaths | "Trigger or watch the CI workflow run on next push" |
| `docker.rebuild` | `Dockerfile` or `docker-compose.*` in changedPaths | "Rebuild Docker images" |

Dedup: rules can declare `supersedes: string[]` so e.g. `supabase.deploy-edge-fn` suppresses the generic `vercel.redeploy` if the same path matched both.

System-prompt guideline (separate from these rules): *"testing / verifying / reviewing"* style actions are explicitly excluded by today's prompt. The `tests.run-targeted` rule violates that and is **off by default**; opt-in per project preference.

## Integration with `generate-feed-post`

Today the function builds context (events + rationales) and calls Gemini. Add three steps:

1. **Load profile** from `projects.operations_profile` for `ticket.project_id`. If absent, kick off a build job (fire-and-forget) and proceed with `profile = null`.
2. **Compute candidates**: `changedPaths = rationales.map(r => r.file_path)`; `candidates = profile ? deriveCandidateActions(profile, changedPaths) : []`.
3. **Inject into prompt** as a new, clearly-labeled block — separate from the general "code changes" block:

   ```
   CANDIDATE FOLLOW-UP ACTIONS (deterministically derived from repo structure):
   - [supabase.run-migrations] Run new Supabase migrations against staging/production
   - [supabase.regenerate-types] Run `yarn generate` to regenerate types/database.types.ts
   - [pkg.reinstall] Run `yarn install` in apps/mobile
   ```

   With instruction: *"Include any candidate follow-up actions above that are still relevant given the actual changes. You may rephrase them. Drop any that are obviously not applicable. Add new ones only if the candidate list is missing something the user must do — do not invent generic verify/test items."*

This keeps the **operational** guidance (what to run/deploy) separate from the **architectural / decision** narrative (which still goes in `body` and `tradeoffs`). The two never mix in the prompt and never mix in the schema — `human_actions` stays the operational field.

### Payload size budget

Even on a sprawling monorepo:

- Profile injected: 0 (only the *candidates* go into the prompt, not the whole profile).
- Candidates injected: ≤ 12 lines × ~120 chars ≈ 1.4 KB worst case.
- Existing per-delivery prompt is ~3–10 KB. Adding ~1.5 KB is immaterial.

Compare to dumping the file tree (50–200 KB) or an architecture summary (5–20 KB plus dilution of attention).

## Why this beats a generic architecture summary for follow-up recall

A free-form architecture summary helps the LLM *describe* what changed but doesn't change its prior on *what the user must now do*. Empirically the missed `human_actions` are stereotyped: "regenerate types", "run migrations", "reseed", "deploy edge function", "reinstall after lockfile change". Those are exactly the things rule-matchable from path patterns + a small profile, with **near-perfect recall** when the profile is correct. Pushing them to deterministic rules:

- removes the recall failure (rules fire whether or not the LLM "noticed").
- removes the precision failure (rules don't fire when the path doesn't match — no hallucinated migrations).
- frees prompt budget that an architecture summary would consume.

The LLM is still allowed to add actions the rules miss, so we don't sacrifice ceiling.

## Implementation Plan

Phased, each phase shippable on its own:

1. **Schema + builder** — `lib/repo-profile/build-profile.ts` + types. Pure function over a directory path. Unit-tested with fixture repos. Add migration for `projects.operations_profile`, `operations_profile_fingerprint`, `operations_profile_generated_at`.
2. **Build trigger surfaces** — server action `rebuildOperationsProfileAction(projectId)`, queue worker for eager rebuild on linked-directory bind, daily fingerprint sweep. UI "Rebuild" button in project settings.
3. **Rule engine** — `lib/feed/operations-rules.ts` with the rule table above. Snapshot tests pinning candidate output for a curated set of (profile, changedPaths) cases including this Overlord repo.
4. **Wire into `generate-feed-post`** — load profile, derive candidates, inject the new prompt block, update the system instruction with the guidance above. Behind a project-level feature flag for the first week so we can A/B `human_actions` quality.
5. **Observability** — log `{rule_id, fired, kept_in_post}` to a new `feed_post_action_audit` table so we can measure rule precision and LLM drop rate per rule, and prune low-precision rules.

## Out of Scope (deliberately)

- Architecture summary / module dependency graph.
- Source-code parsing or AST analysis.
- LLM-driven repo introspection.
- Per-file ownership, code review routing, or "who wrote this".
- Profile drift across branches — profile is derived from the linked working directory's current `HEAD` and is project-scoped, not branch-scoped.
