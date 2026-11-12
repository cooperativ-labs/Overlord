# Overlord architecture

Part of the Overlord contract. [CONTRACT.md](CONTRACT.md) defines its scope, precedence and change protocol.

## Editions

Overlord ships in two editions that share one contract:

- **Overlord Local** (default): the Electron desktop shell supervises a loopback
  backend over SQLite on the user's machine. No account or network dependency.
- **Overlord Cloud** (additive): the backend and system-of-record database run as
  a hosted control plane; the desktop app, web app, CLI, and execution targets
  connect over HTTPS. Same REST, protocol, and realtime contract — only
  `backend_url` and auth differ.

Both editions are first-class. A contract change for Cloud must never regress Local;
where a surface differs by edition this document calls it out explicitly.

## Component Registry

Each component owns a defined set of responsibilities. No component may directly access another's internals — use only the declared interaction surfaces.

For a narrative reading order over the per-module reference specs cited below, see the [Architecture reading-order index](../docs/src/content/docs/docs-for-agents/architecture.mdx) (published in the docs site under **Docs for agents → Architecture**). The `NN-` numbers on those specs are stable identifiers, not a reading order.

### 1. Protocol Layer

Specified in [protocol.md](protocol.md).

### 2. Database Layer

**Stable identifier**: `database`
**Reference spec**: [`contract/data/README.md`](data/README.md)

Owns:

- Table definitions, column types, indexes, foreign keys, CHECK constraints
- `objectives.display_key`: required Crockford Base32 key (lowercase, typically 4 characters), unique among non-deleted rows of the same mission. The public id `{missions.display_id}.{display_key}` is computed at read time and is not persisted as a second column. Soft-deleted keys may be reused.
- `objectives.reopened_at`: nullable `TimestampUTC`, last-wins. Stamped when an objective in `executing`, `pending_delivery`, or `complete` is set back to `draft`, marking where its latest run begins; never stamped by a post-delivery re-attach, a `future → draft` promotion, or a `launching → draft` reset. Projected additively as `ObjectiveDto.reopenedAt`.
- `missions.allow_parallel_objectives`: `boolean NOT NULL DEFAULT false`. Opt-in permission for two objectives on the same mission to execute at once, on the same `resource_key` or different ones. Domain enforcement is service-layer (no unique partial index); checkout safety is the Runner Layer's per-objective branch/worktree isolation.
- The `organizations` table (grouping layer above `workspaces`: `id` uuid, `name`, `settings_json` incl. `logoUrl`, timestamps, `deleted_at`, `revision`) and the required `workspaces.organization_id` FK; workspaces remain the sole RBAC layer, and slugs are unique per organization, not instance-wide
- `execution_target_runner_registrations`: the core, **one-to-many** record of live runner processes serving one `local` execution target (`runner_instance_id`, `native`/`adopted` `relation`, non-secret `label`/`runner_version`/`capabilities_json`/`supported_agents_json`, and `health`/`last_heartbeat_at`/`last_error_code`). It is the source of truth for **local** target reachability; `devices.last_seen_at` reverts to last observed machine traffic with no scheduling effect, and is honored for reachability only for a target that has never had a runner registration (upgrade compatibility). This table is distinct from the gateway-owned `execution_target_registrations`, which stays one registration per `virtual` target. `execution_requests.claimed_by_runner_registration_id` records which runner instance won a local claim
- The virtual execution target core tables (`execution_target_registrations`, `project_environment_definitions`, `project_resource_sources`, `execution_request_snapshots`, `execution_request_grants`, `execution_request_observations`, `mission_target_resources`) and the additive `execution_requests` snapshot/failure/gateway columns — these are **core** (not `ext_` extension) because they drive queue status, audit, authorization, and UI. The immutable `execution_request_snapshots` row (canonical `payload_json` + SHA-256 `payload_digest`) is created in the same transaction as its `queued` request and is never updated; retrying only increments `attempt_count`. Grant records store hashes/opaque IDs, never bearer values
- Optional per-agent `launchDefaults` in each `project_resource_sources.descriptor_json`; these source-owned pre-commands and normalized flags are project configuration and contain no credentials
- The **Agent Session Exchange** core tables — `agent_session_channels`, `agent_session_events`, `agent_requests`, and `agent_session_inputs` — declared by this contract and migrated with the channel bootstrap. They are core rather than `ext_` because they drive authorization, audit, presence, and UI gating. The scoped channel credential is stored hash-only and scoped to exactly one channel; `native_session_id` is a correlation alias and never an authorization key; raw native payloads are never persisted (no transcripts or transcript paths, no raw tool input or output, no file contents, no environment variables), and stored summaries are bounded, redacted, and carry a `formatter_version`. No derived capability tier is persisted — a connector's static tier is derived from fixtures at build time and a session's effective capabilities live in `capabilities_json` on its channel. The documented-but-never-migrated `hook_events` and `permission_requests` designs are **superseded** by them: sanitized hook events become normalized `agent_session_events`, and a permission becomes one kind of `agent_requests`. The closed `permission_requests.status` vocabulary and the `mission_events.type = permission_request` value remain valid; only the dedicated tables are retired, and no component may begin writing them
- `human_action_resolutions`: operator decisions on the deferred-work items of a delivery (the reported-human-action resolutions it also held before v150 were deleted by migration). Primary key `(delivery_id, action_id)` where `action_id` is the stable delivery-local `DeferredWorkV1.id` (agent-report index plus the digest of the canonical deferred-work object; historical string-item rows were deleted with their items by the v166 migration); denormalized `workspace_id`, `mission_id`, `objective_id`; closed `status` (`done` \| `dismissed`); nullable closed `outcome` (`mission_created` \| `objective_added`) and `outcome_ref` recording a promotion; `resolved_by_workspace_user_id`; `resolved_at`. Rows cascade with their delivery, are never soft-deleted (reopening deletes the row), and never duplicate the item text — the delivery report stays the sole source of what the item says.
- `missions.summary_enabled`: Bool, NOT NULL, default true; false for every mission that existed at the v166 migration. It is the only source of mission-summary eligibility and is never inferred from a summary row.
- `mission_summaries`: one row per eligible mission, primary key `mission_id` (FK cascade), denormalized `workspace_id` and `project_id`, `revision`, `requested_generation`, `completed_generation`, closed `status` (`pending` \| `composed` \| `fallback`), `headline`, `summary_markdown`, `risks_json` (`{ deliveryId, objectiveId, index, text }[]`), `suggestions_json` (`{ deliveryId, objectiveId, actionId }[]` references only; item text is read from the delivery report at projection time), nullable `source_delivery_id`, closed `generated_by` (`deterministic` \| `gemini`), nullable `generated_at` and `model`, `created_at`, `updated_at`. Replaced in place; every write appends a `mission_summary` entity change.
- `mission_summary_seen`: `mission_id`, `workspace_user_id` (both FK cascade, primary key on the pair) and `seen_at`, the monotonic per-user evidence watermark. Writes append no entity change.
- Controlled vocabularies (closed and open sets)
- The **assistant conversation** core tables: `chat_threads`, `chat_messages`, `chat_runs`, `chat_run_attempts`, `chat_provider_checkpoints`, `chat_tool_calls`, `chat_source_refs`, `chat_dependency_sets`, `chat_dependency_set_members`, `chat_evidence`, `chat_thread_summaries`, `chat_questions`, `chat_events`, `chat_work_proposals`, `chat_work_proposal_revisions`, `chat_work_receipts`, `chat_work_receipt_missions`, `chat_presence`, `chat_event_acks`, and `chat_notifications`, plus `account_connections`, `account_connection_authorizations`, and `missions.created_from_chat_thread_id` (soft reference, no FK). Both editions enforce the same invariants: one unfinished run per thread, one leased attempt per run, attempt/checkpoint/tool-call/event writes only at the run's current fence, gap-free append-only per-thread event sequences, one open question per run, frozen proposal revisions, one creation receipt per proposal and per `(owner, client request id)`, monotonic acknowledgements, one conversation notification per `(owner, thread, run, type, transition)` addressed to the thread owner, and one live account connection per `(owner, organization, provider, server)`. Every row cascades from `profiles`/`organizations`. Checkpoint payloads, tool results, and credential envelopes are private server state
- Soft-delete and revision semantics
- Migration versioning via `schema_migrations`
- Extension table naming rules (`ext_<name>_`)
- Logical types and their adapter mappings
- The async `DatabaseClient` adapter that owns the underlying handle/pool and serves every read/write on both editions through `?`-placeholder SQL (including the SQLite-only `sqliteDataVersion()` external-write probe); production callers never hold a raw synchronous `better-sqlite3` handle
- Ambient transactions: while a root `DatabaseClient`'s `transaction(async tx => ...)` callback is running, any query issued through that same root client from inside that async context automatically joins the open transaction (via `AsyncLocalStorage`, scoped per root instance) instead of deadlocking (SQLite) or executing outside the transaction on another pooled connection (Postgres); a transaction-scoped client captured and reused after its transaction has committed or rolled back throws `TransactionClosedError`

Does NOT own:

- Service-layer business logic (owned by the layer calling into the database)
- REST response shapes (→ REST API Layer)

### 3. CLI Layer

**Stable identifier**: `cli`
**Reference spec**: this section; design background (non-normative): [`cli/docs/02-cli-first-product-surface.md`](../cli/docs/02-cli-first-product-surface.md)

Owns:

- Management command names and argument shapes, including `ovld setup` (interactive first-run configuration), `ovld serve` (boot a fully-initialized local instance in local/backend packages), `ovld config set` (select local loopback backend URL or hosted/cloud backend URL), and `ovld auth login` (first-run backend onboarding before authentication)
- Project linking and discovery from working directory
- Configuration file locations and formats (`overlord.toml`, `.overlord/project.json`), resolved by walking up from the working directory with a documented packaged-mode fallback to the OS app-data directory (e.g. `~/Library/Application Support/Overlord/overlord.toml`), including backend URL settings (`backend_url` for the active REST/backend endpoint, `backend_mode` as `local` or `cloud`), optional legacy database settings consumed only by local/backend packages. Terminal launch settings live on `user_execution_target_preferences.terminal_profile_json` for the local execution target fingerprint (provisioned from the device fingerprint during `ovld setup`); that document additionally carries the optional versioned execution-provider/viewer block, whose absence means direct execution with the stored terminal choice, and whose user-level default lives on `profiles.metadata_json.launchSessionDefaults`. `.overlord/project.json` remains CLI-owned local link metadata: the legacy top-level `resourceId` stays required for backward compatibility, while the additive `resourceIdsByExecutionTarget` object may map `execution_targets.id` to target-scoped `project_resources.id`; readers must accept either shape and prefer the target-specific id when they know the acting execution target. The additive `resourceKey` field records the logical project resource key for this checkout and is reused when linking the same logical resource from another target. The additive `projects` array lists every project this checkout is linked to; top-level `projectId` / `resourceId` / `isPrimary` (and optional `projectName`) are the primary-project projection — the unique `projects[]` entry with `isPrimary: true`, or the most recently linked entry when none is primary. Writing a link with `isPrimary: true` demotes every other entry so at most one primary remains (the project that most recently set this resource as primary). A non-primary link is merged without stealing primary. Readers accept v1/v2 files that omit `projects` as a one-element list synthesized from the top-level fields. Only `read_write` resources are linked into `.overlord/project.json`; `read` (reference) resources are intentionally never written there. Config resolution layers, highest precedence first: an explicit runtime export of the channel variable (shell / container launcher) set before any env file loads, then the resolved `overlord.toml` `backend_url` (per-instance, e.g. written by `ovld config set`), then the profile env-file default (`.env.local`/`.env.prod`, backfilled), then a hardcoded fallback — see `resolveBackendUrl` in `cli/src/config.ts`. Development and production read **separate** backend env vars so the two channels never collide: development resolves `OVERLORD_BACKEND_URL_DEV` (`.env.local`, e.g. a dev backend on `:4320`) and never reads or writes the production `OVERLORD_BACKEND_URL`; production resolves `OVERLORD_BACKEND_URL` (`.env.prod`). No tooling aliases the dev channel into the production variable. The dev-only `OVERLORD_BACKEND_URL_DEV` must never reach a production app: a bare `ovld` invocation chooses its profile by build origin — an **installed/published** CLI (under `node_modules`) runs as `production` and never auto-loads `.env.local` or reads `OVERLORD_BACKEND_URL_DEV`, even inside a dev checkout, while only the in-repo source build and the dev/test tooling that runs it (`yarn dev`, `with-ovld-home`) default to `development` (`detectCliEnvProfile` in `cli/src/env.ts`). The webapp server and desktop pass their own profile explicitly (source-vs-bundled). A backfilled env-file value is only a default: an explicit `overlord.toml` outranks it (so `ovld config set`/`ovld init` take effect), and only a deliberate shell export of the channel variable outranks the toml. `overlord.toml` and `.overlord/project.json` are per-instance/per-deployment artifacts that are **not committed** — they are gitignored like `.env.local`/`.env.prod`, generated for a deployment by `ovld init`/`ovld setup`, with `overlord.toml.example` as the committed template. Local development needs no `overlord.toml`: it runs off `.env.local` plus code defaults. Each `ovld` process resolves its own config independently from its own working directory/env. A CLI running inside a container/agent pod is a pure consumer of the injected runtime `OVERLORD_BACKEND_URL` and **must not persist config**: `writeConfig` refuses to write `overlord.toml` when `isRunningInContainer()` (an explicit launcher `OVERLORD_IN_POD` marker, or the Docker `/.dockerenv` sentinel) is true unless `OVERLORD_ALLOW_CONFIG_WRITE=1` overrides it — preventing a context-specific value from leaking through a host-mounted file onto every host process that resolves it.
- Project resource registration commands: `ovld add-cwd` accepts optional `--key <resourceKey>` to bind/upsert a local checkout source for a stable logical resource key; `ovld add-url --url <git-url>` binds/upserts a project-global Git source for that same identity.
- Execution-target registration command: `ovld add-et --name <name>` (backed by the `register-target` protocol subcommand / `POST /api/protocol/register-target`) announces the acting machine as an execution target for the resolved workspace, declaring or reusing the device's `local` target idempotently and applying `--name` as its label. Parentless workspace resolution and the `workspace_selection_required` fallback mirror `ovld create-project`.
- Execution-target onboarding triggers: `ovld add-et` and an eligible machine-local checkout link (`ovld add-cwd`, `ovld create-project --directory`, the desktop local bridge) are the only CLI acts that create an execution target. `ovld auth login`, `ovld runner install`, `ovld runner start`, and `ovld runner supervise` never create one — credentials, an installed CLI, and a running process are all disqualified as triggers because container images ship all three. `ovld setup` creates a target only by making the same explicit `register-target` call, reported to the user as its own step. Commands that need a declared target and find none fail with an actionable message naming `ovld add-et` and `ovld add-cwd`.
- Runner identity environment: `OVERLORD_RUNNER_INSTANCE_ID` pins this runner process's stable instance identity (otherwise a local id is generated and persisted alongside the runner service state), `OVERLORD_EXECUTION_TARGET_ID` names an existing execution target to serve instead of resolving the acting machine's own, and `OVERLORD_RUNNER_RELATION` (`native` | `adopted`) declares the relationship. An AgentPod container sets the host's `OVERLORD_EXECUTION_TARGET_ID`, its own `OVERLORD_RUNNER_INSTANCE_ID`, and `OVERLORD_RUNNER_RELATION=adopted`; none of these ever create a target, and an unresolvable one fails loudly with `no_execution_target_registered`. Bare `OVERLORD_DEVICE_FINGERPRINT` remains a compatibility host hint, not the adoption model
- The optional per-repo `.overlordignore` file: gitignore-style patterns for paths the client-side objective ledger must never record or synchronize (see [`cli/docs/11-review-artifacts-and-change-tracking.md`](../cli/docs/11-review-artifacts-and-change-tracking.md)). Parsed and applied entirely on the client at the ledger insertion boundary.
- The owner-only objective/session change ledger and local-only `ovld protocol capture-change` command. Ledger writes are cross-process safe, store normalized workspace-relative paths and bounded attribution metadata only, and require an explicit objective identity; cwd alone never resolves scope.
- Top-level `ovld changes status --objective-id` uses REST `file-changes?objectiveId=` (the server filters before the cap); `ovld changes rationales`, `ovld mission rationales` (now `ovld mission file-changes`), and the `rationales` JSON alias are removed, and `--change-rationales-*`/`--changed-files-*` are rejected client-side on `update`, `deliver`, and `record-work`.
- The **agent-session runtime**: the `ovld agent-session` command family and the compiled harness catalog (`cli/src/agent-session/catalog.generated.ts`). It is the only local module that carries agent-session traffic to the backend, and it does so with the channel-scoped `OVERLORD_SESSION_CHANNEL_TOKEN` — never the user's broad `USER_TOKEN`. The runtime reads the compiled catalog, never the descriptor YAML, because parsing YAML on a hook path would violate the latency invariant and the installed adapter may be older than the CLI. `ovld agent-session capabilities [<agent>] [--json]` is a human/agent-facing offline reader of that catalog: no network call, no write, no subprocess. `ovld doctor` additionally reports each connector's installed descriptor digest against the compiled catalog and which mission the current working directory's native session is bound to, and makes no network call to do either — an unbound session must be able to run it with nothing requested on its behalf. Adding a sixth harness must add zero agent-session subcommands
- Human-readable CLI output format conventions
- Human-readable `protocol create` / `prompt` output includes every created objective's persisted agent, model, resource, and queue/auto-advance settings, matching the structured mission response.
- Output contracts: machine-readable JSON is available for the commands agents and scripts use; human commands are concise by default and support `--json`; protocol commands return JSON by default; commands that produce values needed by shell scripts may also print stable `KEY=value` lines on stderr (for example `SESSION_KEY=...`); errors include an actionable fix when possible.
- `ovld attach [missionId] [agent]` queues an agent on a mission; optional `--objective-id` pins the queued objective, and without it the CLI picks a launchable objective (`submitted`, then `launching`, then `draft`) rather than always using position 0.
- Local files: the published CLI stores global config under `~/.ovld/` (overridable with `OVLD_HOME`) and talks to a backend URL; local SQLite files and `local_fs` object storage are owned by the local backend/Desktop package, not by the published CLI. `.overlord/tmp/` and `.overlord/logs/` are reserved for context files, connector hook diagnostics, temporary settings, and launch scratch files. CLI commands that run inside a linked project opportunistically prune stale `.overlord/tmp/` entries; pruning is best-effort and age-based so recent follow-up context remains available. Linking a checkout adds precisely `.overlord/tmp/` and `.overlord/logs/` to its `.gitignore` when those patterns are absent, and writes a marked no-edit rule for `.overlord/project.json` to the checkout's `AGENTS.md` and `CLAUDE.md`.

Does NOT own:

- Protocol commands (→ Protocol Layer)
- Agent connector installation (→ Connector Layer)

### 4. Connector Layer

**Stable identifier**: `connector`
**Reference spec**: this section; design background (non-normative): [`connectors/docs/05-connectors-and-agent-plugins.md`](../connectors/docs/05-connectors-and-agent-plugins.md)

Owns:

- Connector core workflow instructions
- Per-agent plugin/adapter files and managed file manifests
- Hook scripts and their event contracts
- `ovld agent-setup <agent>` / `ovld agent-setup all` and `ovld doctor` behavior, including the Codex adapter's idempotent, user-confirmed `~/.codex/config.toml` permission-profile merge. That merge changes only the named Overlord profile/default and its required feature settings; it preserves all unrelated Codex TOML.
- Connector capability declarations in the harness descriptor
- The per-adapter **harness capability descriptor** (`connectors/adapters/<agent>/harness-capabilities.yaml`, validated by [`contract/harness-capabilities.schema.yaml`](harness-capabilities.schema.yaml)) and its executable fixtures. The descriptor is the only hand-authored source of agent-session interaction capability truth: it is simultaneously the runtime gating input, the CI contract, and the source from which generated `CAPABILITIES.md`, `connectors/HARNESS-MATRIX.md`, and the compiled CLI catalog are produced. Capability ids, statuses, integration shapes, tiers, and fixture kinds come from the closed `agentSession` vocabulary in `contract/extension-points.yaml`; `capabilityTier` is derived from passing fixtures and is never authored or persisted
- Connector-owned native event-normalization and decision codecs. Native event and decision contracts belong to this layer; the CLI owns execution and transport but never becomes the source of truth for a harness dialect. `resolve` emits the harness's exact native decision shape, never a normalized Overlord shape, and every failure path returns _no decision_ so the harness's own behavior remains the floor. The event codec dialect has `outcomeExitCodePrefix` (decode a leading `<prefix><n>` line of a text result; 0 → `ok`, else `error`), numeric `outcomePath` values (exit codes), and `successOnly: true` (a fixture- and source-backed guarantee that the harness emits the event only for successful calls; seals `ok` when nothing was decoded). Absent or unrecognized results stay unknown, never success. Patch extraction reduces `*** Move to:` headers, so renames keep both endpoints
- The canonical connector core (`connectors/core/overlord-mission/SKILL.md` and `reference/`), the single source of truth for durable Overlord workflow behavior. Adapters ship a thin harness-specific skill template with a `<!-- @connector-core -->` marker that `ovld agent-setup` interpolates with the core, and must not duplicate the core lifecycle rules.
- The canonical local MCP shim (`connectors/core/scripts/overlord-mcp.mjs`), rendered at `ovld agent-setup` time for every adapter that installs a local stdio MCP bridge by substituting the adapter key for the shim's adapter-key placeholder (in `DEFAULT_AGENT` and `serverInfo.name`); adapter directories contain no committed copy. The rendered shim remains a standalone runnable `.mjs` with no bundler or repo-local runtime import, its tool list stays in parity with the hosted MCP catalog, and its `serverInfo.version` follows `connectors/VERSION`.
- The canonical post-tool capture callback (`connectors/core/scripts/capture-change-hook.sh`), the only implementation of the local post-tool mutation callback; setup substitutes the adapter key and installs it at each harness-native path, and adapter directories carry no copy.
- `ovld agent-setup <agent>` installs or updates plugin files, merges user settings safely, writes executable hook scripts, writes a manifest of managed files, removes Overlord-owned files no longer in the current manifest, and is idempotent. `ovld doctor` checks each supported connector, reports installed version/status, detects missing hook executability, missing permission rules, and missing agent binaries, and suggests exact repair commands.
- Per-adapter decision codec declarations at `connectors/adapters/<agent>/codec/<agent>.decision-codec.yaml`, referenced from the harness descriptor and compiled into `cli/src/agent-session/decision-codec-registry.generated.ts`. The pure interpreter owns bounded/redacted request-card construction; the connector declaration owns native event paths and exact literal response bodies. Exact allow, deny, and defer behavior is proven by `decision-codec` fixtures that execute the shipped interpreter

Does NOT own:

- Protocol command implementations (→ Protocol Layer)
- Harness extension catalog (→ Extension System)
- Any network call to the Overlord backend. An adapter translates and hands off to the CLI, which owns transport, auth, retry, and redaction (→ CLI Layer)
- The live session's effective capability snapshot, which the backend computes from the catalog plus runtime probes and policy (→ REST API Layer)

### 5. Runner Layer

**Stable identifier**: `runner`
**Reference spec**: this section; design background (non-normative): [`cli/docs/04-runner-and-launch-execution.md`](../cli/docs/04-runner-and-launch-execution.md)

Owns:

- `execution_requests` queue claiming and launch
- Agent-facing repository read capabilities: `git_status`, resource-addressed `diff`, bounded `read_file`, and literal `search_text`, alongside the existing `observe`/`tree`/`branches`/`worktrees`, executed for mission-less capability calls with the requested `resource_key` (never silently the primary resource), path containment including symlinks, credential/sensitive-path exclusion, disabled external diff/textconv/hooks, and explicit bounds and truncation
- Working directory resolution, ordered as explicit `workingDirectory`, objective `resource_key` on the claiming execution target, primary project resource for the target, then matching cwd `.overlord/project.json` fallback (the link whose `projectId` matches the mission project, among any number of projects recorded in that file); a missing objective-bound resource fails with `objective_resource_not_connected`
- Launch-config resolution for manual, auto-advance, and claim-time launches: an explicit objective override wins, then per-agent defaults on the selected `project_resource_sources` descriptor, then user execution-target and workspace defaults
- Per-mission branch/worktree preparation before local agent spawn when enabled, including the deterministic branch/worktree **planning** algorithm (`cli/src/branch-planning.ts`) — co-owned with the service layer and pinned to `contract/branch-planning-vectors.json` (see "Shared Deterministic Algorithms")
- Branch and worktree layout: mission branches are named `<mission-title-slug>-<mission-sequence>` and worktrees live under `~/.ovld/worktrees/<project-slug>/<resource-key>/<branch-name-with-slashes-flattened>` (root overridable with `OVERLORD_WORKTREE_ROOT`), so the branch name is mission-scoped while the worktree path is resource-scoped. Subsequent launches reuse the branch recorded in `missions.active_branch`; once it has been merged or deleted after merge, the next launch starts a new cycle with a numeric suffix (`-2`, `-3`, ...). Preparation is never destructive: the main checkout is not stashed, reset, or force-checked out. After preparation the runner records `POST /api/missions/:id/branch-prepared`, which writes the resolved branch to `missions.active_branch` (the source of truth), records an audit entry under an allowed `mission_events` type (no dedicated `branch_prepared` event type exists), and stamps `execution_requests.launch_flags_json.branchAutomation` for queued runner requests
- Same-mission branch/worktree reuse: if the planned worktree already exists and is checked out on the expected mission branch, the runner may launch into it even when it has uncommitted changes, so sequential objectives can continue work on the same branch without forcing an intermediate commit
- Per-objective checkout isolation for parallel objectives: when the mission has `allowParallelObjectives` on, uses worktrees, has no explicit branch pin, and a sibling objective on the **same** effective `resource_key` is already `launching`/`executing`/`pending_delivery`, the runner plans `<mission branch>-<objectives.display_key>` in its own worktree instead of joining the sibling's dirty checkout, and reports `branchAutomation.isolated` on `branch-prepared`. The suffix is the objective's stable display key, so the decision needs no coordination between simultaneous launches and a relaunch returns the objective to its own worktree. Without worktrees the mission has one checkout and concurrent objectives share it deliberately — attribution comes only from each explicitly bound objective/session ledger, never from a checkout-wide scan
- Launch environment: the launched agent environment exports `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` pointing at the project `.overlord/tmp/`, `MISSION_ID`, `OVERLORD_MISSION_ID`, the resolved `OVERLORD_BACKEND_URL`, `OVERLORD_WORKING_DIRECTORY`, and `OVERLORD_CONTEXT_FILE` for the written briefing path under `.overlord/tmp/`. The documented launch-variable catalog is `LAUNCH_VARIABLES` in `@overlord/contract`. Project pre-launch commands (`ProjectDto.preLaunchCommands`, stored under `overlord.preLaunchCommands` in `projects.settings_json`) run inside the launch environment after the terminal enters the working directory and exports the launch env, but before the agent process starts; project launch environment variables (`ProjectDto.launchEnvVars`, stored under `overlord.launchEnvVars`) are exported before both the pre-launch commands and the agent run. Both may reference launch variables as `{VAR_NAME}` placeholders, and unknown placeholders are left verbatim. The runner claim response carries both for the runner path; a manual `ovld launch` fetches them from the mission's project
- Runner launch environment variables, including `OVERLORD_PROJECT_RESOURCES` as a JSON sibling-resource manifest resolved for the launching execution target (each entry additively carries `accessMode`; `read` and `read_write` file-path sources both contribute their path to `OVERLORD_PROJECT_RESOURCES_PATHS` with explicit `:ro`/`:rw` suffixes, while URL/git sources contribute none)
- Runner-instance identity and heartbeat: each runner process carries a stable `runnerInstanceId` and a `native`/`adopted` relation to the execution target it serves, published on every claim so the backend can report honest local liveness. Several runner instances may serve one target (a host runner plus containers adopting it); claiming stays target-level and a runner instance is never individually addressed
- `ovld runner` commands
- The persistent runner service: `ovld runner supervise` (the long-lived loop that delegates each claim-and-launch path to `ovld runner once`) and the `ovld runner service <install|start|stop|restart|status|uninstall>` management commands that register/control an OS-level user service (macOS `launchd` LaunchAgent `io.overlord.runner`, Linux `systemd --user` unit `overlord-runner.service`). A Postgres-backed runner continuously reconnects the queue claim long-poll immediately after its 25-second timeout or empty notification wake; SQLite uses one jittered 5-second cadence as a portable fallback. Local diagnostic state (installed service kind/identifier, resolved exec path, backend URL, last heartbeat/claim/launch timestamps, last error, current poll interval) is stored in `~/.ovld/runner-service.json`; it is local-only and not a backend source of truth. Service definition files embed a captured environment snapshot (a non-loopback backend URL, `OVLD_HOME`, user token, a deterministic `PATH` prefix of `/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin` plus system dirs so `osascript` stays resolvable — not the interactive/nvm shell PATH — and — when the installer itself runs under Electron-as-Node, e.g. driven by the desktop shell — `ELECTRON_RUN_AS_NODE=1` so the recorded Electron exec path keeps running as the CLI) and are written owner-read/write only. macOS LaunchAgents set launchd `ProcessType` to `Interactive` (not `Background` or `Adaptive`) so Apple Events to Terminal/iTerm are not App-Napped; `ovld runner service install` is idempotent and is the only way to rewrite ProcessType or PATH on an already-installed agent, because app auto-update respawns the supervisor process without rewriting the plist. Linux systemd has no ProcessType equivalent and does not set Nice or CPUSchedulingPolicy. A loopback backend URL is deliberately omitted so the service follows the current `overlord.toml` after Desktop selects its Local port. Windows is not yet supported. The desktop app may drive these commands but must not reimplement the supervisor or service management
- Supervisor self-restart on program replacement: at startup the persistent supervisor records the identity of its own program (`process.execPath`) and its resolved entry script, re-checks that identity on every poll, and exits `0` as soon as either changes or disappears, so the OS service manager respawns it from the newly installed build. Exit `0` is required — a non-zero exit reads as a crash to `launchd`/`systemd`. The check is cheap and non-fatal: any inspection error other than the file being gone must never terminate a healthy supervisor. The recorded identity is process-local state and adds no field to `~/.ovld/runner-service.json`. This is the whole of the update story: the Desktop Shell does **not** stop, reinstall, or otherwise orchestrate the runner service around an app update (see "Desktop Shell → CLI (Process Supervision Surface)", which already forbids the shell from reimplementing service management) — the supervisor noticing its own replacement is what makes that orchestration unnecessary. Because the trigger is the program identity rather than any update transport, it covers desktop auto-update, a manual application-bundle replace, and a package-manager CLI upgrade identically
- Execution target selection logic
- Runner queue REST operations used by `ovld runner`: `GET /api/runner/status`, `POST /api/runner/claim`, `POST /api/runner/clear`, `POST /api/runner/requests/:id/launching`, `POST /api/runner/requests/:id/launched` (additive optional `providerSession` body persisted onto `metadata_json.providerSession`), and `POST /api/runner/requests/:id/failed`
- Branch-preparation acknowledgement through `POST /api/missions/:id/branch-prepared`, including the additive `isolated` flag that marks a per-objective parallel branch
- Latch capability discovery on the execution target: run read-only `latch capabilities --json` on the device where the process will run (never a different laptop), parse `protocolVersion` / `productVersion` / the capabilities map, expose three distinguishable states (`found` with version and resolved path, `not_installed` with the standalone install command, `incompatible` naming the missing capability), cache per target with cheap revalidation, and never install or upgrade Latch as a side effect. Direct execution remains selectable in every state
- Latch create-then-open launch path: when the claim-time launch-session snapshot selects Latch and discovery reports `found`, replace only the final process/terminal spawn with `latch create --manifest-file - --json` (same composed terminal command string S run via `$SHELL -ilc`), record the returned session id as `execution_requests.metadata_json.providerSession` (never as `launched_session_id` or a credential), then best-effort `latch open`; create failure fails the request, viewer failure does not. Direct launch remains the path when the provider is direct or Latch is unavailable
- Latch viewer focus: the resolved launch session's viewer carries `background` (boolean), projected from the stored `TerminalProfile.background` rather than stored a second time; as in a direct launch it is always `false` for the `chord` placement. It is frozen onto the claim-time `launchSession` snapshot, and a snapshot frozen before this field reads as `false` (foreground). The runner's viewer open sends it explicitly as `latch open --background` or `--foreground`, never relying on Latch's own `open.background` default, for the same reason `--as` is explicit. The flag is gated on the `productVersion` from `latch capabilities --json` (minimum `0.2609181007.0`): clap rejects unknown arguments, so an older CLI is sent the pre-existing argv and opens in the foreground. `viewer.openOnLaunch = false` launches into Latch with no window at all
- Latch terminal-session lifecycle capabilities on the execution target: `inspectLatchSession`, `openLatchSession`, and `stopLatchSession` invoke the public Latch CLI with argv on the device that owns the mapped session, resolving the executable exactly as discovery does (PATH, then `~/.local/bin` and the macOS Homebrew prefixes) and reporting a named missing-binary condition when nothing resolves, so a process started without an interactive-shell PATH cannot see discovery report `found` while every lifecycle command fails. Inspect reports only the closed `running` / `exited` / `stopping` / `lost` projection when the session still exists; Latch `no session` absence (pruned or removed metadata) is `LATCH_SESSION_ABSENT` and is not a reachability failure. Reachability remains a separate capability-result/client condition for other lifecycle failures. Stop is explicit and destructive and is never coupled to objective delivery/completion. Overlord does not invoke or emulate Latch's removed v1 conversation commands. The additive `sendLatchMessage` capability speaks Latch's v2 Conversation Hub natively over the loopback gateway and remains kernel-neutral: Latch routes the same stable Hub protocol to the session's recorded tmux or latchd kernel without Overlord selecting or controlling that kernel
- `sendLatchMessage({ providerSessionId, operationId, text, waitForIdleMs })` delivers one user turn into a running Latch session and returns Latch's `accepted | refused | ambiguous`: it reads `GET /v2/capabilities`, requires protocol major 2 with `endpoints.conversation`, opens `WS /v2/sessions/{providerSessionId}/conversation`, and sends one `send_message` quoting the `operationEpoch` from the server-first snapshot. The gateway is dialed only over loopback: `LATCH_GATEWAY_URL` (default `http://127.0.0.1:4610`) must name a loopback host, and the bearer comes from `LATCH_GATEWAY_TOKEN` or `latch serve`'s token file (`LATCH_SERVE_TOKEN_FILE`, else `$LATCH_HOME/serve.token`), because that token carries the `control` grant. The conversation channel is not an attach and never takes the session's terminal surface. A reachable gateway that declines is a successful call carrying `refused` (with Latch's `state.sendMessage.reason`); a busy `starting`/`working` session is waited out for `waitForIdleMs` (default 30 s) and then refused; anything unconfirmed after the send is `ambiguous` and is never resent; only an unreachable, unauthenticated, or conversation-less gateway is a capability failure
- Every `LocalTargetCapabilities` method reaches an execution target the backend is not co-located with by queueing an `execution_requests` row with `requested_source = 'local_target_mutation'`, awaiting the `CapabilityResult` the runner stores, and returning it with `transport: 'runner_queue'`. `ExecutionRequestDto.missionId` / `.objectiveId` are nullable to match the nullable columns of such a capability call, and `LocalTargetMutationKindDto` includes `capability_call`
- `PurgeMergedWorktreesInput` additionally accepts `{ discover: true, primaryRepoPath, worktreeRoot }` so a control-plane caller with no filesystem names the repository and the target decides which of its worktrees are merged and clean. The backend is never a local target: `LOCAL_FILESYSTEM_UNAVAILABLE` is what a caller gets when no target can serve the work
- Launch does not mint Agent Session Exchange channels. Protocol attach is the binding declaration and does not require a Latch session or a session channel. Channel 1 (artifacts, shared state, delivery, follow-up capture, objective-ledger attribution) works with Latch uninstalled

Does NOT own:

- Protocol session lifecycle (→ Protocol Layer)
- Connector installation (→ Connector Layer)
- Virtual execution target claiming and environment realization (→ REST **Virtual Target Queue Surface** + external gateway). The runner claims and launches only local/device execution targets; it never resolves a working directory for a `virtual` target

### 6. REST API Layer

**Stable identifier**: `rest`
**Reference spec**: [api/openapi.yaml](api/openapi.yaml)

[api/openapi.yaml](api/openapi.yaml) specifies every path and method the backend serves, with
its parameters, request and response bodies, statuses, error envelope, permission
(`x-overlord-permission`), edition and consumers (ADRs 0006, 0048, 0050). Operations are named
below by `operationId`; their shapes are not repeated here. This section holds what the
description cannot express: cross-route invariants, ordering, side effects, ownership,
isolation and privacy rules. Where a rule here and the description disagree, report the
conflict (CONTRACT.md section 3).

Owns:

- URL paths and HTTP method contracts, and the request and response DTO shapes, as
  [api/openapi.yaml](api/openapi.yaml) describes them. DTO member names are the logical
  schema's camelCase column names ([data/README.md](data/README.md)); the TypeScript types and
  Zod schemas are generated from the description (ADR 0050).
- **Request validation at the boundary** (ADR 0051). Every route with an operation validates
  its path, query and header parameters and its body against the operation, after the route's
  authentication, immediately before its handler. A handler's own answer to an invalid request
  stands; an invalid request a handler fails on with 500 answers 400 `invalid_request` with the
  issues instead; a JSON body that does not parse answers 400 `invalid_json` (after
  authentication, so an unauthenticated caller still gets 401). Unknown body members are
  ignored unless the schema refuses them. `OVERLORD_API_REQUEST_VALIDATION` (`enforce`, the
  default; `warn`; `off`) is the operator's switch. The backend test suite checks every
  response it produces against the operation (status, media type and body with undocumented
  members refused) and fails on an invalid request a handler accepted.
- REST auth integration points.
- **Project Run Queues** (`getProjectsByIdRunQueues`, `postProjectsByIdRunQueues`,
  `patchProjectsByIdRunQueuesOrder`, `postProjectsByIdRunQueuesEntries`,
  `patchRunQueuesByQueueId`, `deleteRunQueuesByQueueId`, `patchRunQueuesByQueueIdOrder`,
  `patchRunQueuesEntriesByEntryId`, `deleteRunQueuesEntriesByEntryId`). Reads require project
  and objective read access; planning mutations (entry enqueue, move, reorder, dequeue) require
  `execution_request:create`; queue-definition mutations require `project:update`. Queue-order
  writes supply every live queue id exactly once and only rewrite `run_queues.position`; entry
  membership and order remain exclusively in the Run Queue service. The matching Protocol
  commands are `queue-objective`, `dequeue-objective`, `retry-queue-entry`, `run-queue`,
  `reorder-run-queue`, `create-run-queue`, `update-run-queue`, `delete-run-queue` and
  `reorder-project-run-queues`; MCP maps them through `overlord_queue_objective`,
  `overlord_list_run_queues`, `overlord_reorder_run_queue` and `overlord_manage_run_queue`.
  Queue entries never select an execution target. `ObjectiveDto.queueEntry` projects live
  membership and `autoAdvance` is derived from that membership for compatibility. A queue may
  be mission-scoped; an entry POST without `queueId` targets the objective's own mission queue
  and creates it only if that mission has none. When adding an objective creates its mission's
  queue and an earlier sibling in that mission is already running (`executing` or
  `pending_delivery`, or `launching` with an active execution request) and is not in any queue,
  that sibling is added ahead of the new objective as a `running` entry linked to its latest
  execution request, the same shape a direct Run of a queued objective produces, and the new
  queue is created unpaused. The dispatcher never passes an in-flight entry, and delivery
  removes the entry and ticks the dispatcher, so the queued objective launches as soon as its
  predecessor delivers. The default project queue is never auto-created. Any non-default queue
  that has held an entry retires (soft-deletes) once its last live entry leaves by removal,
  move, drop or delivery completion; a never-used queue is kept. A forced entry removal (`force`
  on `deleteRunQueuesEntriesByEntryId`) also drops an entry wedged in `dispatched`/`running`,
  clears the objective's active execution requests, resets a stuck `launching` objective to
  `draft`, and pauses the containing queue before its removal tick can dispatch a successor; an
  objective already `executing` keeps its live session. Moving an active objective back to
  `draft` or `submitted` likewise pauses its containing queue transactionally. A retry
  (`retry` on `patchRunQueuesEntriesByEntryId`) returns a held entry to `waiting` with
  `attemptCount` reset to 0 and enqueues a dispatch tick; it is refused (409) for an entry
  already `dispatched`/`running` and may not be combined with a move. On every Run Queue
  surface (REST, Protocol, MCP and the legacy `autoAdvance` input): queueing an objective also
  queues every later objective of the mission (by position) that has not started (`draft`,
  `submitted` or `future`, with instruction text, not already queued), directly behind it in
  mission order, while the response stays the requested objective's single entry (the core
  service's internal `cascade: false` option is not exposed); a queue reorder or move
  redistributes the mission's queued objectives, in queue order, across the position slots
  queued objectives already occupy (unqueued objectives never move), and
  `reorderFutureObjectives` carries the new objective order into every queue holding that
  mission's `waiting`/`blocked` entries across the slots they occupy (in-flight entries and
  other missions' entries never move; a changed queue requests a dispatch tick); removing an
  entry whose objective has not started (or a forced removal that reset `launching` to `draft`)
  moves that objective to the end of the mission's objective positions (re-queueing appends it
  to the queue, so it stays last until a user moves it), while removal on completion,
  disconnect or deletion leaves positions alone; the dispatch tick sweeps the project for empty
  queues to retire, the default queue is never retired, and the entry DELETE response reports
  any retired queue, so clients must tolerate a queue id disappearing from the project's queue
  projection after any entry mutation or delivery. The queue read projection's bounded
  `diagnosticCode` names an impossible queue/request pair and never exposes launch commands,
  environment, credentials, terminal output or provider-session metadata. Dispatch failures use
  the same shared redaction and bounding policy before they become a queue hold reason, service
  log detail or response projection. `createExecutionRequest` refuses a
  `requested_source = run_queue` request that would give a serial mission a second active
  objective (`objective_sibling_active`, 409).
- **Project resource-source launch defaults** (`patchProjectsByIdResourcesByResourceIdSourcesBySourceId`)
  are authorized as a project update and preserve the materialization descriptor fields.
- **Creation provenance**: `createdByKind` falls back to `human` in the mapper so no client
  writes a null branch; `MissionDetailDto.createdFrom` is resolved from the soft
  `created_by_session_id` reference by a `LEFT JOIN` that tolerates a missing session, is paid
  once per mission page and is deliberately absent from the board and list projections.
  Provenance is a permanent row attribute, never seen-tracked mission state, and REST exposes
  no filter or sort on it.
- **Objective references**: routes that take an objective id (`/api/objectives/{id}` and the
  launch, prompt and attachment routes) accept an objective UUID or a full display id
  (`{mission.displayId}.{displayKey}`). UUID lookup stays globally unique; display ids resolve
  within the selected organization's `authorizedWorkspaces` set, answer 404 outside that set and
  409 on genuine ambiguity. Mission routes accept a mission UUID or display id;
  `getMissionsByIdObjectives` addressed by a mission display id returns that mission's
  objectives.
- **Mission create launch selection**: each `CreateMissionBody.objectives[]` item carries the
  same optional `agent` / `model` as Protocol `create` items (a `model` requires a non-empty
  `agent`).
- **Parallel objectives**: `postObjectivesByIdLaunch` refuses (409) an active sibling only while
  the mission's `allowParallelObjectives` is false; when it is true a sibling never blocks the
  launch, on the same `resource_key` or a different one. An isolated per-objective branch
  reported through `postMissionsByIdBranchPrepared` (`branchAutomation.isolated`) is recorded on
  `objectives.branch` and audited as a mission event, but must not move
  `missions.active_branch` or the mission-level branch observation off the shared mission
  branch.
- `MissionDto.hasExecutingObjective` and the Live Activity running and completion projections
  count an objective as executing while it is `executing` or `pending_delivery`;
  `pending_delivery` is execution, not a fault.
- Mission schedule validation errors keep their HTTP status and `error` text and additionally
  carry `code: validation_error`; the scheduled duplicate allocates its mission number
  atomically, like every other mission create.
- **Profile-owned Inbox capture** (`getInbox`, `postInbox`, `getInboxById`, `patchInboxById`,
  `deleteInboxById`, `postInboxByIdPromote`, `getInboxByIdAttachments`,
  `postInboxByIdAttachments`, `deleteInboxByIdAttachmentsByAttachmentId`). Every item route
  resolves the caller's profile and answers 404 for an item owned by another profile. Promotion
  checks `mission:create` only on the destination project, calls the ordinary mission-create
  transaction with the capture fields, and consumes the item atomically. Account-owned Inbox
  mutations are intentionally absent from workspace `entity_changes`; clients refetch their own
  list, while promotion retains normal mission realtime behaviour. Inbox attachment routes
  mirror the objective attachment routes (raw body, percent-encoded `x-upload-filename`,
  `MAX_ATTACHMENT_BYTES`); uploads additionally require `attachment:create` on the storage
  workspace. `getStorageByBucketKeyByStorageKey` serves an unpromoted Inbox file only to the
  item's owner. Promotion re-points every active attachment (sets project, mission and first
  objective, clears `inbox_item_id`, bumps revision, records an `attachment` update change) in
  the transaction that creates the mission and consumes the item; files stored in another
  workspace are first copied into the destination workspace's `attachments` bucket under its
  canonical key, the source object is removed after commit, copies are discarded if promotion
  fails, and an attachment added between the copy and the transaction makes promotion answer
  409 (retry). Deleting an item and account deletion tombstone the capture's attachments and
  remove remote stored objects after commit (local buckets keep historical on-disk behaviour,
  as for objective attachments).
- **Cross-workspace Inbox missions** (`getInboxMissions`) union agent-authored missions in
  status type `next` with missions of any creator that are past due or due today or tomorrow
  (UTC day boundaries; `complete` and `cancelled` status types excluded from both due slices),
  across every workspace the caller actively belongs to in the active organization and may
  `mission:read`. Only active projects contribute cards; archived projects are excluded
  regardless of inclusion reason. Human-created missions appear only through the overdue and
  due-soon windows. A mission qualifying several ways is one card carrying every reason;
  `overdue` and `due_soon` are mutually exclusive; `recent` labels rows created within the past
  7 days. Overdue rows lead, most recently overdue first (due date descending), then due-soon
  rows soonest first, then agent-Next rows newest first, each slice capped independently at 60.
  Distinct from the profile-owned Inbox capture.
- **Cross-workspace activity feed** (`getActivityFeed`) is mission-anchored across every
  workspace the caller actively belongs to in the active organization, authorized with
  `mission:read` per workspace. A mission with at least one `launching` / `executing` /
  `pending_delivery` objective is a single item keyed `mission:<missionId>`, never one card per
  objective, carrying every objective of that mission in mission-panel display order and the
  live ones in `activeObjectiveIds`. Its chrome describes the mission's primary running
  objective: the launching one when there is one, else the oldest active one.
  `pending_delivery` counts as live work, so a re-attached objective keeps its mission on the
  feed between its last update and delivery. A mission whose most recent live delivery falls in
  the requested two-week window and that has no live objective is a `mission_delivered` card
  with `runState: 'delivered'` and empty `activeObjectiveIds`. `before` selects the next older
  two-week delivered window and omits live runs and questions; `nextBefore` is that window's
  start when older delivered missions exist, else null. `blocking_question` items are unseen
  `ask` mission events from the past 3 days. Items are grouped rather than purely
  time-descending: launching missions, then executing ones, then questions, then delivered,
  newest first within each group. `createdByKind` / `createdByAgent` describe the item's
  subject: the mission for `mission_run` and `mission_delivered`, the objective behind the ask
  for `blocking_question`. Agent identity treats the protocol session sentinel `unknown` as
  absent and falls back to the objective's `assigned_agent`. Truncation is reported through
  `counts` rather than implied, and no raw payload JSON is exposed.
- **Deferred-work resolutions** (`putDeliveriesByDeliveryIdDeferredWorkByActionIdResolution`,
  `deleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolution`) upsert or remove a
  `human_action_resolutions` row, require `mission:update` on the delivery's workspace, answer
  404 for an unknown delivery or an action id that is not one of the delivery's deferred-work
  ids (reported human actions have no resolution since v150), and emit a
  `human_action_resolution` entity-change row carrying the mission and objective ids. `outcome`
  is allowed only with `status: 'done'` and `outcomeRef` requires `outcome` (400 otherwise). The
  web app may promote deferred work through `postMissions` (`title` as the first objective's
  title and `change`, `Location: {location}`, `Done when: {doneWhen}` separated by blank lines
  as its instruction, `statusId` omitted so the project default applies) or `postObjectives` as
  a future objective on the delivering mission with the same title and instruction, then record
  the matching outcome. No raw payload JSON is exposed.
- **Mission summary** (`getMissionsByIdSummary`, `putMissionsByIdSummarySeen`; operator surface
  only, exempt from MCP parity, no Protocol, CLI or MCP counterpart). Evidence is selected in
  the database before limits and capped at `MISSION_SUMMARY_EVIDENCE_LIMIT` with pre-cap totals
  and truncation flags; suggestions are projected at read time from current-run delivery
  deferred work and resolutions (dismissed and no-longer-current items omitted, promoted items
  reduced to identity, title and resolution). Evidence is the latest current-run delivery per
  objective, its human actions and source rows, deleted objectives included. `deliveredAt` on
  risks and suggestions is the source delivery timestamp projected from the delivery row, not
  model output or persisted summary JSON. Clients learn eligibility only from the summary read
  envelope; `MissionDto` and `MissionDetailDto` do not carry it. `watermark` is the newest
  `deliveredAt` of the current-run deliveries the response draws on or `createdAt` of an open
  `question` or `choice` request. Marking seen refuses (`invalid_input`) a watermark later than
  the caller's current evidence maximum or any watermark on an ineligible mission, upserts
  `max(existing, watermark)` for the calling workspace user and records no entity change. The
  evidence maximum is the newest `delivered_at` of any live delivery or `created_at` of any
  `question` or `choice` request of the mission, whatever its status, so answering a request or
  reopening an objective after the read cannot reject the acknowledgement of evidence that was
  displayed.
- **Delivery read projection** (`getMissionsByIdDeliveries`): delivery mission events expose
  their `deliveryId` without exposing raw event or delivery payload JSON; each delivery's
  deferred-work items are addressed with the same stable ids as the deferred-work resolution
  routes. Paging is in the HTTP Surface below.
- **Mission artifacts**: editing (`patchMissionsByIdArtifactsByArtifactId`) requires
  `mission:update` on the named mission, retains delivery, session and objective provenance and
  `contentJson`, refuses stale edits with 409 and non-HTTP(S) external URLs, keeps at least one
  text, JSON or URL content field, increments the artifact revision and emits an `artifact`
  entity change in the write transaction; the client renders `contentText` as safe Markdown.
  Creation (`postMissionsByIdArtifacts`) requires `artifact:create` on the named mission,
  optionally stamps `objectiveId` / `sessionId` provenance (Protocol and MCP may pass a live
  `sessionKey` instead), leaves `delivery_id` null, refuses non-HTTP(S) external URLs and emits
  an `artifact` entity-change insert in the same transaction; delivery may still attach further
  artifacts later. The same mutations are Protocol `update-artifact` / `add-artifact` and MCP
  `overlord_update_artifact` / `overlord_add_artifact`.
- **Mission shared context** (`getMissionsByIdContext` with `mission:read`,
  `putMissionsByIdContext` with `mission:update`) mirrors Protocol `read-context` /
  `write-context`; a write upserts one entry and emits a `shared_context_entry` entity change in
  the same transaction.
- **Personal Everhour identity** (`getExtEverhourUserConnection`, `putExtEverhourUserConnection`,
  `deleteExtEverhourUserConnection`, and the deprecated `/ext/everhour/integration` alias): a
  personal API key is validated against Everhour, then stored only as AES-256-GCM ciphertext;
  delete revokes and soft-deletes only the caller's credential. These account-wide routes use no
  ambient workspace and no `workspace:*` permission. Timer, time-entry and project-link writes
  use the acting user's key. DTOs, logs, browser and mobile storage, realtime, entity changes and
  errors never contain an Everhour API key or a server encryption key. Workspace-scoped GitHub
  App installation and Everhour/GitHub resource links are unchanged.
- **Personal GitHub repository authorization** (`getExtGithubUserConnection`,
  `postExtGithubUserConnectionAuthorize`, `getAuthCallbackGithubRepository`,
  `deleteExtGithubUserConnection`, `getExtGithubRepositoryOwners`): authorization creates a
  profile-bound, hashed, short-lived OAuth state; the public callback consumes that state once,
  exchanges the code server-to-server, encrypts the access and optional refresh credentials with
  AES-256-GCM, and stores one active connection for the profile; delete revokes and soft-deletes
  only the caller's credential; repository owners are the personal owner plus only active
  organizations whose policy permits the caller to create private repositories. Repository
  authorization reuses the Better Auth GitHub OAuth App client registration (`GITHUB_CLIENT_ID`
  / `GITHUB_CLIENT_SECRET`) but remains a distinct, explicit grant and token lifecycle
  requesting `repo read:org`; the callback is a subpath of the registered
  `/api/auth/callback/github` login callback and runs before the Better Auth wildcard. These
  account-wide routes use no ambient workspace and do not alter the workspace GitHub App
  installation. DTOs, logs, browser and mobile storage, realtime, entity changes, redirects and
  errors never contain a GitHub credential, raw OAuth state or server encryption key.
  `postConnections` with `provider: 'github'` is the canonical start route.
- **Personal-connection compatibility aliases**: the Everhour and GitHub user-connection routes
  above are thin aliases over the shared account-connections module (`ProfileConnections`,
  profile scope): the credential is stored in `account_connections` under the module's key ring,
  never in an extension-held key, the module serves the GitHub callback and serialises refresh,
  and the response shapes and error text are unchanged. The GitHub aliases keep their `returnTo`
  validation (an allowed browser origin URL or `overlord://github/callback`, stored in
  `account_connection_authorizations.return_url`; without `returnTo` they return to the web
  connected-accounts page when a web origin is configured, otherwise to the status page). On
  every alias `connected` means a live `connected` row and a `reauthorization_required` row
  reports `connected: false`; the GitHub `configured` means the OAuth client and a write key are
  both present. Each alias records an in-process hit counter logged hourly with route and client
  family only. Retirement is a later contract change: `/ext/everhour/integration` goes first,
  after the web app uses `/api/connections` and the counter reads zero; the GitHub aliases stay
  until an OverlordMobile release on `/api/connections` has shipped and they record 90 days
  without hits. `getExtGithubRepositoryOwners` is a feature route, not an alias, and reads its
  token through the module.
- **Composite project initialization** (`postProjectsInitialize`) names its target workspace and
  requires `project:create` there. The caller-provided idempotency key creates the project,
  first mission and initial draft objective atomically; optional private GitHub provisioning
  runs outside that transaction through the already connected user OAuth credential and is
  retryable with the same key. A failure never rolls back the created idea. On success the
  extension records one GitHub project link and the core service records one non-primary
  read-only `git` resource for the HTTPS clone URL. The selected owner must be eligible for the
  connected account, and this flow never reads, changes or depends on the workspace GitHub App
  installation.
- **Realtime change projection**: `EntityChangeDto` projections come from `entity_changes`
  (`changedFields` parsed from `changed_fields_json`); streams and catch-up scans aggregate only
  the caller's current readable memberships, filter before projection, and advance the global
  cursor past filtered rows (`getRealtime`, its alias `getStream`, `getSyncChanges`).
- **Mission branch metadata**: read-only `MissionBranchDto` derived from
  `missions.active_branch`, predicted via the service layer's copy of the shared branch/worktree
  planning algorithm (`backend/branch-planning.ts`), co-owned with the Runner Layer and pinned to
  `contract/branch-planning-vectors.json` (see "Shared Deterministic Algorithms").
- **On-demand branch actions** (`postMissionsByIdBranchAction`: commit, merge-with-parent,
  push-parent, publish) run host-side against the project's worktrees under
  `~/.ovld/worktrees` and the selected project resource (`resourceKey`, defaulting to the
  primary resource, so branch actions target the intended repository in multi-resource
  projects). The Runner Layer owns launching the agent into a worktree, not these mutations.
- **Branch checkout resolution**: branch actions, local-target branch observation
  (`deriveBranchStatus`) and Runner Layer branch preparation locate a prepared branch
  identically: the recorded worktree when it still exists on that branch, else whichever
  checkout git reports for the branch (the primary repository or another linked worktree). Only
  the runner creates a fresh checkout when none exists. After an observation,
  `MissionBranchDto.worktreePath` is null when the branch is checked out nowhere on that device.
  `patchMissionsById` with `branchOverride` plus `resetActiveBranch` retargets a mission with a
  prepared branch of any status; following objectives run on the new branch. The
  `BRANCH_WORKTREE_MISMATCH` branch-action error is retired: a worktree on another branch simply
  is not that branch's checkout.
- **Client machine identity**: the `x-overlord-device-fingerprint` / `-label` / `-platform`
  request headers are an optional machine-local lookup hint, never authentication,
  authorization or audit identity. They exist only so a co-located CLI or desktop-bridge caller
  can be matched to an execution target already declared for that machine, and the backend
  still authorizes the resolved target against the authenticated actor's membership and access.
  A hint must never cause an `execution_targets` row to be created on a read,
  protocol-lifecycle, observation or runner path. Ordinary browsers and the mobile app send no
  such headers; only the CLI and the desktop shell bridge do.
- **Execution-target declaration**: Protocol `register-target` (`ovld add-et`), the equivalent
  `postWorkspacesByIdExecutionTargets` (the desktop one-click affordance, with the same
  `execution_request:claim` authorization) and an eligible machine-local project-resource
  checkout link are the only REST operations that may create a `local` execution target. Every
  other route, including the per-machine launch-settings mutations, resolves an existing target
  or reports its absence.
- **Leased execution targets**: persistent is the default. A human may explicitly create an
  independent local target with `{ lifecycle: { kind: 'leased', leaseSeconds, graceSeconds } }`
  through an existing declaration surface; runners, environment variables and adoption never
  select or mutate this policy. A successful authorized local runner heartbeat renews only that
  active target's lease. Expiry is derived offline or ineligible state, never deletion or
  access, resource or preference cleanup; a returning runner can renew during grace. `disabled`
  suspends cleanup and renewal while retaining the target, and re-enabling starts a fresh lease.
  The backend's idempotent `overlord.execution_target.lease_cleanup.v1` worker owns post-grace
  cleanup: it never silently reroutes queued target-bound work, waits for live claims to
  recover, fails remaining queued work with redacted `execution_target_lease_expired`, then uses
  the ordinary target deletion cascade. Lifecycle changes and queue transitions emit the normal
  entity-change and mission-event projections.
- **Machine-local eligibility for declaration**: a caller may declare the acting machine only
  when it carries a real machine-local host identity: the process host on a co-located Local
  backend, otherwise a non-browser, non-backend-host `x-overlord-device-*` hint. A caller with no
  such identity is refused with 409 `no_execution_target_registered` and an actionable message;
  it is never given an inferred target.
- **Project-resource source declaration**: writing a `local_checkout` source with an explicit
  `executionTargetId` updates that already-declared target's source and creates nothing (this is
  how an ordinary browser edits a source); writing a `sourceUrl` Git source creates nothing
  (the source is project-global unless the body names an `executionTargetId`, which is stored as
  given); writing a `local_checkout` source with no
  `executionTargetId` declares the acting machine when it is machine-local-eligible, and
  otherwise fails 409 `no_execution_target_registered` rather than declaring the caller or
  silently writing a pathless global source.
- **Worktree/branch automation is a user preference**, not a workspace setting:
  `worktreeBranchAutomationEnabled` lives in the acting profile's launch-session defaults, and
  the `…/launch-settings/worktree-branch-automation` routes are aliases for the session-defaults
  update. `LaunchSettingsDto.worktreeBranchAutomationEnabled` and
  `MissionBranchDto.worktreeAutomationEnabled` mirror the user default, so the value is
  identical across every workspace the user belongs to; the workspace id on the launch-settings
  routes only selects the authorizing membership. Workspace values stored before this rule are
  not migrated.
- **Launch-settings mutations** (`…/launch-settings/agents/{agentKey}` and
  `…/terminal-profile`) require an already-declared acting target and fail 409
  `no_execution_target_registered` when the machine has none. Configuring settings is not an
  onboarding trigger. `…/launch-settings/session-defaults` is the exception by construction: the
  user-level provider and viewer default is stored on the profile, not a target, so it neither
  requires nor declares one.
- **Desktop OAuth handoff** (`getAuthDesktopGithub`, `getAuthDesktopCallback`,
  `postAuthDesktopExchange`): the browser-only start begins only the configured GitHub provider
  with the fixed desktop callback, so Better Auth's OAuth state cookie is created in the system
  browser; the callback mints an opaque, short-lived, single-use handoff ticket from that browser
  session and redirects with it only to `overlord://auth/callback` (without a browser session it
  answers as the operation describes); the unauthenticated exchange consumes the ticket once and returns the Better Auth session token to the desktop shell's main process.
  These routes never return GitHub credentials, bearer tokens or reusable OAuth state, and the
  ticket itself is not an API credential.
- **Hosted-web OAuth handoff** (`getAuthBrowserCallback`, `postAuthBrowserExchange`): the
  browser-only callback validates the requested return origin against configured trusted web
  origins, mints an opaque, short-lived, single-use handoff ticket from the authenticated
  browser session, and redirects only to that origin; the unauthenticated exchange consumes the
  ticket once and returns the Better Auth session token to the web client. These routes never
  put GitHub credentials, bearer tokens or reusable OAuth state in a URL, and the ticket itself
  is not an API credential.
- **Agent-session channel route family** (`/api/agent-session-channels/v1/*`): adapter event,
  request, input and heartbeat operations for exactly one channel, authenticated only by a
  channel-scoped credential. A normal user or session token is refused there, and a channel
  credential is refused on every human route. The separate human surfaces (resolving a session's
  effective capabilities, listing and answering requests, releasing a request back to the
  terminal so the native prompt owns it, enqueuing or cancelling input) use ordinary session or
  token auth plus resource-derived RBAC, require the permission-resolution RBAC and workspace
  policy ceiling to resolve a decision, and apply revision CAS with immutable audit attribution.
  REST additionally applies a second server-side payload allowlist and bounds every summary,
  option, id, sequence, timestamp and diagnostic code; formatter output renders as escaped plain
  text with explicit truncation. Capability projections are diagnostics: a client gates controls
  on the live channel's effective capability snapshot, never on the static connector catalog and
  never on the agent identifier.
- **Objective-scoped agent-session reads** (`getAgentRequests`, `getAgentSessionInputs`): a full
  objective display id supplies its mission; a UUID requires `missionId`. With `objectiveId`,
  returned rows and the `liveChannel` projection are restricted to that objective, and a
  mismatched mission/objective pair is refused.
- The realtime Server-Sent Events endpoint (`getRealtime`, alias `getStream`).
- SQL Studio launch metadata in `getMeta` when the optional external SQL Studio process is
  enabled.
- **Webhook subscription management** (`/api/webhooks*`, gated by `webhook:*` permissions):
  parentless list and create require an explicit `workspaceId` (or derive it from the named
  project); entity-addressed mutations derive and authorize the subscription's owning workspace.
  The in-process webhook dispatcher (`backend/webhook-dispatcher.ts`, a `RealtimeHub`-style
  singleton polling loop) claims `outbox_messages` rows and delivers HMAC-signed HTTP POSTs.
  SSRF guards (HTTPS-only, private-network block) apply to external endpoints; hosts matching the
  `OVERLORD_WEBHOOK_INTERNAL_HOSTS` allowlist (plus implicit `localhost` in Local edition) are
  internal: exempt from the SSRF block and the HTTPS requirement, and defaulting to the `full`
  payload mode. Full `mission.delivered` envelopes expose the authorized normalized
  `delivery.report` projection (never raw delivery payload JSON); thin envelopes remain
  identifier and link only. The envelope carries no `changeRationales`; its `changedFiles` items
  are `{ filePath, resourceKey, source }`.
- **Organization management** (`getOrganizations`, `patchOrganizationsById`,
  `getOrganizationsByIdAdmins`, `postOrganizationsByIdAdmins`,
  `deleteOrganizationsByIdAdminsByUserId`): updates and admin management are org-admin gated;
  "org admin" is derived, not a stored role, and the transactional invariant is that an org
  admin is `ADMIN` of every constituent workspace.
- **Shared onboarding** (`postOnboarding`, zero-membership users only) creates an organization, a
  workspace (default `general`), the caller's membership and the `ADMIN` role in one
  transaction, and is used verbatim by both the web onboarding screen and `ovld org-setup` so the
  two clients cannot drift. `getWorkspacesByIdProjects` lists one workspace's projects now that
  the sidebar can render several workspaces of one organization at once.
- **Organization images**: storage routes for the `organization-images` bucket key carry a
  `PUBLIC organization_image:read` grant, mirroring `workspace_image:read`.
- **Workspace target projection** (`getWorkspacesByIdExecutionTargets`): members may view every
  non-deleted, executable target in that workspace (browser-only web sessions are not execution
  targets and are excluded). Workspace admins may rename a target
  (`patchWorkspacesByIdExecutionTargetsByTargetId`) and may soft-delete one with no active queued
  work (`deleteWorkspacesByIdExecutionTargetsByTargetId`); deletion clears target-scoped project
  resources and project target preferences pointing at it, and soft-deletes the linked `devices`
  row when it no longer has any live execution target. The projection also soft-deletes any
  remaining orphan devices (no live execution target) before returning. It never exposes
  `connection_json`, credentials or mutable access information; project launch selection stays
  constrained to the acting member's eligible targets.
- **Workspace agent catalog and launch settings** are managed only through their
  workspace-scoped routes under `/api/workspaces/{id}/...`, authorized against the target
  workspace's own membership (`launch:read` to view, `launch:configure` to mutate;
  non-membership reads as 404). Resource-owned REST and extension operations derive both the
  workspace and the caller's membership in it before authorization, persistence, provider access
  and change-feed attribution.
- **Default-project preference** (`getProfileDefaultProject`, `putProfileDefaultProject`,
  `deleteProfileDefaultProject`; `defaultProjectId` on `getMeta`) is profile navigation state:
  it grants no access, never scopes a request, and is ignored when its project is no longer
  readable. Writes authorize the named project, atomically clear the marker from all profile
  memberships, then mark the selected row.
- **User-token lifecycle** (`getUserTokens`, `postUserTokens`, `patchUserTokensById`,
  `postUserTokensByIdRevoke`, `deleteUserTokensById`): owners manage only their own tokens;
  delete shares the `user_token:self:revoke` authorization, only soft-deletes an
  already-revoked token and emits an `entity_changes` delete tombstone. No response exposes a raw
  secret or hash. Creation takes no workspace or organization selection: a token minted by the
  signed-in user for themselves consents to all current and future workspaces in that caller's
  organization, recorded as `all_workspaces` with no narrowing allowlist, and its issuance
  workspace is audit attribution only. Every request still intersects that consent with live
  membership and per-workspace RBAC. Explicit workspace consent is the third-party OAuth approval
  path only. These routes resolve the owning profile from the authenticated caller, never from
  the instance's oldest account.
- **Hosted MCP OAuth** (`postOauthRegister`, `postOauthToken`, `postOauthRevoke`,
  `getOauthAuthorize`, `postOauthAuthorizeRequest`, `postOauthAuthorizeApprove`): the request and
  approval helpers expose and require an explicit single-organization consent choice when more
  than one organization is available; approval selects explicit live workspace ids or all current
  and future workspaces in that organization. `getAuthorizedWorkspaces` is the read-only
  projection of the caller's organization and workspace authorization snapshot and never changes
  scope. Token rules are in [authorization.md](authorization.md).
- **Virtual Target Queue Surface** (`/api/virtual-targets/v1/*`): REST owns the DTO shapes,
  target-authenticated auth and RBAC enforcement, per-request idempotency, and bounded and
  redacted output for this surface; the immutable `VirtualExecutionQueueItemV1` payload and its
  digest are built by the service layer at queue time and returned only to the authenticated
  claiming gateway; the local `/api/runner/*` routes are unchanged. The surface is specified in
  "Virtual Gateway → REST (Virtual Target Queue Surface)" below; the backend does not yet
  register it, so [api/openapi.yaml](api/openapi.yaml) does not describe it (ADR 0048).
- **Mobile Live Activity and push registrations** (`putMobileLiveActivitiesByActivityIdPushToken`,
  `deleteMobileLiveActivitiesByActivityIdPushToken`, `putMobileLiveActivitiesStartToken`,
  `postMobileLiveActivitiesStartTokenRevoke`, `putMobilePushDeviceToken`,
  `postMobilePushDeviceTokenRevoke`) carry opaque tokens in the body, are private to the
  caller's profile, and have no read surface. A Live Activity registration carries
  `environment` and `bundleId` for per-registration APNs routing and an optional
  `startedByPush` handoff marker. The stored push-to-start registration is the account's consent
  record for desktop-initiated Live Activities. Notification preferences
  (`getProfileNotificationPreferences`, `putProfileNotificationPreferences`) are the caller's own.
- The in-process Live Activity dispatcher (`backend/live-activity-dispatcher.ts`) claims durable
  `overlord.live_activity.dispatch.v1` and `overlord.live_activity.start.v1` worker jobs,
  recomputes the bounded account presentation snapshot, and sends APNs `liveactivity`
  start/update/end events.
- The in-process standard push dispatcher (`backend/push-notification-dispatcher.ts`) claims
  durable `overlord.push_notification.dispatch.v1` worker jobs, recomputes the alert
  presentation snapshot, and sends APNs `alert`/`background` pushes on the plain bundle-id
  topic. It shares the APNs signing and transport helpers with the Live Activity dispatcher but
  never shares tokens, topics or push types with it.
- **Private assistant conversations** (`/api/chat/threads*`, `/api/chat/runs/{id}/{cancel,continue}`,
  `/api/chat/questions/{id}/answer`, `/api/chat/proposals/{id}/create`, `/api/chat/providers`,
  `/api/chat/notifications*`): owner- and organization-scoped with existence-hiding 404s and
  Cloud-only (`chat_unavailable` on Local); idempotent submission and Create keyed by client
  request ids; atomic snapshot plus `eventCursor`; the owner-scoped SSE event channel with replay
  from storage, bounded retention and `snapshot_required`, the one sanctioned realtime channel
  that does not derive from `entity_changes`; expiring foreground presence and monotonic
  rendered-event acknowledgements separate from replay cursors; backend run scheduling with
  leased, fenced attempts; the Gemini runtime adapter and private checkpoint persistence; the
  in-process conversation-notification dispatcher over `chat_notifications`.
- **Owner-only chat diagnostics** (`getChatThreadsByIdDiagnostics`) use the same live membership,
  owner and organization gates as chat; foreign callers get 404 and Local gets
  `chat_unavailable`. Responses are no-store. Diagnostic kinds are open labels, not chat event
  kinds. Capture and privacy rules are in "Assistant Conversation Behaviour" (Owner-only
  diagnostics).
- **Account connections** (`getConnections`, `postConnections`, `postConnectionsApiKeys`,
  `patchConnectionsById`, `deleteConnectionsById`, `getConnectionsKnowledgebaseCallback`,
  `getOauthClientsKnowledgebaseJson`); the backend outbound MCP client for the configured
  Knowledgebase with a reviewed read-only allowlist; and the mission-less
  `postProjectsByIdRepositoryReads` route over the runner capability queue. Profile-scoped
  connections (`?scope=all` listing, API-key connections, deleting profile-scoped rows, and
  `github` OAuth) are served on both editions; the default listing and Knowledgebase stay
  Cloud-only. Setting an API key validates it upstream before sealing it and is also the
  reconnect and rotation call. Deleting erases the credential first, then revokes upstream
  best-effort where the provider supports it, then tombstones the legacy row. Starting a
  connection stays OAuth-only (a non-GitHub provider is refused, as `postConnections` describes per
  edition); `github` reuses the
  caller's live GitHub connection for a reconnect, and its web-only `returnPath` must be a
  relative path starting with `/`, not `//`. The GitHub callback redirects with only
  `provider=github` and `status` to `overlord://connections/callback` for `mobile` and to the web
  origin plus `returnPath` (default `/settings/connections`) for `web`; without a return target
  it renders a status page, and a sign-in started by a legacy alias returns to its validated
  legacy URL with `githubConnection=<status>`. On Local, a provider with no write key reports
  `available: false` with `encryption_not_configured` and connecting answers 503; credentials
  stored earlier stay listed and answer `unavailable` without being erased; there is never a
  plaintext fallback. Knowledgebase connection settings (`patchConnectionsById`, Cloud-only)
  apply to the caller's live Knowledgebase connection only and bump `revision`;
  `assistantWriteScope` is always `per_request` for other providers.

Does NOT own:

- Database schema (→ Database Layer)
- Protocol CLI surface (→ Protocol Layer)

### 7. Auth Layer

Specified in [authorization.md](authorization.md).

### 8. Automations Layer

**Stable identifier**: `automations`
**Reference spec**: [`automations/docs/01-automations-overview.md`](../automations/docs/01-automations-overview.md)

Owns:

- The pure `planRunQueueDispatch` planner. It plans each project queue independently, permits one dispatched/running entry per queue, retains and skips held entries, and never performs I/O or target selection.

- Pluggable automation interface (`Automation`) and built-in automation registry
- Provider configuration for optional Gemini-backed tools (`GEMINI_API_KEY`, model selection)
- Reference summarization tools (text summarization, objective title generation)
- Built-in `compose-delivery` automation for schema-constrained delivery presentation drafts
- Fire-and-forget automation helpers that callers invoke through injected persistence callbacks
- Downstream automation loading via `OVERLORD_AUTOMATIONS_MODULE` (the `custom-automation` extension point)

Does NOT own:

- Database schema (→ Database Layer)
- Mission/objective lifecycle state machines (→ CLI / service layer callers)
- Agent protocol or connector behavior (→ Protocol / Connector Layers)

### 9. Extension System

**Stable identifier**: `extension`
**Reference specs**: `contract/data/README.md` → Extension Points section and this section; design background (non-normative): [`connectors/docs/agent-harness-configuration-architecture.md`](../connectors/docs/agent-harness-configuration-architecture.md)

Owns:

- `user_harness_extensions` authoring workflow
- `workspace_harness_extensions` catalog promotion workflow
- Extension table namespace (`ext_<name>_`)
- Extension migration component naming (`ext:<name>`)
- Namespaced JSON metadata keys inside core tables

Does NOT own:

- Core table schemas (→ Database Layer)
- Built-in connector catalog (→ Connector Layer)

### 10. Desktop Shell

**Stable identifier**: `desktop`
**Reference spec**: [`desktop/docs/desktop-app.md`](../desktop/docs/desktop-app.md)

An **optional** Electron wrapper around the webapp. It is a thin desktop shell, not a reimplementation of product logic: it loads the web control center in a hardened `BrowserWindow`, supervises the local processes the webapp depends on (Local mode), and gives the user a native app shell.

The shell runs in one of two modes, selected by the active **backend profile** (Local is the default and the unchanged behavior all prior contract text describes):

- **Local profile** (unchanged): fork the embedded web/REST server (`utilityProcess`) and load the bundled SPA from the loopback origin; API base = the loopback origin; Better Auth session cookies are same-origin; CSP/nav guard are scoped to that single loopback origin.
- **Remote profile** (additive): **do not** fork the embedded server. The bundled SPA still loads from a local origin (privileged renderers never load remote content), but its runtime-injected **API base URL** points at the hosted backend. In-app auth uses the active profile's Better Auth **session bearer token**, obtained at login and persisted via `safeStorage`/keychain; it never reads or mints a `USER_TOKEN`. Spawned `ovld` processes receive their separate `USER_TOKEN` credential only when required. CSP `connect-src` and the navigation guard are recomputed from the active profile to allow the remote REST + `wss://` origins while keeping navigation shell-local; `/api/health` checks support HTTPS with a Local fallback.

Owns:

- The Electron app/window lifecycle and the hardened `BrowserWindow` security baseline (`contextIsolation`, `sandbox`, `nodeIntegration: false`, `preload`), the loopback-scoped CSP, single-instance lock, external-navigation handling, native window chrome (macOS `hiddenInset` title bar + inset traffic-light position so the webapp nav serves as the title bar), and the sandboxed renderer's native context menu (spellcheck/edit roles)
- Process supervision of the bundled web/REST server (forked as a Node `utilityProcess` in **Local** mode only; **not forked** in Remote mode) and, optionally, a local runner
- Persisted backend **profiles** (`{ id, label, mode: 'local' | 'remote', backendUrl }` + active profile id) in `userData/settings.json`, per-profile Electron **session partitions** (`persist:backend-<id>`), per-backend bearer-token storage via `safeStorage`, and the reload-and-login switcher / first-run chooser
- The minimal `preload` bridge surface exposed to the renderer as `window.overlord` (feature-detected by the SPA; never required by it), including the additive backend-config ops `getActiveBackend()`, `listBackends()`, `addBackend()`, `removeBackend()`, and `switchBackend(id)`, plus `writeProjectMetadata(...)` for local checkout metadata writes in remote-client mode, `invokeLocalTarget(call)` for unified checkout-local capabilities, and `runnerService.{getStatus,install,start,stop,restart,uninstall}()` which drives the CLI-owned `ovld runner service <action>` operations as a subprocess and returns their parsed JSON result (the shell never manages the service process itself)
- The feature-detected native notification bridge `window.overlord.showNotification({ title, body, tag?, soundUrl? })`, implemented only through the `overlord:show-notification` IPC handler. It accepts bounded, user-visible presentation only; it never carries a route, credential, token, raw event content, or arbitrary Electron capability.
- The optional `window.overlord.diagnostics.{getStatus,record,reveal}` bridge for a fixed 15-second local Chromium performance trace and process CPU/memory samples. Only the main shell document may invoke it. One recording runs for 15 seconds in Electron main; capture is opt-in, continues across settings navigation, uses a bounded trace buffer and bounded storage, replaces only the previous local capture, and exposes no arbitrary file paths, debugger commands, trace options or upload capability.
- Remote OAuth callback ownership: registers `overlord://auth/callback`, receives only an opaque handoff ticket, exchanges it directly from the Electron main process with the active backend, and persists the returned Better Auth session token in the matching profile's `safeStorage`; neither the deep link nor the preload bridge carries a token
- Mission deep-link ownership: registers and consumes `overlord://missions/<missionId>` where `<missionId>` matches `[A-Za-z0-9:_-]{1,64}`. The main process rejects all other mission URL shapes, focuses or creates the shell window, and emits the shell-local `overlord:navigate` bridge notification for the fixed internal `/user/missions/<missionId>` route. The link carries no credential, ticket, or payload; the feature-detected SPA navigates only to that supplied internal route.
- Desktop packaging metadata and the build/sign/notarize pipeline (`electron-builder`, entitlements, app-data layout)

Does NOT own:

- REST/SSE URL paths or DTO shapes (→ REST API Layer)
- CLI/launch/terminal configuration, including per-user terminal profiles on `user_execution_target_preferences` (→ CLI / Runner Layers)
- Authentication mechanism (→ Auth Layer)
- Database schema or adapter selection (→ Database Layer)

Depends on:

- `rest` — loads the SPA and calls `/api/*` over the loopback origin
- `cli` / `runner` — spawns `ovld serve` / `ovld runner` / `ovld launch` as subprocesses
- `auth` — in-app auth uses Better Auth session cookies on the same loopback origin; spawned CLI uses `USER_TOKEN` when a credential is required

The dependency arrow points one way only: `webapp`, `cli`, and `database` MUST NOT depend on `desktop`.

### Native GitHub sign-in recovery

Specified in [authorization.md](authorization.md).

### 11. Mobile REST Consumer

**Stable identifier**: `mobile`

The native Overlord Mobile app is an external REST consumer. It owns the local
ActivityKit lifecycle and the per-activity APNs token stream; it never accesses
Overlord's database or APNs credentials.

Owns:

- The account-level ActivityKit activity identifier and `pushTokenUpdates` lifecycle
- Registration/rotation/revocation calls on the Mobile → REST surface
- Ending local activities before sign-out and ensuring the corresponding registration is revoked
- The assistant chat journey: the shared `OverlordCore` stream client (incremental SSE parsing, ordered delivery, resume cursor, dedupe, reconnect/backoff, `snapshot_required` recovery, polling fallback, state scoped to backend/account/thread), foreground presence and rendered-event acknowledgements, conversation notification routing to `overlord://chat/threads/:threadId` including cold start, and Knowledgebase sign-in through `ASWebAuthenticationSession`
- Presentation of the additive creation-provenance fields it decodes from `MissionDto` / `ObjectiveDto` (`createdByKind`, `createdByAgent`, `createdByWorkspaceUserId`). The mobile mirror in `OverlordCore/Contract.swift` decodes them as optionals defaulting to `human`, per the existing additive-decode convention, so an older server response still decodes. Where the mission chat feed reads objectives back as messages the operator sent, an `agent`-authored objective must be attributed rather than presented as the operator's own text, and the attribution must also lead the VoiceOver label — a client that renders provenance only as a fill or glyph misattributes it for assistive technology.

Does NOT own:

- Server-side registration persistence, account snapshot selection, APNs authentication, delivery, or retries (→ REST / Database Layers)
- Mission/objective lifecycle and authorization (→ Protocol / REST / Auth Layers)

Depends on:

- `rest` — authenticated HTTPS/JSON calls only

### 12. MCP Server

**Stable identifier**: `mcp`
**Reference spec**: [`mcp/README.md`](../mcp/README.md)

An optional hosted Model Context Protocol surface for cloud agents such as
ChatGPT, Claude, and other MCP clients. It runs inside the backend process and
is enabled only when `OVERLORD_MCP_ENABLED=true`.

Owns:

- MCP endpoint path (`/mcp`) and supported MCP protocol-version advertisement
- MCP tool names, input/output schemas, safety annotations, MCP Apps resource
  URI patterns, prompt names, and MCP JSON-RPC response shaping. The public
  ChatGPT surface is mission-first: project resolution and selection, mission
  search, mission-context reads, and explicit mission/session writes. Widget
  resources are presentation-only and consume the structured result of a
  corresponding render tool; they never call local filesystem or runner APIs.
- OAuth protected-resource metadata for the hosted MCP resource
- Mapping MCP tool calls to existing service/protocol operations
- Hosted `overlord_update_artifact` tool, which forwards to Protocol `update-artifact` and never writes artifact rows directly
- Hosted `overlord_add_artifact` tool, which forwards to Protocol `add-artifact` and never writes artifact rows directly
- Hosted `overlord_create_inbox_item` and the explicit `unassignedToProject: true` form of `overlord_create_mission`, both forwarding to the profile-owned inbox service; that form returns an explicit `{ unassigned: true, inboxItem }` result and never chooses a workspace or project. `overlord_create_mission` with neither `projectId` nor `unassignedToProject: true` is rejected.
- `overlord_search_missions` returns v3 grouped results by default and accepts the v3 filters plus `detail` (`compact` default or `full`). Compact caps matches at two per mission, removes child snippets, and omits child `matchedTerms`, `createdAt`, and `updatedAt`; it retains ids, display ids, entity types, scores, and all envelope completeness metadata. Full preserves the v3 envelope. Hosted MCP and the local connector shim expose the identical schema and semantics.
- Additive `agent` and `model` inputs on `overlord_create_mission`, forwarded to Protocol `create` as `--objective-agent` / `--objective-model` so the created mission's initial objective carries a launch selection without a second `overlord_add_objectives` call. `model` requires `agent`; both omitted keeps project launch-preference defaulting.
- Additive `assignedTo` input on `overlord_create_mission`, forwarded to the same service-layer member resolver as Protocol `--assigned-to` (accepting `workspace_users.id`, profile UUID, `orgid:username`, bare username, or email). An unresolvable member is an error, never a silent fallback to unassigned. The MCP surface never resolves members itself, and `assignedTo` is meaningless on the unassigned inbox fallback above.
- Mission and objective results returned through MCP carry the same `createdByKind` / `createdByAgent` / `createdByWorkspaceUserId` provenance fields as the REST DTOs they project; rows an MCP caller creates are authored on the protocol surface and are therefore `agent`-kind.
- `overlord_create_mission` and `overlord_add_objectives` return structured mission/objective DTOs with persisted launch assignments and objective settings; tool descriptions identify the fields callers should inspect (`assignedAgent`, `model`, `resourceKey`, and `queueEntry` / `autoAdvance`).

Does NOT own:

- Database schema or persistence rules (→ Database Layer)
- Authentication mechanism, token issuance, consent, or RBAC policy (→ Auth Layer)
- Protocol lifecycle semantics such as attach/update/deliver state transitions (→ Protocol Layer)
- REST URL/DTO contracts outside `/mcp` and OAuth discovery metadata (→ REST API Layer)
- Local filesystem, worktree, runner claim, or branch-action operations (→ CLI / Runner / REST Layers)

Depends on:

- `auth` — resolves the MCP caller to an authenticated profile/workspace actor
- `protocol` / service layer — executes mission lifecycle and project discovery operations
- `database` — reached only through existing service/protocol functions

---

## Interaction Surfaces

These are the **only sanctioned paths** between components. Bypassing these surfaces is a contract violation.

### Agent → Protocol (Primary Mission Surface)

Specified in [protocol.md](protocol.md).

### Protocol → Database (Service Layer)

Specified in [protocol.md](protocol.md).

### CLI → REST (Backend Client Surface)

- **Transport**: HTTP/JSON to the configured backend URL (`backend_url`) over loopback for local mode or HTTPS for cloud mode
- **Rule**: The published npm CLI must not open SQLite, import database adapters, or write tables directly; mutations go through REST/backend endpoints that use the service layer/database runtime behind the backend process
- **Project context**: Resolved via backend APIs plus `.overlord/project.json` and working-directory hints sent in request payloads
- **Runner**: The CLI runner remains local and launches agents, but queue claim/status/mark-success/mark-failure operations go through backend APIs

### Connector → Protocol (Hook Surface)

Specified in [protocol.md](protocol.md).

### Connector → CLI Agent Session Runtime → REST (Agent Session Surface)

Specified in [protocol.md](protocol.md).

### Runner → REST (Delegation Surface; formerly Queue Surface)

- **Transport**: HTTP/JSON to the configured backend URL
- **Endpoints**: `GET /api/runner/status`, `POST /api/runner/claim`, `POST /api/runner/clear`, `POST /api/runner/requests/:id/launching`, `POST /api/runner/requests/:id/launched` (additive optional `providerSession` body), `POST /api/runner/requests/:id/failed`, and `POST /api/missions/:id/branch-prepared`
- **Claiming**: Backend performs an atomic compare-and-set claim on `execution_requests`; verifies launchable state
- **Run Queue boundary**: project Run Queues are upstream planning state and are invisible to runners and virtual-target gateways. A dispatcher resolves target/config at dispatch and creates an ordinary `execution_requests` row with additive open `requested_source = run_queue` and an entry-scoped idempotency key; claiming and all runner DTO/state semantics remain unchanged. A serial mission (`allowParallelObjectives = false`) has at most one dispatched/running Run Queue entry across all queues in the project; a parallel mission has no such limit. Entry `blocked` means a human must act and `waiting` means eligible or held on a self-clearing condition (`waitingReason`); the dispatcher re-evaluates both states every tick, so no queue mutation is needed to release a hold whose cause is gone.
- Enqueueing an already executing or pending-delivery objective records it as a running entry without launching it again. When that operation creates its mission queue, the queue is resumed so subsequently queued work can follow its delivery; an existing queue retains its pause state. The existing enqueue authorization and response shape apply to all queue surfaces.
- **Long poll**: On Postgres, an otherwise-empty `POST /api/runner/claim` waits up to 25 seconds on a dedicated (non-pooled) `LISTEN` connection for queue notifications, then retries the same scoped atomic claim. After LISTEN is armed, the handler flushes HTTP status and headers with no body bytes until the final `{ request, longPoll }` JSON, so proxies and client header timeouts do not see 25 seconds of silence. Connecting the LISTEN client is bounded (~3 seconds); a connect failure or timeout returns an empty claim with `longPoll: false` so the runner uses its jittered fallback instead of hanging. Its additive `longPoll` response flag is `true` when the wait capability was used; the runner immediately reconnects after an empty long-poll response. Notifications are wake hints only and never replace authorization or claiming. SQLite returns immediately with `longPoll: false` and retains the portable fallback cadence.
- **Side effects**: Backend claim and state transitions append `mission_events` and `entity_changes` in the same transaction
- **Payload types**: `@overlord/contract` names the wire shapes. `RunnerExecutionRequestDto` (`ExecutionRequestDto` plus `metadata` and `workingDirectory`) is what `GET /api/runner/status` (`queue[]`) and `POST /api/runner/requests/:id/*` return; its `executionTargetId` is the claiming target once claimed (`claimed_by_execution_target_id`, falling back to the queue-time target), unlike `ExecutionRequestDto`, which always reports the queue-time column. `RunnerClaimedRequestDto` adds the claim-time `preLaunchCommands` and `launchEnvVars` and carries `launchConfig` re-resolved against the claiming target; `RunnerClaimResponse` is the `{ request, longPoll }` claim body. Runners must keep tolerating absent fields from older backends
- **Claimant resolution**: A claim resolves an **already declared** non-deleted `local` execution target and never creates a device or execution target. An explicit `executionTargetId` in the claim body is resolved and authorized (existing, non-deleted, type `local`, `status = 'active'`, and an active `workspace_user_execution_targets` row for the authenticated member); otherwise the acting machine is resolved from the process host on a co-located Local backend or from the `x-overlord-device-*` hint. When no such target exists — or an explicit target id does not resolve in that workspace — the claim fails with `409 no_execution_target_registered` and an actionable message naming `ovld add-et`, so a machine with a runner but no declaration is visibly unconfigured rather than silently minting a target. A runner polling several workspaces reports this only when **no** workspace in its scope resolves a target
- **Runner instance registration**: The claim body additively carries `runnerInstanceId`, `runnerRelation` (`native` | `adopted`), `runnerLabel`, `runnerVersion`, `capabilities`, and `supportedAgents`. When `runnerInstanceId` is present the backend upserts **only** the caller's `execution_target_runner_registrations` row for the resolved target — health `healthy`, heartbeat `now` — and never the target itself. Several runner instances may serve one target: a physical host registers a `native` runner, and a container adopting that host (AgentPod) registers an additional `adopted` runner against the **same** target row rather than declaring its own. `relation` defaults to `native` when the target was resolved from the acting machine's own hint and `adopted` when an explicit `executionTargetId` names a target belonging to a different device. A claim without `runnerInstanceId` (an older runner) still claims normally and simply registers no instance
- **Claim competition is target-level**: any healthy runner registered to the selected execution target may claim its work. Runner instances are diagnostics and liveness, never an addressable routing unit; no request field selects one
- **Claim metadata**: Claim must set `claimed_by_device_id`, `claimed_by_execution_target_id` when known, `claimed_by_runner_registration_id` when the claim registered a runner instance, and `claim_expires_at`
- **Local liveness**: A `local` target is reachable when at least one of its non-deleted runner registrations is `healthy`/`degraded` with a heartbeat inside the reachability TTL. The 25-second claim long poll carries the heartbeat; there is no second polling loop. For upgrade compatibility a target that has **never** had a runner registration continues to fall back to `devices.last_seen_at`, so a pre-upgrade install stays selectable until its runner publishes its first heartbeat; once any runner has registered for a target, `devices.last_seen_at` no longer affects its reachability
- **State transitions**: `queued → claimed → launching → launched|failed`; active requests may be cleared; stale claims, launched-without-attach requests, and a `launching` request whose runner never reported `launched` within the launch TTL may move to `expired`; other terminal statuses are sinks unless a new request is explicitly queued. The launch TTL is measured from `execution_requests.launch_started_at`, which is written when the request enters `launching`. Expiry never re-queues — a runner that died mid-launch may already have spawned an agent the backend cannot see, so expiring the row plus the runner's own reported failure is what preserves launch-at-most-once. Because a very slow launch can be expired underneath itself, `POST /api/runner/requests/:id/launched` must tolerate the resulting conflict on an already-`expired` request rather than treat it as an unexpected error
- **Attach correlation**: Protocol attach links the launched request to `agent_sessions` via `execution_requests.launched_session_id` when the launched context supplies an execution request id
- **Terminal-session projection**: `MissionDetailDto.terminalSessions` returns bounded Latch provider-session mappings from all non-deleted execution requests for the mission, including target/device label, stored session name, claim-time executable/viewer, the claim-time window-or-tab shape (`viewerOpenAs`, absent meaning `window`), and last observed state. It never exposes launch environment, terminal output, conversation data, credentials, socket tokens, or attachment grants. A mapping Latch has already reclaimed (`LATCH_SESSION_ABSENT`) is omitted from the projection after `forget` drops `metadata_json.providerSession`; the panel does not keep a tombstone card. The mission panel presents remaining sessions as one card — the newest session for the active objective, else the newest overall — with the rest collapsed into an accordion whose trigger counts the other running Latch connections. Mission and objective lifecycle mutations never stop a terminal session. Protocol attach is the binding record and does not depend on Latch.
- **Latch v2 boundary**: `POST /api/missions/:id/terminal-sessions/forget` drops a provider-session mapping after Latch reports that session absent; it is idempotent, does not stop a process, and does not delete the execution request. Overlord exposes no harness-event ingest or pending-input resolution routes and maintains no conversation cursor or fold. A future conversation surface must use Latch's authenticated, server-first `/v2/sessions/:id/conversation` WebSocket and Hub-owned revision/operation semantics rather than reintroducing transcript observation or PTY injection.

### Virtual Gateway → REST (Virtual Target Queue Surface)

- **Transport**: HTTPS/JSON to the configured backend under the versioned `/api/virtual-targets/v1/*` route family
- **Authentication**: A gateway principal credential scoped to exactly one `execution_targets` row of type `virtual` (target-authenticated, **not** device-authenticated). A gateway cannot enumerate, claim, or observe another target's work; `execution_requests.claimed_by_execution_target_id` is the universal claimant identity and `claimed_by_device_id` stays nullable for virtual claims
- **Registration**: `PUT /api/virtual-targets/v1/registration` registers/refreshes the target's gateway identity (`gateway_key`, `gateway_instance_id`), advertised capabilities, supported agents, supported queue schema versions, adapter key/version, and heartbeat. Registration **replaces** rather than creates a target when a stable gateway identity matches. Registration requires target-management authorization or a provisioned gateway credential
- **Claiming**: `POST /api/virtual-targets/v1/claim` atomically claims a queued request assigned to the caller's target and returns the immutable `VirtualExecutionQueueItemV1` snapshot, a `claimId`, an expiry, and only request-scoped opaque launch-grant references — never filesystem paths or raw secrets. Replaying the same gateway + request returns the same claim and payload. `resolveWorkingDirectory` never runs on a virtual claim
- **Observed state**: `POST …/requests/:id/progress` appends a bounded, monotonic preparation observation and does **not** change status; `POST …/requests/:id/launched` validates request/claim/target/digest, records a `VirtualTargetLaunchObservationV1`, then makes the normal `launching → launched` transition exactly once; `POST …/requests/:id/failed` records a typed, redacted `VirtualTargetFailureV1` and makes the allowed transition to `failed` (its `retryable` flag informs existing retry policy but does not itself requeue). All three are idempotent by request and observation `sequence`
- **Grants**: `POST …/grants/:id/exchange` swaps an authenticated, unexpired opaque grant for narrowly scoped credentials or attachment-download access, bound to request + target + gateway instance; every exchange is audited and never returns the user's Overlord token
- **Mission resources / actions**: `GET …/missions/:id/resources` returns summarized opaque lifecycle resources and source-compatibility observations; `POST …/missions/:id/actions` authorizes an explicit `start`/`stop`/`archive`/`delete`/`enqueue`/`retry`/`dequeue` action and delegates it to the target. Delegated-action output becomes an observation and can **never** change mission completion — only an agent protocol delivery completes an objective
- **Boundary rule**: Desired launch state (Overlord's immutable snapshot) and observed realization state (gateway reports) are kept separate. Paths and raw credentials never cross this boundary. The gateway owns source/environment realization and observed-state reporting; Overlord owns durable queue delivery, leases/retries, and status transitions

### REST API → Database (HTTP Surface)

- **Transport**: Service layer function calls; same service layer as CLI and Protocol
- **Auth**: Token or session auth via Auth Layer before service call
- **Response shape**: Derived from logical schema camelCase field names
- **Idempotency**: REST-scope idempotency keys for retried writes
- **One implementation**: Domain logic that Protocol also needs lives once in
  `packages/core/service`. A REST handler authorizes the resource, builds a
  service context for the resource's workspace (with the authorized
  `workspaceUserId` as actor, inside the handler's transaction when it has
  one), calls the service, and maps the result onto its DTO. It must not carry
  a second copy of service SQL or rules. Mission schedule preview, read,
  upsert, and clear, the scheduled-duplicate mission number, profile metadata
  reads/merges, default status seeding, and top-of-column board position each
  have one implementation in `packages/core/service`; REST keeps its RBAC check
  and DTO mapping only.
- **Delivery reads**: `getMissionsByIdDeliveries` authorizes against the named mission's
  owning workspace with `mission:read`. Items are newest first and capped at 200; `total` counts
  matching rows before the cap. It synthesizes the deterministic V1 report for legacy payloads;
  neither `deliveries.payload_json` nor `mission_events.payload_json` is exposed verbatim.
- **File-change reads**: `getMissionsByIdFileChanges` authorizes against the named mission and
  pages newest first, capped at 200, with the pre-cap `total`. A truncated mission-wide page is
  incomplete evidence; clients must never partition it by objective. Per-objective views use the
  validated objective-scoped read (the `objectiveId` query parameter, Protocol
  `objective-changes`, MCP `overlord_changes`), which filters in SQL before the count and the
  200-row cap and carries persisted capture diagnostics; a blank or repeated `objectiveId` is
  refused with 400. `observedAt` is the last observation. `source` is `declared_edit` (at least
  one successful native observation), `agent_declared` (declaration only), or null (historical
  provenance unknown: shown as Unknown, never relabelled native). Clients derive the basename.
- **Account-owned inbox**: Inbox CRUD resolves the authenticated `profiles.id` rather than an ambient workspace. Reads and mutations are scoped to that profile; promotion derives authorization and tenancy solely from its destination project. Inbox CRUD writes do not append workspace `entity_changes`, because those records have no workspace; promotion appends the ordinary mission change in the destination workspace.
- **Workspace resolution taxonomy**: Entity-addressed reads and writes derive a workspace from their operand and require it in the immutable request `authorizedWorkspaces` set. Single-workspace UI reads require an explicit `workspaceId` and return `400` when omitted. Aggregate parentless reads fan out only across the selected organization's authorized set; when a session holder belongs to multiple organizations, selection is explicit. Parentless writes use `resolveParentlessWorkspace` only for `create-project` and `register-target`; mission writes derive tenancy from their named project and inbox operations are profile-owned. No route may select the oldest membership.
- **Authorized workspace shape**: Auth resolves once per request `{ organizationId, workspaces: [{ workspaceId, workspaceUserId, roleKeys }] }`, where workspaces are active live memberships intersected with token consent (when present). Services may retain one operation-local `resolvedWorkspaceId`, but must not reinterpret the set from request headers or persistence.
- **Mission search versioning**: `getMissionsSearch` is frozen as its v1 response.
  `getMissionsSearchV2` ranks portably across adapters: display-id short-circuit,
  meaningful-term coverage floor `min(3, max(1, ceil(termCount / 2)))`, `max(documentScore)` plus
  bounded corroboration, and recency as rank fusion rather than an eligibility gate; exact
  display-id and exact-title matches take precedence. Empty or stop-word-only queries use an
  explicit `fallback` mode. Complete and cancelled missions stay eligible by default. The REST
  route accepts only stable `projectIds` and applies no implicit date window; the Protocol, CLI
  and MCP v2 surfaces additionally resolve a human project reference and answer an ambiguous one
  with `project_selection_required`. A `dueDatetime` range excludes missions with no due date.
  Fan-out is one organization only, with `floor(limit / workspaceCount)` per workspace and
  UUID-ordered remainder slots; unused quota is not redistributed. The quota and `limit` allocate
  mission groups, never individual indexed documents. V1 and v2 search only the mission,
  objective and event index corpus even after delivery indexing ships. `getSearchV3` returns
  mission-anchored groups; `event` is corroboration-only and never appears in `matches`, which is
  the single, matched-only source for child identity. Child relevance is
  `docScore + 0.15 * missionScore`; the coverage floor stays at the group's concatenated
  haystack. Per-workspace candidate fetch is bounded at 500 documents; above that cap, counts are
  lower bounds. `matchesPerResult` is not divided across workspaces. The mission row always
  anchors the group, including when `anchorOnly` is true. An objective display-id query returns
  that objective as the group's single match. REST v3 accepts only stable `projectIds`. Protocol
  `search-missions --response-version 3` returns the same envelope with v3 defaults. Artifacts
  are not indexed. Ranked search (any version) remains candidate discovery and never proves
  absence.
- **Exact reference lookup**: Protocol `search --reference` is a separate exhaustive exact-token
  lookup in one project with continuation: `search --reference <token> --project-id <ref>
  [--workspace-id] [--limit 1-100, default 50] [--cursor]` returns
  `MissionReferenceSearchResponse` (`packages/contract/src/mission-reference.ts`):
  `{ kind: 'mission_reference_search', version: 1, reference, projectId, workspaceId, results,
  nextCursor, complete }`. It is exhaustive, not ranked: every live mission in the one readable
  project whose live objective instruction text contains the token case-sensitively as a whole
  token (not adjacent to a letter, digit or underscore), in mission-id order, each with
  `statusType`, `statusId` and its matching objectives (`id`, `displayId`, `title`, `state`,
  `position`). Pages are over candidate missions, so a page may hold fewer than `limit` results;
  `complete` is true only on the last page and the cursor is bound to its reference and project.
  Tokens are 8–512 characters without whitespace; `%` and `_` are literal. Ranked filters
  (`--query`, `--status`, `--resource-key`, date flags, `--response-version`, v3 flags) are
  refused with it, and `--cursor` without `--reference` is refused. Authorization matches v2/v3
  search: the project resolves across the caller's organization memberships, `mission:read` is
  checked on that project, and a project_automation token must have selected it. Hosted MCP
  `overlord_search_missions` and the local shim add `reference` and `cursor` and forward this
  mode unchanged (never compacted).

### Mobile → REST (Objective Transcript Surface)

- **Transport**: authenticated HTTPS/JSON; `GET /api/objective-transcript`.
- **Contract**: `ObjectiveTranscriptPageDto` (`packages/contract/src/index.ts`);
  1–100 full-text objective rows with before/after keyset paging or bounded ID
  revalidation across readable active-organization workspaces. Private Inbox
  captures remain on their independent owner-only API.
- **Selection**: authenticated `GET /api/objective-transcript` returns
  `ObjectiveTranscriptPageDto` across the caller's active-organization
  memberships with both `mission:read` and `objective:read`, restricted by token
  project scope before selection. Live objectives of live missions in live,
  active projects qualify, including old completed missions. Private profile
  Inbox captures are never included. Responses are `Cache-Control: no-store`.
- **Paging**: `limit` defaults to 50, accepts 1–100. History is newest first by
  immutable `(created_at, id)`; opaque versioned `before` cursors select strictly
  older rows. `after` selects strictly newer rows, oldest first, with `nextAfter`
  for draining new creates without skipping an intervening page. `nextBefore` is
  present only when another older page exists; `newestCursor` is the newest
  returned key (null for an empty page). For `after`, `nextAfter` always carries
  the last returned position, or the input cursor when empty; `hasMore` tells
  whether to immediately continue draining. Cursors are positions, never
  authorization grants or snapshots. `before`, `after` and `ids` are mutually
  exclusive. Invalid inputs return 400: unknown, duplicate/array-valued,
  malformed and oversized query values. `ids` is a comma-separated set of 1–100
  objective UUIDs, at most 3,699 characters and without `limit`: revalidate just
  those rows, no pagination; omitted IDs mean absent or no longer authorized and
  must be removed locally, without disclosing why. Cursors are opaque, canonical
  base64url of a versioned position, at most 256 characters; clients store them
  verbatim and must not synthesize them. No count query or per-objective
  hydration is performed. Full instruction text is retained; the bound is rows,
  not bytes, and a single instruction can still be large.
- **Items and refresh**: Every item includes objective identity/revision,
  creation provenance, assignment, instruction/title/state/resource key, and
  current mission/project presentation metadata. Consumers deduplicate by
  objective ID and sort chronologically for display. Use `after` for creates and
  bounded `ids` revalidation for loaded rows after notices/reconnect, including
  late edits, deletions, mission/project moves and authorization changes. A
  permission expansion needs a fresh history walk; an
  access/account/organization change discards prior cursors and cached rows. The
  existing sequence-based `/sync/changes`/realtime feed remains authoritative for
  changed IDs, including same-timestamp or backdated creates which may precede an
  `after` position. Buffer/replay it around initial loading and revalidate its
  named IDs; a transcript cursor alone is not a change-log cursor. The existing
  owner-only `/api/inbox` stays separate: re-read its authoritative capture set
  after local mutations/reconnect; promotion removes its capture ID and
  introduces the created objective ID. Reconcile optimistic mission creates
  against returned objective IDs, never text.
- **Compatibility**: Use the supported backend contract/capability to select
  compatibility behavior; do not fall back to all-project objective fan-out on
  ordinary HTTP, decoding, authentication or cancellation errors. If pre-162
  servers remain supported, keep an explicitly selected and tested legacy path
  limited to that declared version.
- **Consumer**: Mobile may adopt this additive surface; current consumers of
  project mission lists are unchanged. The project-automation route allowlist
  remains closed to this new route.

### Mobile → REST (Live Activity Push Surface)

- **Transport**: Authenticated HTTPS/JSON with the existing Better Auth session or `out_…` bearer token; no ambient workspace input is accepted.
- **Registration**: `PUT /api/mobile/live-activities/:activityId/push-token` accepts `{ pushToken, environment, bundleId, startedByPush? }`, upserts the caller's private `(profile, activityId)` registration, and replaces a rotated token. `environment` is `sandbox` or `production` and selects the APNs host per registration; `bundleId` forms the `…push-type.liveactivity` topic. `activityId` and `pushToken` are opaque values and are never returned or exposed through realtime, logs, or read APIs.
- **Revocation**: `DELETE /api/mobile/live-activities/:activityId/push-token` deletes only the caller's registration and returns `204`; it is safe to retry after a local activity has already ended.
- **Delivery**: Server lifecycle mutations enqueue coalesced `overlord.live_activity.dispatch.v1` jobs. The dispatcher recomputes the caller's two-running-objectives-plus-one-recent-completion snapshot and delivers APNs `liveactivity` update/end events on each registration's own `<bundleId>.push-type.liveactivity` topic and environment host (not the process-wide `OVERLORD_APNS_ENV` default). Running rows are **objective-grain**: `title` and `displayId` name the executing objective (`coo:756.k7xm`), `id` stays the parent mission id so ActivityKit attributes need not change, and additive `objectiveId` / `missionDisplayId` / `missionTitle` carry the mission as secondary context. Completing one objective does not end the activity while another objective for the same account is still executing. `content-state.updatedAt` is Unix epoch seconds (JSON number), never an ISO-8601 string — ActivityKit's push decoder cannot parse ISO timestamps into `Date`. `content-state.pendingAsk` is the newest unanswered, unseen (`mission_status_seen.blocking_question`) ask, at most three days old, on a still-executing (`executing` or `pending_delivery`) objective of the account's assigned missions, or `null`, matching the activity feed's `blocking_question` rule. It is `{ missionId, missionDisplayId, question, askedAt, agentRequestId }`: `askedAt` is Unix epoch seconds like `updatedAt`, `agentRequestId` is present when the ask opened an `agent_requests` row, and `pendingAsk` is visible content that participates in the content hash; asking, answering, and marking the question seen are transitions. State transitions are sent promptly; progress that leaves visible content unchanged is suppressed for at least five minutes. Invalid APNs tokens are retired.
- **Push-to-start registration**: `PUT /api/mobile/live-activities/start-token` accepts `{ startToken, environment, bundleId, activityType?, appVersion? }` and upserts the caller's private push-to-start registration, rotating an existing token in place. `environment` is `sandbox` or `production` and selects the APNs host per registration; `activityType` defaults to the account-level mission activity attributes type. A start token is globally unique and bound to exactly one profile, so registering a token held by another profile reassigns it. Like a device token it is opaque, travels in the request body rather than the URL, and is never returned or exposed through realtime, logs, entity changes, or read APIs.
- **Push-to-start consent and revocation**: Holding a `live_activity_start_tokens` row **is** the account's consent to desktop-initiated Live Activities; with no row the server can never remotely start one. `POST /api/mobile/live-activities/start-token/revoke` accepts `{ startToken }`, deletes only the caller's registration, returns `204`, is safe to retry, and is how that consent is withdrawn. Clients must revoke before clearing credentials on sign-out.
- **Push-to-start delivery**: A mission entering execution enqueues a coalesced `overlord.live_activity.start.v1` job for the mission's assigned profile only — never broadcast to a workspace — alongside the ordinary refresh job. The payload carries only the target profile and triggering mission ids; the worker recomputes the bounded snapshot at delivery time and sends an APNs `liveactivity` payload with `event: "start"`, `attributes-type`, `attributes`, `content-state`, a stale date, and a bounded alert, at `apns-priority: 10` on the registration's own `<bundleId>.push-type.liveactivity` topic and environment host. A start is suppressed when the account already holds any `live_activity_push_tokens` registration, when no mission is running, and for five minutes after a start was sent to that token. Delivery is durable and retried with backoff; `410 Unregistered` and `400 BadDeviceToken` retire the start registration. With no APNs credentials configured, enqueueing still succeeds and dispatch no-ops.
- **Update-token handoff**: after APNs remotely starts an activity, the client registers the per-activity **update** token through `PUT /api/mobile/live-activities/:activityId/push-token` with the additive optional `startedByPush: true`, recorded as `live_activity_push_tokens.origin = 'push_to_start'` (default `local`). From that point the ordinary dispatch job owns every update and the end for that activity. A push-to-start token, a per-activity update token, and a standard device token are three distinct credentials with distinct lifetimes and are never interchangeable: separate tables, routes, and payload events. Local starts from the app remain supported and unchanged.
- **Privacy**: APNs payloads include only the bounded display snapshot, the epoch-seconds `updatedAt` timestamp, and — for a start — the static account label attribute and an alert built from that same bounded snapshot. The snapshot may include one pending ask's question as a markdown-stripped single line capped at 140 characters. They never include bearer tokens, ActivityKit tokens, objective instructions, agent prompts, answer options, event payloads, or full mission detail.

### Mobile → REST (Standard Push Notification Surface)

- **Transport**: Authenticated HTTPS/JSON with the existing Better Auth session or `out_…` bearer token; no ambient workspace input is accepted.
- **Separation from Live Activities**: standard APNs **device** tokens and ActivityKit tokens are distinct credentials with distinct lifetimes and are never interchangeable. They use separate tables (`device_push_tokens` vs `live_activity_push_tokens`), separate routes, separate APNs topics (`<bundleId>` vs `<bundleId>.push-type.liveactivity`), and separate `apns-push-type` values (`alert`/`background` vs `liveactivity`). Passing one where the other is expected is a contract violation.
- **Registration**: `PUT /api/mobile/push/device-token` accepts `{ deviceToken, environment, bundleId, appVersion? }` and upserts the caller's registration, rotating an existing token in place. `environment` is `sandbox` or `production` and selects the APNs host per registration. A device token is unique globally and bound to exactly one profile; registering a token held by another profile reassigns it. Tokens are opaque, are carried in the request body rather than the URL, and are never returned or exposed through realtime, logs, entity changes, or read APIs.
- **Revocation**: `POST /api/mobile/push/device-token/revoke` accepts `{ deviceToken }`, deletes only the caller's registration, returns `204`, and is safe to retry. Clients must revoke before clearing credentials on sign-out.
- **Preferences**: `GET`/`PUT /api/profile/notification-preferences` read and merge the caller's own preferences as `{ enabled, preferences: { type, transport, mode }[] }`. `type` is exactly a shared notification-catalog id (the mission catalog or `chat_needs_answer`/`chat_finished`), `transport` is exactly a catalog-declared eligible transport, and `mode` is `alert`, `silent`, or `off`; absent rows default to the catalog's `defaultMode`. The reserved `(type: all, transport: all)` master row powers `enabled` and suppresses notification transports without affecting Live Activity delivery. Unknown types, transports, type/transport pairs, and modes are rejected `400`. For additive mobile compatibility, responses also project APNs-capable types as `{ categories: { category, mode }[] }`, and requests may use that legacy field as an APNs-only update alias; new clients use `preferences`.
- **Delivery**: The same lifecycle mutations that refresh Live Activities enqueue deduplicated `overlord.push_notification.dispatch.v1` worker jobs addressed to the mission's assigned profile only — never broadcast to a workspace. Job payloads carry ids alone; the dispatcher recomputes presentation content at delivery time. Alerts are `apns-push-type: alert`, `apns-priority: 10`, expiring after one hour; `silent` categories are `apns-push-type: background`, `apns-priority: 5`, `content-available: 1`, with no alert body. Notifications collapse per `(objectiveId ?? missionId, category)`. Delivery is durable and retried with backoff; `410 Unregistered` and `400 BadDeviceToken` retire the registration. With no APNs credentials configured, enqueueing still succeeds and dispatch no-ops so local development is unaffected.
- **Privacy**: Payloads contain only the bounded project name, the sanitized bounded title and display id of the objective when the row has an `objective_id` (otherwise the mission), a badge count, the mission id, optional objective id/display id, the category, and a deep link (`overlord://objectives/<displayId>` when an objective is known, else `overlord://missions/<missionId>`). They never contain bearer tokens, session keys, ActivityKit tokens, objective instructions, agent prompts, delivery summaries, change rationales, file paths, diffs, question text, or any `mission_events.payload_json` content. User-authored text reaches a payload only through the shared markdown-stripping bounded-title sanitizer.

### Client → REST (Private Conversation Surface)

- **Transport**: Authenticated HTTPS/JSON plus one owner-scoped SSE stream per thread (`GET /api/chat/threads/:id/events?after=<seq>`); web, desktop (shared SPA), and mobile clients use the same routes. Cloud only.
- **Ordering and recovery**: events are persisted before they are sent and replayed from storage; clients resume after their last applied `seq`, deduplicate by `seq`, and reload the atomic snapshot on `snapshot_required`. A closed stream never implies completion; the snapshot route doubles as the polling fallback.
- **Presence and acknowledgement**: a client renews foreground presence while a thread is visible and releases it when backgrounding or leaving; it acknowledges a `seq` only after rendering that event. Acknowledgement suppresses a pending conversation notification; transport receipt and an open connection never do.
- **Writes**: message submission, answers, cancel, continue, and Create carry stable client request ids reused across retries; revision-checked actions carry `expectedRevision`. Create is the only path from a conversation to missions and objectives.
- **Privacy**: no provider checkpoint, raw tool result, credential, or OAuth material is ever returned; content whose sources are no longer authorized is returned as `unavailable` blocks.

### Assistant Conversation Behaviour

The behavioural contract for the private assistant conversation surface above, the
`/api/chat/*` and account-connection routes, and the "Assistant Conversations" tables in
[data/README.md](data/README.md). DTOs live in `packages/contract/src/chat.ts`.

**Scope and privacy.** A chat thread is private to one owner profile inside one
organization; it may reference any workspace of that organization the owner can
currently access. Every `/api/chat/*` route resolves the caller's profile and active
organization and returns 404 `not_found` for another owner's or organization's
thread, run, question, proposal, notification, or connection, without revealing
existence. Chat is Cloud-only: a Local backend answers every `/api/chat/*` route and
every organization-scoped `/api/connections` route with 404 `chat_unavailable`, and
clients show chat as unavailable; the profile-scoped account-connection routes are
served on both editions (REST API Layer). The tables exist and are tested on both
editions. A `project_automation` token reaches none of these routes.

**REST.** `POST /api/chat/threads` (optional first message), `GET /api/chat/threads`
(owner-only, newest activity first, archived excluded unless `archived=1`, cursor
paging), `GET /api/chat/threads/:id` (atomic snapshot), `PATCH /api/chat/threads/:id`
(`expectedRevision` plus `title` and/or `archived`), `POST /api/chat/threads/:id/messages`,
`GET /api/chat/threads/:id/events?after=<seq>` (SSE replay then live; `?poll=1` returns one
bounded `ChatEventPageDto` for polling), `PUT /api/chat/threads/:id/presence`,
`POST /api/chat/threads/:id/ack`, `POST /api/chat/runs/:id/cancel`,
`POST /api/chat/runs/:id/continue`, `POST /api/chat/questions/:id/answer`,
`POST /api/chat/proposals/:id/create`, `GET /api/chat/providers`,
`GET /api/chat/notifications`, `POST /api/chat/notifications/:id/read`, the
account-connection routes below, and `POST /api/projects/:id/repository-reads`. Error
bodies are `{ error, code }` with the closed `ChatErrorCode` set.

**Submission and runs.** A message submission writes the user message and its run in
one transaction and returns their ids; `(thread, clientRequestId)` is unique, so a
repeated request returns the original message and run with `replayed: true`. Run
states are closed: `queued`, `running`, `waiting_user`, `completed`, `failed`,
`cancelled`; a thread has at most one unfinished (`queued`/`running`/`waiting_user`)
run, enforced by a partial unique index. While a run is `queued` or `running` a new
message returns 409 `run_in_progress`. While it is `waiting_user` any message is the
answer to its single open question and resumes the same run; tapping an option and
typing text are the same action. `POST /api/chat/questions/:id/answer` is the
card form of the same action and requires `expectedRevision` (409 `stale_revision`
once answered, superseded, or cancelled). A `completed` run carries outcome `answered`
or `allowance_exhausted`; a `failed` run carries one closed failure code
(`provider_unavailable`, `rate_limited`, `context_limit`, `unsupported_capability`,
`interrupted`, `provider_error`, `source_access_lost`). Tool failures are recorded per
tool call and never fail a run by themselves.

**Leases and fences.** Backend workers claim a run by inserting a `chat_run_attempts`
row whose `fence` equals the run's freshly incremented `current_fence`; at most one
attempt per run is `leased`, with a renewable lease (default 30 s). Every event, tool
call, and checkpoint write carries the attempt's fence, and both editions reject a
write whose fence is not the run's current fence (SQLite triggers and Postgres
trigger functions with identical semantics), so a worker that lost its lease cannot
publish, invoke, or checkpoint. `waiting_user` releases the lease. Cancellation sets
`cancel_requested_at`, is authoritative at the tool gateway, is idempotent, and ends
the run `cancelled`; a cancelled tool call is the one fence-free transition.

**Checkpoints and recovery.** `chat_provider_checkpoints` holds one private,
versioned provider checkpoint per run (Gemini response parts verbatim with thought
signatures, call ids, and call order; schema version, model, and config digest). It is
never an ordinary DTO, realtime payload, change row, or global log field; the
owner-only diagnostics endpoint exposes exchange observations. A provider tool
request is checkpointed before its tool executes, and its results are recorded and joined in
call order before the next provider request; Overlord, not the provider, enforces
completeness, order, and call-id matching. A checkpoint is reused only when version,
model, and digest match and its dependencies reauthorize; otherwise the attempt
records `recovery_mode = fresh_generation`, rebuilds from authorized messages and
recorded observations, and marks partial text `interrupted`. A read whose receipt is
still `requested` is re-executed under its original `operation_id` (unique); writes
are out of scope. A completed exchange needs no checkpoint and the row is deleted.

**Snapshot and cursor handoff.** `GET /api/chat/threads/:id` reads the thread, the
latest message page, the active and latest runs, the open question, open proposals,
`referencedProposals` (every created or cancelled proposal named by a proposal block in
the returned page, so receipts render after a reload), `eventCursor` (`chat_threads.last_event_seq`), and `retainedFromSeq` in one database
transaction, so `events?after=eventCursor` neither misses nor double-applies an
event. Event sequences are allocated by advancing `last_event_seq` and inserting
exactly that value in the same transaction (storage is gap-free, `(thread, seq)` is
unique, and events are append-only). Events are persisted before they are sent;
replay always comes from storage and live delivery follows replay on one ordered
stream. Text deltas are coalesced. Retention is bounded (defaults: 7 days or 5,000
events per thread, whichever comes first) by deleting rows below
`chat_threads.retained_from_seq`; `after < retainedFromSeq - 1` yields 409
`snapshot_required` (or a `snapshot_required` frame on an open stream) and the
client reloads the snapshot. Messages, runs, questions, proposals, and receipts are
not subject to event retention. A closed stream never implies completion.

**Private event channel (exception).** Chat events are owner-scoped and do not
derive from `entity_changes`; they are private to one person and too frequent for the
change log. This is the sole exception to the REST/backend rule that realtime events
derive from `entity_changes`, and it is recorded in `backend/AGENTS.md`. Chat writes
emit no `entity_changes`, webhooks, or search documents; missions created from chat
emit their normal change, webhook, and search rows.

**Source dependencies and invalidation.** Every source an answer, summary, proposal
revision, checkpoint, question, tool call, or content-bearing event used is a
`chat_source_refs` row (kind `knowledgebase` \| `overlord` \| `repository`, stable
`scope_key`, last access check). Each derived row points at an immutable
`chat_dependency_sets` row whose members are the conservative union of every source
supplied to that generation, including those inherited from earlier summaries and
messages. Snapshots, replay, live publication, provider input, checkpoint reuse, and
Create recheck the dependency set; anything not currently `authorized` fails closed.
Revocation increments `chat_threads.authorization_revision`, marks affected sets,
messages, summaries, checkpoints, and proposal revisions invalidated, replaces whole
affected blocks with an `unavailable` block, emits `content.invalidated`, and fences a
live attempt using that context (restart from remaining authorized content or fail
`source_access_lost`). Raw stored events never bypass this projection: replay of an
event whose dependency set is invalidated sends `content.invalidated` instead.

**Proposals, frozen assignments, and Create.** A proposal is versioned:
`chat_work_proposal_revisions` rows are frozen once written (spec, responsible profile,
revision number cannot change), each naming explicit project ids, titles, ordered
objectives, resource keys, acceptance criteria, evidence, dependencies, and a concrete
agent/model/reasoning selection with its source. Omitted or null agents never reach
Create; a revision without a justified selection is not creatable.
`POST /api/chat/proposals/:id/create` with `{ clientRequestId, expectedRevision }` is
the only creation path; no tool can create, change, or launch work. It rechecks
membership, `mission:create` on every destination project, source dependencies and
the thread `authorization_revision`, the expected revision, and the frozen
assignments, then in one transaction calls the existing mission-creation service once
per mission with that mission's workspace context, verifies the saved assignments,
stamps `created_by_kind = agent`, `created_by_agent = overlord-assistant`, the acting
user as responsible person, and `missions.created_from_chat_thread_id` (soft reference,
no foreign key), forces draft-only/no-queue, and writes one `chat_work_receipts` row
(unique per proposal and per `(owner, clientRequestId)`) with its
`chat_work_receipt_missions`. Any failure creates nothing. Duplicate, concurrent, or
crash-after-commit calls return the identical receipt (`replayed: true`). A stale
revision returns 409 `stale_revision`; an invalidated or non-open revision returns 409
`proposal_not_creatable`. **Cancel/Create outcome:** cancelling a run never cancels or
blocks Create of a revision that was already published (`proposal.revised` committed);
a revision still being prepared by the cancelled attempt is never published. Create of
a published revision therefore succeeds or fails on its own checks regardless of a
concurrent Cancel, and a later Cancel never removes created drafts.

_Proposal preparation (coo:1108.k0tc)._ The internal `prepare_proposal` tool
publishes or revises a card and cannot create domain work. Preparation validates
registered resource keys and the destination workspace agent catalog, resolves the
acting member's project launch preference, and freezes model/reasoning values.
Missing or invalid preferences require `ask_user` or an explicit supported selection;
Create never reapplies defaults. Shared mission creation accepts explicit reasoning
effort and preserves it alongside agent/model. Create selects a concrete draft
status even if the project default is Next, serializes owner receipt keys and
workspace mission sequences, and commits domain rows, receipt and private event in
one outer transaction. A request key already used by another proposal returns
`invalid_request`; an existing receipt for the same proposal returns its original
IDs.

_Web and desktop client (coo:1108.r2b0)._ The shared SPA consumes these routes only.
It creates a thread empty and then submits the first message, so every content-bearing
write is idempotent; each action's `clientRequestId` is minted once and reused by every
retry (Create ids persist across reloads, scoped to backend, profile, and organization),
so a lost Create response is recovered as the original receipt. It renders a proposal
block whose revision is older than the proposal's current revision as superseded, and
never offers Create for an invalidated, superseded, or non-open revision. Presence is
held only while the tab is visible and focused (`platform` `web` or `desktop`, one
client id per page load), and acknowledgements are sent only for events already
committed to the rendered transcript. The Knowledgebase callback's web return path
`/settings/connections` is the Connected accounts page; a sign-in started from Chat
returns to Chat.

**Continue.** When the latest run of a thread completed with
`allowance_exhausted`, `POST /api/chat/runs/:id/continue` creates one new run with
`continued_from_run_id` set and a fresh allowance, reusing recorded evidence and
summaries; a run can be continued at most once (unique index), so a repeated request
returns the same run. Any other run returns 409 `continue_not_available`. Defaults
(configurable, see _Operator limits_ below): 60 tool calls and ten minutes of
active processing per run, excluding `waiting_user`; three concurrent runs per owner;
four concurrent target reads per run.

**Conversation notifications.** Two catalog types join `notification_preferences.type`:
`chat_needs_answer` (a run entered `waiting_user`) and `chat_finished` (a run completed
or failed). They are addressed by owner profile, organization, thread, run, and
question, never by a fabricated mission or an arbitrary workspace, and they never appear
in the mission-only `GET /api/notifications` list, whose `NotificationDto` is
unchanged. Each qualifying transition writes one `chat_notifications` row in the same
transaction as the transition: it is the durable candidate, its dispatch job state
(`pending` → `dispatching` → `dispatched`/`failed`, or `suppressed`/`cancelled`), and
once dispatched its history entry. The row is unique on `(owner, thread, run, type,
transition_key)` where the key is `question:<ordinal>` or `terminal:<state>`, so a new
question never collapses into an earlier one and dispatcher retries cannot duplicate.
`due_at` is the transition time plus a grace period (default 5 s). **Presence and
acknowledgement:** `PUT /api/chat/threads/:id/presence` renews (default 30 s TTL) or
releases one client's foreground presence; `POST /api/chat/threads/:id/ack` records
that a foreground client rendered events through `seq` (monotonic per client,
idempotent, separate from any replay cursor). A pending candidate is suppressed only
when a client that is foreground on that thread at acknowledgement time acknowledges a
`seq` at or after the candidate's `event_seq`; a connection or open socket alone never
suppresses. Otherwise it dispatches after `due_at`, including when a dead connection
still appears open. Before dispatch the dispatcher rechecks ownership, organization
access, preferences (including the master switch), and for `chat_needs_answer` that
the question is still open; a failed recheck cancels the candidate. Dispatch reuses
device registrations and APNs transport; the payload carries only the type, the
bounded sanitized thread title (≤ 80 characters), thread/run ids, an unread badge
count, and the deep link `overlord://chat/threads/:threadId`, never question,
answer, transcript, Knowledgebase, or repository content. `GET /api/chat/notifications`
returns the newest 100 dispatched, non-dismissed entries for the caller in the caller's
organization plus `unreadCount`; `POST /api/chat/notifications/:id/read` is
revision-checked (`stale_revision` on mismatch; repeating it at the current revision is a
no-op). Delivery acknowledgement never changes mission notification read semantics.
Acknowledgement details: a `seq` beyond the thread's last published event is
`invalid_request`; a lower `seq` keeps the stored value; an acknowledgement from a client
without live presence is recorded but suppresses nothing; `ChatAckDto` lists the ids it
suppressed. Presence and acknowledgement recheck live membership but run no upstream
source checks, since they publish no content. Dispatch details: the conversation types
join `GET`/`PUT /api/profile/notification-preferences` `preferences[]` on `apns`,
`realtime`, and `in_app` (the legacy `categories` alias stays mission-only); with the
master switch off, or both `apns` and `in_app` off, the candidate is `cancelled`; with
`apns` off but `in_app` on it is `dispatched` to history without a push; `silent` sends
a background push with no alert. Delivery is at-least-once: a claim holds a 60-second
lease, the APNs collapse id is `chat:<notificationId>` so a retried send replaces
rather than duplicates, a transient failure returns the row to `pending` with backoff,
and after `max_attempts` (5) it becomes `failed`. The home-screen badge on both mission
and conversation pushes is unread mission notifications plus unread dispatched
conversation notifications for the profile. The grace period and presence TTL are
operator-configurable through `CHAT_NOTIFICATION_GRACE_MS` and `CHAT_PRESENCE_TTL_MS`.

**Account connections.** `account_connections` is the single store for external
account connections, recording server, authorized provider workspaces, tool-policy
version, state (`pending`, `connected`, `reauthorization_required`, `disconnected`),
and an AES-256-GCM credential envelope bound to the owner with a key id from server
configuration. Refresh is serialized per connection by a lease
(`refresh_lock_owner`/`refresh_lock_until`) and the rotated credential is persisted
before use. For the organization-scoped `knowledgebase` provider, one live connection
exists per `(owner, organization, provider, server_url)`, profile-owned within the
organization; `GET /api/connections`, `POST /api/connections` (`{ provider, returnTo }` →
`{ connectionId, authorizeUrl, expiresAt }`), `DELETE /api/connections/:id`
(disconnect: revoke upstream best-effort, erase the envelope), and the public
`GET /api/connections/knowledgebase/callback` implement authorization code with PKCE
S256 and the RFC 8707 `resource` parameter; `account_connection_authorizations`
stores a hashed single-use `state` and an encrypted PKCE verifier bound to the
connection and an expiry. The client id is a Client ID Metadata Document served at
public `GET /oauth/clients/knowledgebase.json` (≤ 5 KB, no redirects, redirect URI is
the backend callback). The phone opens `authorizeUrl` in `ASWebAuthenticationSession`;
the callback redirects to a universal link (or the web return URL) carrying only a
status. Credentials, verifiers, codes, and state never appear in DTOs, logs, realtime,
change rows, or errors; the only client-visible URL carrying `state` is `authorizeUrl`
itself, where OAuth requires it (stored only as a hash, single use, 10-minute expiry).

_Knowledgebase client integration (web and mobile, coo:1108.zb9x)._ `POST /api/connections` reuses
the caller's live connection for reauthorization (same `connectionId`) and allows at
most five open sign-ins per connection (`limit_exceeded`). It answers 503
`provider_not_ready` when the Knowledgebase or credential key is not configured, 400
`invalid_request` for another provider or `returnTo`, and 404 `chat_unavailable` on
Local. The callback finishes with a redirect carrying only `provider=knowledgebase`
and `status` (`connected`, `denied`, `expired`, or `failed`): mobile goes to
`overlord://connections/callback?…` (the `ASWebAuthenticationSession` callback
scheme), web goes to `<OVERLORD_WEBAPP_PUBLIC_URL origin>/settings/connections?…`, and
an unknown or replayed state gets a no-store status page. Clients treat the status as
a hint and reload `GET /api/connections`, which lists live (non-disconnected)
connections. `pending` means sign-in never completed. `reauthorization_required`
carries `lastErrorCode` (`invalid_grant`, `upstream_unauthorized`, `grant_expired`, or
`credential_unreadable`) and its credential is already erased; clients offer sign-in
again with `POST /api/connections`. `DELETE /api/connections/:id` returns the
`disconnected` DTO. Losing access by disconnect or reauthorization immediately
rechecks every thread that cited the connection, so that content is replaced by
`unavailable` blocks and live generations are fenced with `source_access_lost`.
Reconnecting never restores invalidated content. Server configuration:
`KNOWLEDGEBASE_MCP_URL`, `KNOWLEDGEBASE_EGRESS_ORIGINS`,
`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID`; every one
of these is optional: the standard server is the default and the platform key derived
from `BETTER_AUTH_SECRET` seals credentials when no explicit key is set.

**Repository reads.** Agent-facing repository reads (`observe`, `tree`, `branches`,
`worktrees`, `git_status`, `diff`, `read_file`, `search_text`; `RepositoryReadRequest` /
`RepositoryReadResult`) are local-target capabilities executed by the runner over the
existing mission-less capability-call queue with `operation_id` as the idempotency key.
`POST /api/projects/:id/repository-reads` is the authenticated mission-less route
(requires `project:read` and the caller's access to the named execution target) and
the in-process chat gateway calls the same service. Inputs are `executionTargetId`,
`projectId`, `resourceKey`, and repository-relative paths only; the capability call
carries the requested `resourceKey` to the claim, which resolves that resource instead
of the primary one. The target enforces containment including symlinks, excludes
credential and configured sensitive paths, disables external diff/textconv and hooks,
and never fetches, checks out, builds, or takes write intent. Defaults: 64 KiB file
reads, 128 KiB diff and search output, 100 search hits, 30 s timeout. The current diff
is one implementation co-located with `readCurrentDiff`.

_Repository-read implementation details (coo:1108.zg8m)._

- _Local-target interface._ `readCurrentDiff` takes the resource-addressed form
  `{ resourceId, repoPath, scope, relativePaths?, maxBytes? }`. Three capabilities
  accompany it: `readGitStatus`, `readRepositoryFile`, and `searchRepositoryText`. All four
  are read capabilities on the runner queue (30 s deadline) and are not exposed through
  the desktop bridge. The commit-message diff (`generateCommitMessageFromLocalDiff`)
  builds its `git diff` from the same argument builder and hardened Git configuration,
  so there is one diff definition.
- _Target-side hardening._ Every inspection Git call runs without a shell, with
  `GIT_OPTIONAL_LOCKS=0` (no index refresh write), `core.fsmonitor=false`,
  `core.hooksPath` pointed at the null device, `diff.external` empty plus
  `--no-ext-diff --no-textconv`, every configured `filter.<driver>` neutralized,
  `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1` (no fetch, including partial-clone
  lazy fetch), submodules ignored, and repository-steering environment variables
  (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_EXTERNAL_DIFF`, …) removed. Each
  call has its own timeout (20 s on the target), is killed on timeout, cancellation,
  or when captured output passes its byte bound, and never retries. Worktree dirtiness
  checks used by `listWorktrees` use the same hardened configuration.
- _Paths._ Inputs are repository-relative POSIX paths: absolute paths, drive or UNC
  prefixes, NUL bytes, `..` escapes, and any `.git` segment are rejected by the
  backend and again by the target. The target resolves the real path of both the
  resource root and the candidate and requires containment, so a symlink that leaves
  the resource is `denied`. Credential and sensitive paths (`.env` and `.env.*` except
  `*.example`/`*.sample`/`*.template`, `.envrc`, `.npmrc`, `.pypirc`, `.netrc`,
  `.pgpass`, `.git-credentials`, `.dockercfg`, private keys and key stores such as
  `id_rsa*`/`id_ed25519*` (not `.pub`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`,
  `*.keystore`, `*.kdbx`, `*.ppk`, `credentials*.json`, `service-account*.json`,
  `secrets.{json,yaml,yml,toml}`, `*.tfstate*`, anything under `.ssh/`, `.aws/`,
  `.gnupg/`, `.kube/`, or `.overlord/tmp/`) plus the target's comma-separated
  `OVERLORD_REPOSITORY_READ_EXCLUDE` globs are never returned as content: `read_file`
  answers `denied`, `diff` withholds their sections and lists them in
  `excludedPaths`, and `search_text` drops their hits. Their names may still appear in
  status and tree listings.
- _Results._ `RepositoryReadResult.data` is operation-specific and typed in
  `packages/contract/src/chat.ts` (`RepositoryGitStatusData`, `RepositoryDiffData`,
  `RepositoryFileData`, `RepositorySearchData`; existing reads keep their capability
  payloads, with tree entries capped at `maxEntries`, default 500, maximum 2000, and
  filtered to `relativePath`). Status lists at most 1000 entries per class; search lines
  are cut at 400 characters. `read_file` returns `binary` (NUL byte or invalid UTF-8)
  or `oversized` (more than 8 MiB) with size metadata only; within that ceiling it
  returns the requested 1-based inclusive line range bounded to `maxBytes`, cut at a
  line boundary, with `truncated`. Search is `git grep --fixed-strings` over tracked
  and untracked, non-ignored text files (binary files skipped). `diff` covers tracked
  files only (`unstaged`: worktree against index; `staged`: index against HEAD; `all`:
  worktree against HEAD, or against the empty tree before the first commit).
- _Route._ `POST /api/projects/:id/repository-reads` takes a `RepositoryReadRequest`
  body (the path `:id` must equal `projectId`) and answers 200 with a
  `RepositoryReadResult` for every target-side outcome, including `target_offline`,
  `timeout`, `unavailable`, `denied`, `binary`, `oversized`, and `not_found`. It answers
  400 `invalid_request` for a malformed body, 404 when the project is not readable or
  the execution target is not one the caller may use for it, and 409
  `operation_conflict` when an `operationId` is reused with a different request. The
  operation id must match `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`; the queue key is
  derived from the acting workspace user and the operation id, so a retry waits on the
  original job and never re-queues it. A target whose runner is not live answers
  `target_offline` without queueing. At most four reads per scope (a chat run, or a
  caller for the route) are in flight; further reads wait for a slot within their
  deadline. A runner that predates these capabilities fails the job, which is reported
  as `unavailable`.
- _Runner completion._ `POST /api/runner/requests/:id/completed` accepts a JSON body of
  up to 1 MiB (every other JSON route keeps the 100 KB default), so a bounded read result
  and its envelope always fit. Tree reads are scoped (`subPath`) and capped
  (`maxEntries`) on the target before they cross the queue.

**Gemini research runtime and tool gateway (coo:1108.vx29).**

- _Runtime adapter._ `backend/chat/` implements the worker's `ChatRuntime` with Gemini
  through `@google/genai` `models.generateContentStream` (function declarations as
  `parametersJsonSchema`). Configuration: `CHAT_GEMINI_API_KEY` (falls back to
  `GEMINI_API_KEY`), `CHAT_GEMINI_MODEL` (default `gemini-3.8-flash`), and
  `CHAT_MAX_GATHERED_BYTES_PER_RUN` (default 1 MiB of recorded tool results per run).
  Without a key the runtime reports `not_configured` and runs fail
  `provider_unavailable`; it never answers with fixed text. Provider errors map to the
  closed failure codes (429 `rate_limited`; 400 naming tokens/context `context_limit`;
  401/403/404/5xx and transport failures `provider_unavailable`; anything else
  `provider_error`). `GET /api/chat/providers` returns `ChatProvidersResponse`: one
  `gemini` readiness entry (`ready`, `not_configured`, `rate_limited` for 60 s after a
  429, or `unavailable` after a transport failure) and the caller's live account
  connections.
- _Checkpoint payload (schema 2)._ The private checkpoint holds only this run's provider
  turns, verbatim and unmerged (thought signatures, call ids, empty parts), the pending
  call batch (`turn`, per-call order, operation id `chat.<runId>.t<turn>.c<order>`,
  provider call id or a synthetic `t<turn>.c<order>` when the provider omits one), and
  the run's streaming message id. The conversation prefix (latest authorized summary
  and the messages it does not cover, with withheld content rendered as a marker; see
  _Summaries_) is rebuilt from storage on every provider request. The config digest
  covers the model, the versioned system prompt, context policy and relevance policy.
  Schema 2 also stores the selected family set and a manifest of the exact declarations
  offered for the pending signed turn (SHA-256 identity over canonical object keys and
  ordered declaration/schema arrays, including names, descriptions and effects). Resume validates this manifest and uses it for historical call
  validation and read/write scheduling, never as authority. Before each new request the
  authorized catalog is rebuilt from live connections; removed grants are still refused
  by the live gateway on the next call. Schema-1/digest-incompatible checkpoints take
  existing fresh-generation recovery; no signed turn is rewritten. Fresh-generation recovery sends no function-call parts; it adds this run's
  completed, still-authorized tool observations as untrusted text.
- _Tool catalog (fixed), relevance manifests (expandable)._ `overlord_list_projects`, `overlord_list_execution_targets`,
  `overlord_search_missions`, `overlord_get_mission`, `repository_read` (the eight
  `RepositoryReadOperation`s through the same core service as the REST route, scope
  `chat-run:<runId>`), `prepare_proposal` (see _Proposal preparation_), the reviewed
  Knowledgebase reads of the owner's live connections, the reviewed Knowledgebase writes
  for the connection and workspace a write grant or an `all_workspaces` connection
  authorizes ("Knowledgebase writes" below), `overlord_find_feature_missions` with a
  Knowledgebase configured ("Feature handoff" below), `expand_capabilities` (declared in
  every manifest, below), and `ask_user`. Declarations and descriptions are Overlord's; no tool creates,
  changes, launches, or queues work. A call
  to an undeclared name answers `unknown_tool`; arguments are validated against the
  declared closed schema (`invalid_arguments`); every Overlord and repository read
  resolves the thread owner's live organization memberships and role grants at call
  time (`project:read` for projects, resources, targets and repository reads;
  `mission:read` for missions, objectives and deliveries) and answers `not_found`
  without revealing existence. Tool results reach the model wrapped as untrusted data.
  Results are bounded to 96 KiB of provider input.
  Backend may initially declare a deterministic subset of this fixed authorized catalog:
  stable families `status` (mission search/detail), `repository` (target discovery and
  repository reads), `knowledgebase` (reviewed connection reads and live-authorized
  writes), and `feature` (Knowledgebase plus exhaustive Feature lookup and mission detail).
  Project discovery, question and proposal preparation remain available in every manifest;
  connection workspace discovery remains available when authorized. No routing-model call
  is added. Unrecognized, ambiguous or referential requests use the full authorized catalog;
  cross-family requests take the union. A stored per-message write grant selects Knowledgebase.
  Always-available reviewed reads means available through expansion, not necessarily declared
  in every request. `expand_capabilities` accepts optional `families` from the four names
  plus `all`; empty/omitted lists discover current authorized capabilities and tool names.
  Expansion only widens relevance, never permission, and takes effect on the next request.
  Its complete signed call and receipt use the normal checkpoint-before-execute path, tool
  allowance, ordered join and raw diagnostics. Successful expansion receipts restore the
  family union even after a crash between receipt and join; duplicate execution is harmless.
  A call not in its historical manifest still returns `unknown_tool`, even when an expansion
  appears earlier in the same turn. Failed live catalog discovery contributes no connection
  tools. A per-message grant naming a workspace no longer in the connection's live
  authorized-workspace list contributes no write declarations; an all-workspaces connection
  with an empty authorized list contributes none either. Call-time checks remain unchanged.
  Full fallback means all currently authorized tools, never all possible permissions.
- _Static-prefix cache (coo:1127.0904)._ Backend may place a tool-enabled request's exact
  static prefix in a Gemini explicit cache (`caches.create`, same Generate Content API
  family) and reference it with `cachedContent`. The prefix is only the exact system
  instruction, the request's exact function declarations and `functionCallingConfig.mode
  = AUTO`; never conversation, summaries, tool results, source content, proposals,
  credentials or connection secrets. A `cachedContent` request carries no system
  instruction, tools or tool config (the provider rejects them), so tool-free closing
  (`NONE`) requests and summary generation are always sent inline.
  - _Hybrid use._ Only while the attempt's previous reported `promptTokenCount` (before
    any report: request bytes / 4) is below 16,000 tokens; larger requests go inline so
    implicit caching can cover the growing conversation. A cached request reports only
    the cache's tokens as cached and gains no implicit hits, so caching every request
    would raise cost on long runs. The cache never removes prompt tokens or context
    occupancy: the context budget still counts the cached declarations.
  - _Key and isolation._ SHA-256 over the owner's profile and organization, the model and
    the canonical static config. Caches are never shared across owners, even for
    identical manifests. A changed prompt, grant, connection, family or schema yields a
    different key; a cache is never used for a different manifest, and a cache reference
    never authorizes anything (every call still faces the live gateway checks; schema-2
    checkpoint manifests are unchanged).
  - _Lifecycle._ TTL 600 s; reuse only with at least 60 s remaining. A process-local,
    in-memory registry (no database state) holds at most 64 entries and 4 per owner.
    Creation is single-flight per key, never blocks a request (that request goes inline),
    is bounded to 15 s and is awaited by the creating attempt before it finishes, so its
    observation is durable. A failed creation suppresses that key for the TTL. When an
    owner exceeds 4 entries, the oldest of that owner's caches is deleted from that
    owner's attempt. A full registry skips creation. Caches left by a restart expire by
    TTL; a restart starts cold.
  - _Fallback._ A cached request refused at stream open with 400, 403 or 404, before any
    chunk arrives, invalidates the entry and is sent once inline with identical contents.
    Nothing is retried after a chunk arrives; transient-retry and rate-limit rules are
    unchanged, so no turn or tool call is duplicated.
  - _Digest, checkpoint and recovery._ The effective model input is identical with or
    without the cache, so the config digest, checkpoint schema 2 and fresh-generation
    rules are unchanged. The cache name is never stored in checkpoints, snapshots or
    events; a resumed attempt recomputes the key and reuses or recreates the cache.
  - _Diagnostics._ Owner-private and captured only in the triggering owner's thread:
    `provider.cache_create` (complete create config including the instruction and
    declarations, then the provider response metadata or original error),
    `provider.cache_delete` and `provider.cache_fallback`. A cached `provider.request`
    records the SDK request actually sent plus `staticCache` holding the cache name, key
    and the effective system instruction, declarations and tool config, so the effective
    input stays inspectable. `performance.attempt` adds cached-request and fallback
    counts. These are open diagnostic kinds.
  - _Configuration._ On by default with a configured key; `CHAT_GEMINI_STATIC_CACHE=off`
    disables it (any other value keeps the default). Explicit caches incur provider
    storage charges for their TTL.
- _Questions._ `ask_user` is a checkpointed call: reads in the same turn run first, the
  question opens through the existing question path (run `waiting_user`, notification
  candidate), and the answer becomes that call's recorded result when the run resumes
  from its checkpoint. One question per turn; extra `ask_user` calls answer
  `invalid_arguments`.
- _Evidence and citations._ Each tool result's sources become `chat_source_refs`
  (scope keys: `overlord:<entity>:<id>`, `repository:<target>:<project>:<resource>:<path>@<head>`,
  `knowledgebase:<connection>:<workspace>:<node>`), are checked live, and get one
  `chat_evidence` row each with a thread-local citation ref (`E<n>`) returned to the
  model. A source that does not check `authorized` withholds that result's content
  (`source_unverified`). The tool call's dependency set becomes the union of its
  request context and its sources. The answer's `[E<n>]` or `[E<n>, E<m>]` citations
  become the text block's `evidenceIds` and one `evidence` block (one entry per source,
  `stale` when observed more than 15 minutes before attachment); the message's
  dependency set includes the cited sources. Streamed text, questions, checkpoints and
  summaries use the conservative union of every authorized dependency set in the
  thread.
- _Summaries._ Once at least eight messages are not covered by the latest summary, the
  runtime writes a compact `chat_thread_summaries` row (goal text, decisions, open
  questions, evidence refs) from a plain-text transcript of authorized content; a failed
  summary never fails the run.
  - _Coverage._ `covers_through_message_id` names the last message the generation
    actually read; the transcript is the previous usable summary plus the messages
    after its boundary, oldest first, cut at a message boundary when it reaches its
    size bound, so coverage never claims an unread message. Core resolves the boundary's
    position by storage order `(created_at, id)` even when it lies outside the latest
    100-message page; a boundary that cannot be resolved, or an absent, invalidated or
    unauthorized summary, means no coverage and the full authorized page is sent. Core's
    internal summary write accepts the explicit coverage boundary, validated to belong to
    the thread and not precede the previous boundary.
  - _Prefix selection._ With usable coverage, covered messages are replaced by the
    summary, except the run's trigger message, every message of the current run, and
    the four most recent messages, which stay verbatim. Proposal cards and creation
    receipts are supplied separately and never compacted; the current run's signed
    provider turns are never summarized or compacted. Omitting covered text never
    narrows dependencies: summaries, checkpoints, messages and questions keep the
    conservative thread union, and revocation invalidates the summary (falling back
    to authorized messages with `unavailable` markers) and fences as before.
  - _Generation._ A dedicated compact instruction (not the research prompt) treats
    the transcript as untrusted data and returns only the four fields under a bounded
    output (`maxOutputTokens` 2048, low thinking) with no tools. A response that is not
    complete (`finishReason` other than `STOP`), not valid JSON, or outside the field
    bounds (text 6,000 chars, 20 decisions, 20 open questions, 50 `E<n>` refs, items 500
    chars) is a failed optional summary: it is recorded privately, never stored and
    never replaces the last valid summary. The eight-message cadence is unchanged.
- _Source checkers._ `overlord` sources are `authorized` while the entity exists and the
  owner keeps the read permission on its project's workspace, else `revoked`;
  `repository` sources while the owner keeps `project:read` and the execution target
  stays eligible for that project (reachability is not access). Both are registered
  with the Knowledgebase checker through the connections module's composed
  `checkSource`.
- _Limits._ Before each provider request the runtime stops at the per-run tool-call
  limit, the gathered-content budget, or within one minute of the active-time limit; a
  function-call turn that would exceed the tool-call limit is discarded unexecuted (never
  checkpointed) and one tool-free request (`functionCallingConfig.mode = NONE`) writes the
  closing summary before the run completes `allowance_exhausted`.
- _Context budget (coo:1127.158y)._ Token budgets are counted in provider tokens, never
  characters. Before each tool-enabled request after the first of an attempt, the
  runtime projects its input as the previous exchange's reported `promptTokenCount`
  plus one token per two bytes of request growth. If the projection exceeds the model
  input limit minus a 65,536-token headroom, it stops gathering and ends through the
  same tool-free closing request and `allowance_exhausted` outcome (Continue starts a
  fresh run whose prefix uses the summary). The limit is `CHAT_GEMINI_INPUT_TOKEN_LIMIT`
  (default 1,048,576, the verified `gemini-3.8-flash` input limit; whole number
  131,072–2,097,152, otherwise the default). Without a reported usage the runtime sends
  the request and a provider rejection keeps the existing `context_limit` code. Context
  is never silently dropped to force a request through, and no new failure code exists.

**Verification and hardening (coo:1108.z77k).**

- _Operator limits._ Each is a whole number in its range; an unset, malformed, or
  out-of-range value keeps the default. A run records the limits in force when it was
  submitted, so a change applies to new runs only. `CHAT_MAX_TOOL_CALLS_PER_RUN`
  (default 60, 1–500), `CHAT_MAX_ACTIVE_MS_PER_RUN` (600000, 120000–3600000; the last
  minute is reserved for the closing summary), `CHAT_MAX_CONCURRENT_RUNS_PER_OWNER` (3,
  1–50), `CHAT_MAX_TARGET_READS_PER_RUN` (4, 1–4; the repository-read service admits four
  per run regardless), `CHAT_ATTEMPT_LEASE_MS` (30000, 5000–600000),
  `CHAT_NOTIFICATION_GRACE_MS` (5000), `CHAT_PRESENCE_TTL_MS` (30000),
  `CHAT_EVENT_RETENTION_MS` (604800000) and `CHAT_EVENT_RETENTION_COUNT` (5000), alongside
  the existing `CHAT_MAX_GATHERED_BYTES_PER_RUN` (1048576).
- _Progress labels._ `tool.updated.label` is one of a fixed set of display strings
  (`Listing projects`, `Checking machines`, `Searching missions`, `Reading a mission`,
  `Inspecting a repository`, `Preparing a proposal`, `Asking a question`,
  `Searching notes`, `Reading a note`, `Browsing notes`, `Updating notes` (a Knowledgebase
  write tool), `Checking Feature missions`, `Unavailable tool`). `query` reports
  `Searching notes`. A tool name
  chosen by the model is never echoed to clients. Clients treat the label as opaque text.
- _Project list tool._ `overlord_list_projects` returns the agent catalog once per
  workspace (`assignmentCatalogs`), not on every project. This is model-facing tool
  content, not a DTO.
- _Proposal preparation._ A refused `prepare_proposal` call carries a specific reason
  for the model (for example an unregistered resource key, an unsupported model, or a
  project with no registered resource). The reason is never part of an HTTP error body,
  and it never names a project the owner cannot use. A project without a registered
  resource cannot receive drafts from the assistant.
- _Transient provider failures._ A 500, 502, 503, or 504, or a transport failure with no
  status, is retried at most twice (after 0.4 s and 1.5 s) before any part of that turn
  has arrived, so nothing is persisted twice. Rate limits, configuration errors
  (401/403/404), and failures in the middle of a stream are not retried and fail the
  run with its closed code.
- _Termination._ On `SIGTERM` or `SIGINT` the backend stops its chat worker and
  conversation-notification dispatcher and then terminates with that signal. An
  interrupted attempt is reclaimed by another worker when its lease lapses.
- _Archived projects._ Create follows the existing mission-creation rule, which accepts
  an archived project; the assistant only lists active projects when preparing.

**Owner-only diagnostics.** `chat_diagnostics` stores append-only observations: provider
SDK request bodies, every streamed SDK chunk, full generate responses, stream completion and
original errors (including retry and summary failures), private chat events with raw tool,
run and attempt state at the transition, worker failures, and thread-associated REST
request/response/error bodies (excluding the diagnostics poll itself). Capture is
independent of the display setting. Payloads are neither redacted nor truncated; content is
rendered as escaped text. The owner-only diagnostics route (`getChatThreadsByIdDiagnostics`)
is the explicit exception to the curated-chat privacy and source projection rules: the owner
can inspect previously observed content, including thought signatures, tool output and
subsequently revoked source content. Provider SDK inputs/outputs are captured; transport
authorization headers and credential store envelopes are not SDK message content and are not
separately copied. Diagnostics never enter ordinary snapshots, SSE, global logs, search,
webhooks or provider history. No diagnostic read invokes tools or changes a run's
authorization. History lasts for the thread lifetime and cascades on owner/thread deletion.

**Knowledgebase writes (run-scoped grant).** `SubmitChatMessageBody.knowledgebaseWrite?:
ChatKnowledgebaseWriteDto` (`{ connectionId, workspace }`), chosen per message, is the only
per-run way to authorize writes. It is refused with `invalid_request` unless the connection
is the caller's live Knowledgebase connection on the configured server and the workspace is
in its `authorizedWorkspaces` (`connection_reauthorization_required` when it needs
sign-in). The grant is stored on the run (`chat_runs.knowledgebase_write_json`) and
returned as `ChatRunDto.knowledgebaseWrite` (null for research only, and null under an
`all_workspaces` connection). A resumed run keeps it; a Continue run inherits it; an answer
may add a grant to a waiting run that has none and may never change one. OAuth consent,
earlier runs, and model output never authorize a write. Without a grant no write tool is
declared and any write call is refused server-side (`write_not_authorized`) before reaching
the Knowledgebase, unless the connection's `assistant_write_scope` is `all_workspaces`,
which authorizes writes in every authorized workspace of that connection for every run;
turning that setting off refuses the next write (`write_not_authorized`) even for tools a
running run already declared. Writes run one at a time in call order after the turn's
reads. A write still `executing` when its attempt ends, or one that throws inside the
worker, is resolved at the next claim as `failed` with `error_code = 'uncertain_write'` and
an `uncertain` result: never re-requested, never cancelled, and shown to the model on
fresh-generation recovery. Overlord missions are still never created, changed, or launched
by a tool. Backend credentials are never exported to local or CLI mission agents.

**Feature handoff.** The canonical Knowledgebase Feature reference is
`kb-feature:<origin>/<workspace slug>/<node uuid>` (`knowledgebaseFeatureReference`,
`parseKnowledgebaseFeatureReference`) with the stable link `<origin>/n/<node uuid>`. A
handoff mission carries it in objective text; identity is never a title or path. Mission
completion is mission `statusType` `complete`; an objective delivery or `review` is not
completion. With a Knowledgebase configured the assistant gets the read tool
`overlord_find_feature_missions` (`projectId`, `workspace`, `featureNodeId`, optional
`knowledgebaseOrigin` when several servers are connected, `cursor`, `limit`), which derives
the origin from the owner's live connection, runs the exhaustive exact-reference lookup
("REST API → Database (HTTP Surface)", "Exact reference lookup") with the owner's live
`mission:read` grant, and returns the reference, Feature link, `referenceLines` for a
handoff objective, results, `nextCursor`, and `complete`. Handoff reuses `prepare_proposal`
and the user's Create: drafts only, never launched. Run input carries `createdReceipts`, the
thread's five most recently updated non-open proposal cards with their receipts (mission ids
and display ids), so a later turn recovers a created mission instead of proposing it again.
A `set_properties` write that sets a Feature's `overlord` property to a non-null value is
refused before any request unless it names exactly one live mission the owner can read,
and refused when that mission carries a different Feature's canonical reference; `null`
(Remove link) is always allowed and never changes the mission.

**Account deletion.** Every chat, connection, presence, acknowledgement, receipt, and
conversation-notification row cascades from `profiles` (and `organizations`), so the
existing account-deletion cascade removes them with the identity and no new
`RESTRICT` child is introduced. Missions created from chat survive; their
`created_from_chat_thread_id` soft reference may dangle.

### Backend → Outbound MCP (Account Connection Surface)

- **Transport**: HTTPS JSON-RPC (MCP streamable HTTP) from the backend to the configured Knowledgebase origin only, with the connection's access token; egress is restricted server-side.
- **Configured server**: one deployment talks to exactly one Knowledgebase MCP resource, chosen by the operator, never by a user; there are no per-user custom servers. `KNOWLEDGEBASE_MCP_URL` unset or blank means the standard server `https://knowledge.chaselubitz.com/mcp` (`DEFAULT_KNOWLEDGEBASE_MCP_URL`); an HTTPS URL is an operator override validated at startup (HTTPS, no credentials), and a malformed override turns the provider off rather than the backend; `off`, `none`, `disabled` or `false` turns the provider off (`not_configured`, no Client ID Metadata Document). Egress reaches only the server's origin plus `KNOWLEDGEBASE_EGRESS_ORIGINS` over HTTPS without following redirects. Existing rows keep their `server_url`. At startup the backend logs only the server origin, whether it is the default or an override, and the key source.
- **Policy**: only a reviewed tool allowlist, namespaced per connection, is exposed to the assistant. Reviewed reads are always available through relevance expansion/full-catalog fallback; reviewed writes only for the connection and workspace of the run's user-authorized `knowledgebaseWrite` grant, or for any authorized workspace of a connection whose live `assistant_write_scope` is `all_workspaces`, and refused otherwise before any request; unreviewed tools are rejected regardless of annotations; every call has argument, output-size, and time bounds; the per-source access check fails closed.
- **Tool policy version 2**: reads `list_workspaces`, `search`, `read_file`, `get_related`, `list_children`, `get_links`, `read_resource`, `list_entities`, `query`, `get_registries`; writes `create_node`, `edit_file`, `set_properties`, `add_relation`, `update_relation`, `remove_relation` with required revision guards (`expected_version`, `expected_metadata_revision`, or `expected_revision`, required by Overlord's schemas) and bounded nested JSON (depth 8, 4000 values, 16 KiB strings, finite numbers, 128-character keys; `null` removes a property). Schema administration, sharing, credentials, moves, and deletion stay outside the policy. There is no Knowledgebase write OAuth scope: a connection acts with its user's grants minus their restrictions, so existing connections gain the tools without reauthorization and the Knowledgebase remains authoritative (403). `toolPolicyVersion` records the version at sign-in and does not gate tools. Each has Overlord-reviewed descriptions and closed input schemas (server descriptions and schemas are never shown to the model). Server annotations can only withhold a reviewed tool (a read not annotated `readOnlyHint: true` or annotated destructive; a write annotated destructive unless reviewed destructive, which only `remove_relation` is). A guard refusal (409/412, or `edit_file`'s version check) is `conflict`: the model is told to reread and re-evaluate. A write sent without a usable response (transport loss, 5xx, oversized or unparseable result) is `uncertain` and never retried; one refused before handling (401 refresh, 4xx, dropped session) is safe. `query`, `get_related`, and `get_registries` are complete-metadata reads: over the text bound they are refused (`response_too_large`, ask for a smaller page) rather than truncated. Tool ids are `kb_<first 12 hex of the connection id>_<tool>` (≤ 64 characters; letters, digits, and underscores only, because the provider rewrote the earlier dotted form and the gateway then rejected the call as an unknown tool). Workspace-scoped calls must name a workspace in the connection's `authorizedWorkspaces` (refreshed from `list_workspaces` once when unknown); anything else is `workspace_not_authorized`.
- **Bounds**: 4 KiB arguments for reads and per-tool limits for writes (up to 56 KiB), 1 MiB response read from the network (beyond that the call fails), 64 KiB text returned per call with a `truncated` flag, 15 s per call, redirects never followed. Results carry the namespaced tool, connection, workspace, observation time, and provenance (node id, path, provider revision, and update time for every node in the full response, at most 50).
- **Access checks**: a source check consults the owner's connection row on every call (`disconnected` or foreign → `revoked`; not connected → `unknown`), then `get_related` (403/404 → `revoked`). Source checks keep single-flight behavior (concurrent checks of the same owner and source share one upstream call). Only positive answers are cached, per owner, for 30 s, so an upstream node revocation is observed within that window. Any other result is `unknown`; both fail closed.
- **Token use**: a 401 triggers one refresh shared by concurrent callers through the refresh lease (15 s, shorter than the provider's 30 s reuse grace). A second 401 or `invalid_grant` marks the connection `reauthorization_required` and erases its credential.
- **Credentials**: obtained and refreshed only by the connections module (serialized refresh, rotated token persisted before use) and never logged or returned.

### Extension → Account Connections (Credential Surface)

- **Transport**: in-process. The backend composition root passes REST extension account-connection provider adapters to `createConnectionsRuntime({ providers })` and shares its `ProfileConnections` instance with the extension routers. Each adapter supplies provider-specific behaviour only: upstream credential validation (API keys), or for OAuth the authorize URL, code exchange, refresh, revoke, and account description; plus legacy-store adoption and the legacy tombstone on disconnect.
- **Ownership**: the connections module owns storage, encryption, the key ring, re-sealing, OAuth state, the refresh lease, state, and DTOs. An extension obtains a credential only through `ProfileConnections.credential(profileId, provider)` (API keys) or `ProfileConnections.oauthAccessToken(profileId, provider, { staleRevision? })` (OAuth: refreshed under the lease, rotated credential persisted first), and never reads `account_connections.credential_*` or holds an encryption key. An extension may record a re-validated account (`recordAccount`) or require reauthorization with a provider error code (`requireReauthorization`).
- **Errors**: `ConnectionAccessError` with `not_found` (no connected row), `unavailable` (key or OAuth client not configured, or the upstream is unreachable; nothing erased) or `reauthorization_required` (unreadable, refresh rejected, or identity changed; erased). The extension maps them to its own legacy error text.
- **Providers**: `everhour` (API key) and `github` (OAuth, confidential client, callback `/api/auth/callback/github/repository`).

### MCP Server → Auth (Hosted Agent Auth Surface)

Specified in [authorization.md](authorization.md).

### MCP Server → Service Layer

- **Transport**: In-process function calls from MCP tool handlers to existing
  service/protocol functions
- **Rule**: MCP handlers must not read or write database tables directly.
- **Authorization**: Every tool call must pass through the same RBAC gates as the
  corresponding REST or protocol operation.
- **Tool catalog**: Both MCP surfaces publish the one catalog in
  `@overlord/contract/mcp-tools`. Hosted MCP adds only widget `_meta`; the
  local connector shim's `tools` array is generated from the catalog without
  `outputSchema` and must never be edited by hand.
- **Project context**: Hosted MCP cannot observe a cloud agent's current working
  directory. A caller that supplies `projectId` creates a normal mission after
  resolving that resource; only an explicit unassigned intent (`overlord_create_inbox_item`,
  or `overlord_create_mission` with `unassignedToProject: true`) produces an
  account-owned inbox item, never an implicit project.
- **Locality**: Hosted MCP must not expose local filesystem/worktree inspection,
  runner queue claiming, execution target mutation, or branch-action tools.
- **Widget safety**: MCP Apps resources use `ui://overlord/*` URIs and return
  self-contained HTML. They may render only the associated tool's
  `structuredContent`; resources must not embed third-party frames, browser
  credentials, secrets, or unrestricted network access.

### Auth → Database (Identity Bridge)

Specified in [authorization.md](authorization.md).

### Service → Automations (Automation Surface)

- **Transport**: Service-layer function calls to the automations module's exported package API (`@overlord/automations`)
- **Browser-safe subpaths**: SPA / renderer callers that need pure lifecycle or scheduling helpers MUST import `@overlord/automations/objective-manager` or `@overlord/automations/scheduling-engine` instead of the package root. The root barrel also re-exports Gemini-backed title tools and therefore pulls `@google/genai` into the client graph when imported from the webapp.
- **Configuration**: Environment variables documented in `.env.prod.example` / `.env.local.example` (`GEMINI_API_KEY`, optional model override)
- **Rule**: Automations must not read or write domain tables directly; persistence goes through caller-supplied store interfaces (e.g. `ObjectiveTitleStore`)
- **Fallback**: When a provider is unavailable or a call fails, automations return `null` and callers use deterministic local fallbacks
- **Downstream extension**: Forks add automations via `OVERLORD_AUTOMATIONS_MODULE` (`custom-automation` extension point), registering through the module API — never by editing the built-in registry

### Extension → Core (Extension Surface)

- **Database**: Migrations in `ext_<name>_` prefixed tables; `schema_migrations.component = 'ext:<name>'`
- **Metadata**: Namespaced keys in `metadata_json` / `settings_json` (reverse-DNS or package-style)
- **Reactions**: Via service APIs, `entity_changes`, and `outbox_messages`; no direct writes to core tables
- **Connector extensions**: Via `user_harness_extensions` → `workspace_harness_extensions` promotion

### Desktop Shell → REST (Renderer Surface)

- **Transport**: The hardened `BrowserWindow` loads the SPA and calls `/api/*` (including the SSE realtime stream) — over the loopback `http`/`ws` origin in **Local** mode, or over the hosted backend's HTTPS/`wss` origin (a separate origin from the local shell) in **Remote** mode, via the SPA's runtime-injected API base URL. Either way the SPA is just another HTTP client of the existing REST surface
- **Auth**: In **Local** mode, Better Auth session cookies work natively because the renderer and API share the same loopback origin; the shell injects no headers and stores no tokens. In **Remote** mode (cross-origin), the shell uses only the active profile's Better Auth **session bearer token**, obtained at login, persisted per-backend via `safeStorage`, and injected into the SPA's API and realtime clients. It does not mint, read, or prefer a `USER_TOKEN`; that credential remains for CLI/headless clients. Selected workspace is client-side navigation state and is never injected into requests.
- **Remote OAuth handoff**: Social OAuth starts at `/api/auth/desktop/github` in the system browser, which lets Better Auth create and validate its OAuth state cookie in that browser's cookie jar. After Better Auth establishes its browser session, `/api/auth/desktop/callback` redirects only to `overlord://auth/callback?ticket=…`; the ticket is opaque, single-use, and short-lived. Electron's main process exchanges it over HTTPS at `/api/auth/desktop/exchange`, writes the session token to the active profile's `safeStorage`, and reloads the local shell. The renderer and custom URL never receive a session token, GitHub token, client secret, or reusable OAuth state
- **Mission deep links**: Electron accepts only `overlord://missions/<missionId>` values whose id matches `[A-Za-z0-9:_-]{1,64}`. It focuses or creates the shell window and forwards only the fixed internal `/user/missions/<missionId>` route through the feature-detected `window.overlord.onNavigate` bridge; this URL contains no credentials, ticket, or payload.
- **Rule**: The shell must not fork or modify the SPA; desktop-only affordances are exposed only through the feature-detected `window.overlord` preload bridge. Navigation stays scoped to the shell origin in both modes
- **Durable notifications**: The SPA consumes profile-owned `GET /api/notifications` history and authorized `notification` entity changes. It does not derive notification policy from mission, objective, execution-request, or mission-event realtime changes. When available, it invokes the bounded `window.overlord.showNotification` bridge; a browser uses the Web Notification API. The separate app-update and CLI-update banner UI is not a user-notification transport.

### Desktop Shell → CLI (Process Supervision Surface)

- **Transport**: Subprocess / Node `utilityProcess` invocation of the bundled CLI and server (`ovld serve`, `ovld runner`, `ovld launch`, `ovld runner service <action>`), analogous to the Agent → Protocol subprocess pattern
- **Credential**: For spawned CLI that needs a network credential (remote/shared deployments), the shell passes a `USER_TOKEN` via `Overlord_USER_TOKEN`; pure-loopback execution talks to the local service layer and needs none
- **Persistent runner control**: The `runnerService.*` preload ops spawn `ovld runner service <install|start|stop|restart|status|uninstall> --json` in the shell's main process, injecting the active backend URL and (remote mode) token so an install captures the right credential; the parsed JSON status is returned to the renderer. The shell never claims runner queue work, supervises the loop, or generates service files itself — those stay CLI/Runner-owned
- **Rule**: The shell triggers existing CLI/runner behavior; it must not reimplement launch, terminal, or config logic the CLI/Runner Layers own
- **Shared paths and helpers**: The shell locates `~/.ovld` (or `OVLD_HOME`) only through the Database package's `local-paths` and normalizes backend URLs with the Contract package helper; it bundles those modules rather than re-deriving them, so the shell, CLI, and backend agree on `OVLD_HOME` (a relative value is resolved to an absolute path everywhere)

---

## Shared Deterministic Algorithms

A few pure, deterministic computations must produce **identical** results in more than one component. Rather than share a runtime package (which couples the components' build/publish graphs), each component keeps its own copy of the algorithm and both copies are pinned to a single committed **conformance fixture** of golden input→output vectors. CI runs both component test suites against the same fixture, so the implementations cannot drift apart.

### Per-mission branch/worktree planning

- **Algorithm**: `planMissionBranch`, `previewMissionBranch`, `missionWorktreePath`, `sanitizeBranchName`, `canonicalMissionBranch`, `slugifyBranchTitle` (and the `BranchDecision*` / `BranchIsolation` types). `missionWorktreePath` takes `worktreeRoot`, `projectSlug`, `resourceKey`, and `branch`, and the resource key is always included between the project slug and branch leaf. `planMissionBranch` takes an optional `isolation: { objectiveKey }`: when set (and no `overrideBranch` is pinned) it returns `<the branch it would otherwise have planned>-<objectiveKey>` — created from that branch, reused when it already exists unmerged, cycled with a numeric suffix once merged — so two objectives running in parallel on one resource never plan the same worktree. `previewMissionBranch` never isolates; it predicts mission-level branch metadata.
- **Implementations** (must stay byte-for-byte equivalent in behavior):
  - Runner Layer — `cli/src/branch-planning.ts`, used by `cli/src/branch-preparation.ts` to **prepare** the real branch/worktree before launch.
  - Service layer (backend) — `backend/branch-planning.ts`, used by `backend/repository.ts` to **predict** `MissionBranchDto` branch metadata surfaced over REST.
- **Conformance fixture**: [`contract/branch-planning-vectors.json`](branch-planning-vectors.json). Both `cli/test/branch-planning.test.ts` and `backend/branch-planning.test.ts` assert their implementation against every vector, including resource-scoped worktree paths.
- **Rule**: Neither component may import the other's copy across the boundary. Any change to the algorithm MUST update both copies, regenerate the fixture, and **bump the contract version** — the fixture is a stable interface.

## Extension Points

The only sanctioned ways to extend Overlord:

| Extension Point             | Mechanism                                                                | Boundary                |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| Custom agent connector      | New adapter + `conformance-manifest.yaml` + `harness-capabilities.yaml`  | Connector Layer         |
| Custom harness              | `user_harness_extensions` + workspace promotion                          | Extension System        |
| Custom automation           | Module(s) via `OVERLORD_AUTOMATIONS_MODULE` calling `registerAutomation` | Automations Layer       |
| Database adapter            | Implement full logical schema + pass conformance tests                   | Database Layer          |
| Database extension          | `ext_<name>_` tables + `schema_migrations.component`                     | Database Layer          |
| Auth/RBAC provider          | Auth Layer service boundary                                              | Auth Layer              |
| REST extension              | Namespaced endpoint prefix (`/ext/<name>/`)                              | REST API Layer          |
| Account-connection provider | Provider adapter registered with the connections module                  | Extension System        |
| Open vocabulary values      | Namespaced values declared in manifest                                   | Database/Protocol Layer |

Attempting to extend Overlord through any other path — patching core tables directly, adding undeclared hook types, using closed vocabulary values — is a contract violation that must be resolved before the component ships.

See [`contract/extension-points.yaml`](extension-points.yaml) for machine-readable
extension declarations and the agent-session capability vocabulary.
