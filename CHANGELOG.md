# Changelog

All notable changes to this project will be documented in this file.

## [4.9.0] - 2026-04-21:09:09

### Added
- **Everhour nav timer controls** in the web app navigation so users can start and manage tracked time directly from app chrome.
- **Everhour server actions and client hooks** for timer lifecycle and workspace-aware syncing between UI and backend.
- **Home page enhancements** that improve first-load navigation into active project workflows.

### Fixed
- **Project selection action typing** and related action wiring issues that could cause project option handling regressions.

### Changed
- **Navigation header layout** to better support timer UI and keep top-level controls aligned across app states.
- **Desktop build configuration** updates to keep packaging aligned with the latest runtime and app entry expectations.

### Security
- None.

### Test
- Add coverage for Everhour nav timer context behavior to lock timer state transitions and nav synchronization.

### Chore
- Bump workspace and `overlord-cli` package versions to `4.9.0`.

## [4.8.0] - 2026-04-21:10:00

### Added
- **Chat-invoked Overlord workflows** via `ovld protocol spawn` so users can create and work Overlord tickets directly from chat without launching from desktop.
- **Mode 2 support in overlord-ticket skill** for chat-initiated Overlord sessions with ticket discovery, context loading, and project discovery capabilities.
- **Per-user SSH configuration** stored in `project_user` table so each user can maintain distinct SSH settings (host, port, user, auth method, key path) for the same project.
- **Remote helper deployment tracking** (`remote_helper_installed_at`, `remote_helper_version`) on projects table for better provisioning state visibility.
- **Change rationales API** in protocol (`record-change-rationales`, `--change-rationales-json`) for structured documentation of code changes with impact analysis.
- **Context and artifact APIs** in protocol (`read-context`, `write-context`, `artifact-upload-file`, `artifact-download-url`) for durable session state and file handling.

### Fixed
- None.

### Changed
- **Database schema**: Renamed `project_user_preferences` table to `project_user` as the canonical per-user/per-project join row for both UI preferences and SSH execution settings.
- **SSH settings storage**: Migrated SSH-related fields from `projects` table to `project_user` table with best-effort backfill for existing users.
- **Project settings UI**: Workflow page now owns SSH configuration input; ProjectExecutionWorkspaceSelector simplified by delegating SSH setup responsibility.
- **overlord-ticket skill**: Expanded with two-mode workflow (Launched vs Chat-invoked), comprehensive protocol CLI reference, and change rationale patterns.
- **Protocol lifecycle**: Enhanced `ovld protocol` subcommands and flags for artifact handling, change documentation, and chat-initiated ticket spawning.

### Security
- None.

### Removed
- Drop SSH-related columns from `projects` table (migrated to `project_user`): `ssh_command`, `remote_working_directory`, `ssh_host`, `ssh_port`, `ssh_user`, `ssh_auth_method`, `ssh_private_key_path`.

### Refactor
- **ProjectExecutionWorkspaceSelector** refactored to remove SSH configuration responsibility; WorkflowPage consolidates user-facing SSH settings.
- **Protocol attachment** and delivery flows enhanced for better session state handling in both desktop and chat contexts.

### Chore
- Bump workspace and `overlord-cli` package versions to `4.8.0`.

## [4.7.0] - 2026-04-20:14:22

### Added
- **Objective submission lifecycle** with explicit states (`draft`, `submitted`, `executing`, `complete`) so draft objectives stay hidden from agents until they are intentionally submitted.
- **Project remote workspace settings** now capture structured SSH fields (`host`, `port`, `user`, auth method, private key path) and track remote helper install metadata for more reliable remote execution setup.
- **Tailscale and remote-helper awareness** in project execution workspace selection to improve readiness checks and remote launch guidance.
- **Foreground push notification controls** on mobile now support separate banner/list behavior for better notification presentation.

### Fixed
- **Server connection refresh** now runs before launch flows to reduce stale-connection launch failures.
- **Scheduler editor save flow** handles monthly options more reliably.
- **Protocol permission request delivery** now uses `ovld protocol` calls instead of ad-hoc `curl` plumbing for more consistent request handling.

### Changed
- **Agent launches** now include explicit model identifiers so launches are more deterministic across web, desktop, and CLI orchestration paths.
- **Objective UI and data access patterns** prioritize submitted objectives over drafts across ticket views and realtime updates.
- **Remote helper installation flow** now persists helper version information during install for better compatibility tracking.

### Security
- **Permission request hooks** now focus on essential rules, reducing unnecessary permission surface while keeping required workflows functional.

### Refactor
- **Workspace and SSH handling** were reorganized around shared parsing/connection helpers to align local and remote execution code paths.

### Test
- Add and update tests for CLI protocol and credential behavior, plus ticket prompt expectations aligned with objective and protocol changes.

### Chore
- Bump workspace and `overlord-cli` package versions to `4.7.0`.

## [4.6.0] - 2026-04-18:10:03

### Added
- **Board dataset** support (`board`, `list`, `calendar`) on ticket queries and bootstrap so Kanban, list, and calendar each keep their own React Query cache instead of overwriting one another when switching views.
- **Calendar** bootstrap loads tickets with a **due date** (up to 500, ordered by due time) for a dataset that matches what the calendar UI needs.

### Fixed
- **Rename ticket status (column)** applies an optimistic **rename across cached boards** (including every board dataset key) so tickets under the old status name move to the new name immediately and stay aligned after the server responds.
- **New Ticket** and **Quick Run** return to a ready state right after the create mutation is scheduled, then **await creation** before assignment, AI title refresh, and (Quick Run) **agent launch and navigation**—avoiding races where follow-up steps ran before the row existed; surface clearer error toasts when post-create steps fail.
- **Ticket detail realtime** (`useTicketRealtime`) now updates **TanStack Query** caches for events, artifacts, file changes, session, and shared state (same keys as the detail hooks) and drops redundant prefetch-only subscriptions from **`TicketLiveProvider`**.
- Desktop **git commit/push** IPC throws errors that **preserve `cause`** from the underlying Git failure for easier diagnosis.

### Changed
- **App chrome**: **`NavHeader`** spans the full width **above** the sidebar and main content; the docked sidebar respects **`--sidebar-top-offset`** so it sits under the header. On **Electron**, traffic-light clearance uses **`electron-traffic-pad`** on the header instead of extra padding on the sidebar header.
- **Ticket search** styling: remove **scale** transforms on focus and on the results popover so the control stays stable and predictable.
- Slightly smaller **sidebar trigger** icon in the header toolbar.
- **`createTicketInColumnAction`** accepts a **`generateTitle`** flag (default on) so flows that set the title client-side can skip the server-side title pass on insert.

### Security
- None.

### Removed
- Drop stale internal doc **`ai/feature-plans/agent-file-change-submission-hardening.md`**.

### Chore
- Bump workspace and `overlord-cli` package versions to 4.6.0; update Yarn lockfile and `.yarnrc.yml`.

## [4.5.0] - 2026-04-18:08:54

### Added
- Commit and push from **Current Changes** in the desktop app: stage all changes, enter a message, and push the current branch to `origin` (with clear errors when Git rejects the operation).
- Optional **AI-generated commit messages** (Gemini) from the aggregate working-tree diff, wired through a server action and desktop IPC that collects `git status` plus a capped diff for the linked project directory.
- Desktop Electron IPC: `getAggregateDiff` and `gitCommitAndPush` for repository workflows from the renderer.
- Request the **`repo` GitHub OAuth scope** (in addition to `user:email`) when linking GitHub so re-authorized accounts can push to repositories that require that scope.

### Fixed
- Kanban board subscribes to **`objectives` realtime** updates and refreshes per-ticket execution metadata so running agents, executed objective counts, and related card state stay accurate while work progresses.

### Changed
- **Terminal** settings: drop the redundant “external terminal only” notice; show the custom activation hotkey field consistently for terminal profiles with updated helper copy.
- **Ticket prompts** and bundled plugins reference the renamed **`overlord-ticket`** skill (replacing `overlord-ticket-workflow`) for Claude, Codex, Cursor, and overlord-cli plugin copies.

### Security
- None.

### Removed
- Delete the old **`overlord-ticket-workflow`** skill files in packaged and repo plugins in favor of **`overlord-ticket`**.

### Documentation
- Refresh plugin READMEs and connector notes for the skill rename; extend internal GitHub connector and Codex/Cursor investigation docs accordingly.

### Test
- Align ticket prompt tests with the `overlord-ticket` skill naming.

### Chore
- Bump workspace and `overlord-cli` package versions to 4.5.0.

## [4.4.0] - 2026-04-17:14:52

### Added
- None.

### Fixed
- Fix Cursor plugin installation from the packaged desktop app by resolving the bundled plugin directory across unpacked ASAR layouts and the overlord-cli plugin copy when a valid `.cursor-plugin/plugin.json` is present.

### Changed
- Include `plugins/cursor` in desktop `electron-builder` `files` and `asarUnpack` so production builds ship the Cursor connector assets next to Claude and other bundled plugins.

### Security
- None.

### Chore
- Bump workspace and CLI package versions to 4.4.0.

## [4.3.0] - 2026-04-17:14:28

### Added
- Ship the Overlord Cursor connector as a local plugin under `~/.cursor/plugins/local/overlord` (manifest, rules, commands, workflow skill, and MCP bridge) via `ovld setup cursor` and the desktop agent-bundle installer.
- Merge Cursor `settings.json` permission allow rules needed for `ovld protocol` and signed `curl` POST usage when installing the Cursor plugin.

### Fixed
- Stabilize mobile Supabase session refresh on iOS by aligning Secure Store keychain accessibility with other secrets, turning off always-on token auto-refresh, and starting or stopping refresh only while the app is active so background reads avoid “User interaction is not allowed” errors.

### Changed
- Replace the legacy Cursor global rule file and standalone slash-command install with the plugin copy flow; remove old `~/.cursor/rules/overlord-local.mdc` and prior Cursor slash command files during install.
- Update onboarding connector copy and CLI settings so Cursor is documented as plugin-based, and bundle health checks point at the plugin manifest path.
- Adjust bundled ticket-prompt workflow hints so Cursor and OpenCode bundle launches reference the right local workflow instead of the Claude-only skill wording.

### Security
- None.

### Test
- Extend ticket prompt tests to cover Cursor and OpenCode bundle instruction modes.

### Documentation
- Refresh connector surfaces documentation for the Cursor plugin layout, bundle eligibility, and context-route `instructionMode` behavior.

### Chore
- Bump workspace and CLI package versions to 4.3.0.
- Sync mobile iOS project and CocoaPods lockfile with dependency updates.

## [4.2.0] - 2026-04-17:10:46

### Added
- None.

### Fixed
- None.

### Changed
- None.

### Security
- None.

### Chore
- Bump workspace and CLI package versions to 4.2.0.

## [4.1.0] - 2026-04-16:13:58

### Added
- Add `delegate` propagation for protocol ticket spawning and follow-up ticket creation.
- Add `--delegate` support in the `ovld protocol spawn` CLI flow.

### Fixed
- Fix follow-up ticket creation and protocol spawn flows to persist the originating `delegate` value on tickets and ticket events.

### Changed
- Update installed agent slash commands and connector instructions to invoke `ovld protocol spawn --agent <agent>` when creating tickets from the conversation.

### Security
- None.

### Test
- Add/adjust CLI and delegate-resolution tests to cover `delegate` propagation.

### Documentation
- Update Claude connector and local bundle instructions for `ovld protocol spawn` usage with explicit `--agent`.

### Chore
- Bump workspace and CLI package versions to 4.1.0.

## [4.0.0] - 2026-04-16:12:40

### Added
- Add keyboard shortcut tooltips to the New Ticket button showing Cmd+N (Mac) or Ctrl+N (Windows/Linux).
- Add support for passing assignedAgent to DiscussTicketButton for improved agent selection based on ticket assignment.

### Fixed
- None.

### Changed
- Update Discuss Ticket button to use assigned agent and model/thinking settings when available.
- Update New Ticket Modal to refresh page after ticket creation instead of navigating to board view.
- Update GEMINI_MODEL from 'gemini-2.5-flash' to 'gemini-3-flash-preview' for improved feed post generation performance and capabilities.
- Claude Connector now works via the v4 plugin model.

### Security
- None.

### Chore
- Bump workspace version to 4.0.0.

## [3.25.0] - 2026-04-15:15:58

### Added
- Add agent and model selection to the New Ticket modal and persist the selection on ticket creation.

### Fixed
- Fix desktop Codex launches to preserve shell execution behavior in both expect and non-expect fallback paths.

### Changed
- Update New Ticket submission flow to persist objective text before generating titles and routing to the board view.

### Security
- None.

### Chore
- Bump workspace and CLI package versions to 3.25.0.

## [3.24.0] - 2026-04-14:16:24

### Added
- Add /tmp file access rules for Bash and Shell agent commands to enable temporary file operations in agent workflows.
- Add agent and model selection to QuickRun modal so tickets are created with the selected agent pre-assigned.
- Add configurable tmux terminal settings with support for multiple terminal emulators (iTerm2, Warp, Ghostty, Alacritty, Kitty, Hyper) and custom launch commands.
- Add stdin streaming support (`--payload-file -`) for larger delivery JSON payloads to avoid creating temporary files.

### Fixed
- None.

### Changed
- Enhance Kanban board components with statusType prop for dynamic background color changes based on column status.
- Improve visual differentiation of task columns in the Kanban interface with enhanced background colors for 'complete' status and new styling for 'review' status.
- Split desktop terminal preferences into separate local and server profiles with distinct tmux configurations.
- Update QuickRun modal to use AgentModelChooserButton and persist selected agent/model to created tickets.

### Security
- None.

### Chore
- Bump workspace version to 3.24.0.

## [3.23.0] - 2026-04-13:10:30

### Added
- Add interactive prompts to the agent permissions installation flow in the CLI setup command.
- Add SSH key installation and verification flow to the mobile ServerDetailScreen with enhanced error handling.

### Fixed
- Fix mobile ticket detail screen to properly persist assigned agent/model changes.
- Improve SSH key password handling and error prompts in server connection flows.

### Changed
- Update HomePage component to improve responsiveness by hiding the "Overlord" title on smaller screens and adjusting button sizes for better mobile user experience.
- Enhance remote ticket launch command with shell profile sourcing for nvm compatibility.
- Improve error handling in remote ticket launch command to retain tmux window on failure with exit code display and user confirmation prompts.
- Update CLI setup command to provide interactive feedback during installation and permissions setup.
- Refactor mobile server detail and ticket detail screens with improved UI state management.

### Security
- None.

### Performance
- Optimize mobile server connection context updates to reduce unnecessary re-renders.

### Test
- None.

### Documentation
- None.

### Chore
- Bump the workspace and CLI package versions to 3.23.0.

## [3.22.0] - 2026-04-05:15:28

### Added
- Add a rebuilt native mobile SSH module for on-device key generation, storage, and server connection verification.
- Add an `ovld update` command that installs the latest CLI release from npm and surfaces update notices in interactive shells.

### Fixed
- Fix Codex bundle launches so they use the correct local workflow instructions when the plugin is installed.

### Changed
- Update the mobile server add and detail flows to use the native SSH path and persist server credentials on-device.
- Split desktop terminal preferences into separate local and server profiles, including tmux-aware launch options.
- Update the CLI help text and settings copy to surface the new `ovld update` workflow.

### Security
- None.

### Removed
- Remove the legacy `secure-enclave-ssh` mobile module in favor of the rebuilt `apps/mobile/modules/ssh` implementation.

### Test
- Add coverage for the CLI update flow and Codex bundle prompt routing.

### Documentation
- Update the CLI docs to mention `ovld update` alongside setup and doctor commands.

### Chore
- Bump the workspace and CLI package versions to 3.22.0.

## [3.21.0] - 2026-04-03:20:33

### Added
- Add a mobile agent/model chooser so tickets can set or update the assigned agent and model directly from the create and detail flows.
- Add native iOS SSH key generation and on-device key installation for mobile server setup, including Secure Enclave fallback support and Tailscale-aware prompts.

### Fixed
- None.

### Changed
- Update the mobile ticket create and ticket detail screens to use the shared agent/model chooser and persist assigned-agent changes in-app.
- Switch mobile SSH setup from the Supabase edge function to the native iOS SSH installer so the phone handles key installation directly.
- Refresh the CLI install wrapper, desktop installer, and `doctor` output to require Node 20+ and point at the versioned standalone CLI copy.
- Update the mobile Servers screen to refresh on focus and show the new server detail and add flows consistently.

### Security
- None.

### Removed
- Remove the `install-ssh-key` edge function in favor of the native iOS SSH installer.

### Refactor
- Split the mobile agent/model selection logic into a reusable chooser plus shared normalization helpers.
- Consolidate the Secure Enclave SSH bridge around optional native loading and a direct public-key installation API.
- Centralize CLI version and wrapper checks in the desktop installer and CLI entrypoint.

### Documentation
- Update the CLI README and desktop CLI settings copy to describe the Node 20+ requirement and wrapper reinstall behavior.

### Chore
- Bump the workspace and CLI package versions to 3.21.0.
- Add a debug iOS device build script for the mobile app and adjust the mobile clean script to use Expo prebuild cleanup.

## [3.20.0] - 2026-04-03:18:30

### Added
- Add a mobile Servers area for listing, creating, and inspecting remote SSH connections.
- Add Secure Enclave-backed SSH key generation on iOS, plus the companion edge function that installs the public key on the target server.

### Fixed
- None.

### Changed
- Update mobile tab routing and server detail layouts so the Servers section behaves like a first-class workspace screen.
- Switch project file-tree loading to Git-aware discovery for both local and remote workspaces so tracked files, hidden tracked files, and nested repo files resolve more reliably.
- Extend the database schema and mobile types to store server connection state, fingerprints, and Secure Enclave metadata.

### Security
- None.

### Refactor
- Centralize Git-backed file-tree enumeration in the shared filesystem helpers and reuse the same fallback behavior on the desktop IPC side.
- Split the mobile SSH server flow into dedicated list, add, and detail screens with a native Secure Enclave module wrapper.

### Test
- Add filesystem coverage for Git-backed project file-tree discovery and path scoping inside repositories.

### Documentation
- None.

### Chore
- Bump the workspace and CLI package versions to 3.20.0.

## [3.19.0] - 2026-04-03:17:58

### Added
- Add an admin model offerings panel that lets admins toggle which synced agent models appear in the app.

### Fixed
- None.

### Changed
- Update the public agent model selector and supporting actions to honor the new `is_offered` flag.
- Load admin agent models alongside access requests and feedback so the admin page can manage model visibility in one place.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- None.

### Refactor
- Simplify agent model catalog helpers into a single offered-model filter and remove the catalog override path.

### Test
- Add coverage for offered-model filtering and the Electron release retention helpers.

### Documentation
- None.

### Chore
- Bump workspace and CLI versions to 3.19.0.
- Tighten CLI publish and Electron release tooling for the standalone package and the macOS arm64 upload flow.

## [3.18.0] - 2026-04-03:15:07

### Added
- Add a mobile quick-create ticket flow with a modal editor, project picker, and priority selection.
- Add mobile ticket-detail drafting so users can create or update the next objective and log the change in ticket history.
- Add richer mobile feed cards with expandable details, realtime inserts, and an in-execution summary for active tickets.

### Fixed
- Keep the desktop app pointed at the correct standalone `server.js` path after packaging.
- Redirect users into the mobile feed after successful sign-in so authentication completes in-app.

### Changed
- Refresh the mobile tickets tab with realtime, foreground, and polling updates, plus a header action that opens ticket creation.
- Update the mobile feed and ticket detail screens to surface richer post metadata, objective history, and linked ticket context.
- Limit the web agent model selector to agents present in the configured catalog.
- Align the workspace scripts and CLI/package metadata with the current mobile and packaging layout.

### Security
- None.

### Refactor
- Extract mobile realtime and executing-ticket loading into reusable hooks and a shared execution section component.
- Simplify the Electron standalone server path construction and clean up Next.js config imports.

### Test
- Expand file-change helper coverage for wrapped bullet-style file paths.

### Documentation
- Update the CLI README to require Node 24 or newer.

### Chore
- Bump the workspace and CLI package versions to 3.18.0.
- Add mobile iOS device and production build scripts at the workspace level.

## [3.14.0] - 2026-03-30:09:29

### Fixed
- added export to agent-launcher.


## [3.13.0] - 2026-03-30:08:29

### Added
- None.

### Fixed
- None.

### Changed
- None.

### Security
- None.

### Refactor
- Tighten metadata typing for protocol attach payloads so ticket metadata handling is safer and more precise.

## [3.12.0] - 2026-03-30:06:36

### Added
- None.

### Fixed
- Force SSH-backed agent launches to allocate a PTY by parsing the configured SSH command, adding `-tt` only when the invocation is `ssh` (or a full path ending in `/ssh`) and lacks `-t`, and rewrapping the command with proper quoting so remote agents retain stdin-enabled terminals.
- Keep Codex remote launches interactive by running the command through an Expect script when available (with a plain fallback) so the prompt context still gets injected over SSH.

### Changed
- Forward workspace=ssh when fetching ticket context, include each project's remote working directory in the attach response, and surface that directory in the generated prompt so SSH-backed sessions land in the expected path.
- Swap to the new `parseSshCommand` helper across the filesystem helpers and agent launcher so every SSH invocation shares the same quoting logic and can default to `ssh` when the destination looks like a host.

### Security
- None.

## [3.10.0] - 2026-03-29:19:20

### Added
- Add SSH-backed project file tree loading so remote workspaces can provide file mentions and linked-file pickers without requiring a local checkout.
- Add a shared workspace file-tree hook for Electron editors and ticket flows so blank tickets, inline objective editing, new ticket, quick run, and conversation replies all resolve files from the active local or SSH workspace.

### Fixed
- Fix project file-tree APIs and Electron IPC fallbacks so projects without an available local directory can still list files from their configured SSH workspace.
- Fix current-changes inspection for workspace-aware projects so status and diff loading consistently reuse the active local or remote workspace payload.

### Changed
- Update ticket board and ticket panel file-mention loading to prefer local directories when available and fall back to configured SSH workspaces when they are not.
- Update project pickers and Electron preload types to carry SSH command and remote working directory metadata where file-tree and CLI flows need it.

### Security
- None.

### Refactor
- Extract shared SSH shell parsing and escaping utilities so Electron IPC and server-side file-tree code build remote commands consistently.
- Centralize workspace file-tree fetching logic instead of duplicating Electron-specific file loading across multiple components.

### Chore
- Bump the package version and CLI package version to `3.10.0`.

## [3.9.0] - 2026-03-29:18:11

### Added
- Make `packages/overlord-cli/bin/ovld.mjs` the canonical bundled CLI entrypoint for both the npm package and the Electron app.

### Fixed
- Fix Electron CLI installation so packaged and development builds both install the bundled CLI from the maintained package path instead of the removed root `bin` copy.

### Changed
- Update app packaging and root package bin mappings to ship the CLI directly from `packages/overlord-cli`.
- Simplify CLI sync logic so release prep only keeps the CLI package version aligned with the app version.

### Security
- None.

### Removed
- Remove the legacy duplicated root `bin/_cli` bundle from app packaging and test coverage.

### Test
- Update CLI auth, credentials, new-ticket, and protocol deliver tests to target the canonical packaged CLI modules.

### Chore
- Bump the package version and CLI package version to `3.9.0`.

## [3.7.0] - 2026-03-29:14:07

### Added
- Add a reusable project execution workspace selector in project settings so Electron projects can switch between local and SSH execution from one control.
- Add Linux ARM64 support to the Electron build and release upload scripts.

### Fixed
- Fix SSH agent launches so remote shells receive the prompt context without relying on local temp files that do not exist on the remote machine.

### Changed
- Update agent launch handling to source common CLI paths and NVM on SSH-backed shells before running remote commands.
- Preserve passed-in workspace settings in the agent split button when project settings are unavailable, keeping launch behavior consistent across contexts.

### Security
- None.

### Chore
- Bump the package version and CLI package version to `3.7.0`.

## [3.6.0] - 2026-03-29:13:11

### Added
- Add npm and npx installation options for the standalone CLI on the downloads page.
- Add SSH-backed Git status and diff support for linked remote workspaces in the current changes view.

### Fixed
- None.

### Changed
- Update the current changes screen to use remote workspace settings when no local directory is available.
- Launch SSH-backed shell commands through the user's interactive preferred shell so aliases and functions resolve correctly.
- Refresh CLI download copy to describe the npm-based install path and direct tarball download separately.

### Security
- None.

### Chore
- Bump the package version and CLI package version to `3.6.0`.

## [3.5.1] - 2026-03-29:11:36

### Added
- Add an `ovld version` command so users can check the installed CLI release.

### Fixed
- None.

### Changed
- None.

### Security
- None.

### Chore
- Bump the package version to `3.5.1`.

## [3.5.0] - 2026-03-29:09:33

### Added
- Add SSH remote workspace support for projects so agents can launch on a remote server with a configured SSH command and remote working directory.
- Route agent launch commands through the configured remote workspace when SSH is enabled.

### Fixed
- None.

### Changed
- Show the configured remote workspace in project settings and project headers so SSH-backed projects are easier to recognize.
- Update ticket launch controls and agent selection UI to respect remote workspace configuration.
- Simplify file-change hunk popovers to surface linked review tickets and their objectives more directly.

### Security
- None.

### Chore
- Bump the package version to `3.5.0`.

## [3.4.0] - 2026-03-27:18:13

### Added
- Capture the model used when an objective starts executing so ticket history can preserve the launch context.
- Prefill the agent model picker with cached and optimistic model data so ticket actions load faster and avoid empty states.

### Fixed
- Mark executed objectives as complete and keep ticket board and panel agent tracking derived from objective history instead of the removed `recent_agent` field.
- Reject unsupported `Accept: text/event-stream` probes on the MCP proxy while preserving JSON discovery responses for legacy clients.
- Keep ticket board agent state aligned with the latest objective and active session data during live updates.

### Changed
- Replace ticket `recent_agent` usage with objective-derived agent tracking across boards, lists, and ticket panels.
- Persist the latest objective agent alongside the running agent display so the UI reflects the active execution source more accurately.

### Security
- None.

### Removed
- Drop the legacy `recent_agent` ticket field in favor of objective history.

### Deprecated
- None.

### Performance
- None.

### Refactor
- None.

### Test
- Add regression coverage for MCP GET transport handling and header forwarding.

### Documentation
- None.

### Chore
- Bump the package version to `3.4.0`.

## [3.3.0] - 2026-03-27:14:00

### Added
- Show recent cached feed posts on the Electron offline screen so users can review prior activity while disconnected.

### Fixed
- None.

### Changed
- Rearchitected such that objectives are now the atomic element of work
- Rework the Electron offline screen into a clearer two-column layout with a dedicated ticket section and updated retry messaging.
- Sort queued offline tickets newest-first so the pending list matches the latest submissions.


### Security
- None.

### Chore
- Bump the package version to `3.3.0`.

## [3.2.0] - 2026-03-27:13:05

### Added
- Bundle the Overlord Codex plugin with workflow skills, branded assets, and MCP tools so the desktop app can install a durable local Codex integration under `~/.codex/plugins/overlord`.

### Fixed
- Resolve feed, ticket panel, markdown, and file-change links through a shared external-link helper so editor/file links open correctly in Electron and unsupported links stay suppressed in the web UI.
- Allow the desktop shell to launch additional editor protocols, including `vscode:`, `cursor:`, `windsurf:`, `zed:`, `subl:`, `txmt:`, `antigravity:`, and `idea:`.

### Changed
- Move the Codex plugin install target from `~/plugins/overlord` to `~/.codex/plugins/overlord` and update marketplace registration, status copy, and packaging to match.
- Update the plugin metadata, desktop app docs, and onboarding copy to describe the bundled local workflow skill and managed Codex install surface.
- Pass workspace and editor context through markdown, feed, and live ticket components so link resolution can adapt to the active environment.

### Security
- None.

### Documentation
- Update the connector surface reference and desktop app guide to document the Codex plugin install path and managed files.

### Test
- Add coverage for external-link resolution across HTTP URLs, repo-style file links, and custom editor schemes.

### Chore
- Bump the package version to `3.2.0`.

## [3.1.0] - 2026-03-27:12:12

### Added
- Add an Electron Quick Run flow so users can create a blank ticket, choose the project plus agent/model, and launch work immediately from the new shortcut-driven modal.
- Add durable Cursor local workflow support with a managed `~/.cursor/rules/overlord-local.mdc` bundle, installer coverage, onboarding copy, and settings controls alongside the existing slash commands.
- Add a Local/Cloud mode switch to web ticket actions so Discuss and Copy Prompt generate the correct prompt context for browser-based agents.

### Fixed
- Respect organization-specific ticket status names across ticket creation, attach/connect, protocol update/deliver flows, conversation replies, and executing-ticket feed queries instead of hard-coding `draft`, `execute`, and `review`.
- Fix Cursor file-change links so they open the target file directly instead of trying to use the broken VS Code diff URI format.
- Surface install, repair, and removal errors for the local Overlord plugin in Settings so failed actions report what went wrong.

### Changed
- Expand launcher and prompt handling so Cursor participates in the local bundle/rules workflow while web actions can switch cleanly between local CLI and cloud MCP prompt variants.
- Update the new-ticket flow in Electron to capture agent/model preferences at creation time and allow copy-only agent actions without requiring local directory access.

### Security
- None.

### Documentation
- Replace the Codex-only connector parity guide with a unified connector surfaces reference covering Claude Code, Codex, Cursor, Gemini CLI, and OpenCode.

### Test
- Add regression coverage for Cursor file-change links so `cursor://file` continues to open direct file paths.

### Chore
- Bump the package version to `3.1.0` and the agent bundle version to `1.7.0`.

## [3.0.0] - 2026-03-27:11:08

### Added
- Add local Overlord chat plugin management for Codex, including install, repair, uninstall, and migration away from the legacy bundle-based setup.
- Add a linked accounts settings page so users can connect GitHub, review OAuth identities, and disconnect extra sign-in methods.
- Add realtime ticket objectives rendering so the ticket panel reflects objective updates without requiring a refresh.

### Fixed
- Enforce a single execute status and a single review status per organization so workflow states stay canonical.
- Remove legacy Codex bundle guidance from the setup flow and prompt context in favor of the plugin-based path.

### Changed
- Rework Codex onboarding, setup copy, and prompt instructions around the Overlord chat plugin and local permission rules instead of `~/.codex/AGENTS.md`.
- Move ticket objective editing into a dedicated realtime section and keep executed objectives visible in the panel history.
- Update ticket search and protocol context loading to align with the new agent-specific launch flow.

### Security
- None.

### Chore
- Bump the package version to `3.0.0`.

## [2.16.0] - 2026-03-26

### Added
- None.

### Fixed
- Fix blank ticket card input clearing timing to prevent value persistence after submission.
- Adjust bottom blank ticket card positioning in kanban columns for better visual alignment.

### Changed
- Move shimmer animation from ticket panel header to individual objective items during execution for more granular visual feedback.
- Update system notification action buttons to use LoadingButton component for better async operation feedback.
- Optimize ticket search queries by removing objective field from selection to improve performance.
- Update ticket title display logic to use the title field directly instead of falling back to collapsed objective text.

### Security
- None.

### Chore
- Bump the package version to `2.16.0`.

## [2.15.0] - 2026-03-26:12:37

### Added
- Persist ticket-specific agent, model, and thinking preferences as structured JSON so each ticket can carry its own launch configuration.
- Add a safe Electron `openExternal` bridge and reusable `ExternalLink` component so HTTP and HTTPS links in markdown content and live artifacts open correctly in the desktop shell.

### Fixed
- None.

### Changed
- Make ticket boards, ticket lists, and the ticket panel prefer the assigned ticket agent when choosing the active agent shown in headers, cards, and launch controls.
- Update agent selection controls to write the chosen model preference back to the ticket immediately while still keeping the user’s global default in sync.
- Convert ticket artifact and markdown links to the shared external-link wrapper so browser and Electron behavior stays consistent.

### Security
- None.

### Chore
- Bump the package version to `2.15.0`.

## [2.14.0] - 2026-03-26:09:21

### Added
- Add AI-generated ticket titles for long objectives, with a per-user toggle in Application settings and a deterministic fallback for short or disabled cases.
- Add offline ticket creation in the Electron shell, including queued submissions that sync automatically when the app comes back online.
- Add cached feed and project data for offline views, plus cached recent feed posts on the offline screen.
- Add feed pagination with infinite scroll so the Feed page can load more posts beyond the initial batch.

### Fixed
- None.

### Changed
- Show objective titles in the ticket panel and backfill generated titles onto executed objectives so ticket history is easier to scan.
- Let blank ticket cards support a save-and-open shortcut, making it faster to create a ticket and jump straight into it from the board.
- Rework the settings navigation from “Appearance” to “Application”, keep theme controls there, and show Terminal & IDE settings with a clear non-Electron notice.
- Update the initial Feed page load to fetch a smaller first page that matches the new lazy-loading behavior.

### Security
- None.

### Chore
- Bump the package version to `2.14.0`.

## [2.13.0] - 2026-03-25:18:00

### Added
- Introduce the ticket scheduling system: add a `schedule` table plus `tickets.due_datetime` and `tickets.schedule_id`, indexes, RLS policies, and validation constraints so recurring ticket metadata is persisted safely.
- Ship the scheduling engine, Supabase actions, and schema that validate recurrence rules, upsert/clear schedules, preview future due dates, and automatically spawn the next ticket when a scheduled item is completed.
- Build scheduling UI controls (calendar view, schedule editor, due date editor, badges, and helpers) that let agents set up daily/weekly/monthly recurrences directly from ticket panels and list/board views.

## [2.12.0] - 2026-03-25:09:35

### Added
- None.

### Fixed
- Treat agent bundle template content changes as stale even when the version string is unchanged, so update notifications resurface after prompt edits.

### Changed
- Simplify the CLI settings modal's local agent configuration into a flatter panel and tighten the agent prompt update notification fingerprinting so dismissals only hide the exact stale bundle state.
- Keep the home page divider styling aligned with the newer gradient utility.

### Security
- None.

### Chore
- Bump the package version to `2.12.0`.

## [2.11.0] - 2026-03-25:08:56

### Added
- Add an admin-only submissions dashboard: a new `early_access_requests` table persists every request before notifying via Resend, and the sidebar exposes an `/admin` link for `ADMIN_EMAIL` that lists early access submissions and product feedback pulled via the service role.
- Add list of executing tickets to the feed page.

### Fixed
- Remove `objective` from tickets model and updated all ticket creation interfaces to use the `objectives` table.
- Update early access and feedback notifications to send from `ovld@notifications.cooperativ.io` and to `ovld-access@cooperativ.io` / `ovld-feedback@cooperativ.io` so the messages land in the new inboxes.
- Add artifact download to agent templates.
- Improve agent permissions configration so that it loads on app updates

### Changed
- Deliver/review transitions now invoke the `generate-feed-post` Supabase Edge Function (Gemini 2.5) to synthesize summaries from ticket events, change rationales, human actions, and spawned tickets so the new Feed page stays up to date.
- Ticket objectives now live in the `objectives` table instead of the `tickets` row: all creation/update APIs, Overlord flows, and CLI handlers write to that table, the legacy column is dropped via migration/seed updates, and the new `/api/tickets/[ticketId]/delete-if-empty` endpoint lets clients purge drafts that never received content.

### Security
- Restrict access to `early_access_requests` with row-level security that only allows the configured `ADMIN_EMAIL` to select, update, or delete submissions, keeping the backlog private to the admin.

## [2.10.0] - 2026-03-24:12:00

### Added
- Add `ovld protocol discover-project` and a matching protocol endpoint so agents can resolve the correct project from a working directory.

### Fixed
- Automatically resolve spawned tickets and ticket-creation requests against the current working directory when `--project-id` is omitted, so repository-scoped work lands in the intended project by default.

### Changed
- Extend protocol spawn and ticket creation payloads with `workingDirectory`, letting the server match against each project's configured local working directory before falling back to the first project.
- Update the CLI help and agent bundle guidance to explain the new project-discovery workflow and the `--working-directory` override.

### Security
- None.

### Chore
- Bump the package version to `2.10.0` and the agent bundle version to `1.6.0`.

## [2.9.0] - 2026-03-24:11:33

### Added
- Upgrade CLI login to a browser-based OAuth PKCE flow with a loopback callback listener, replacing the older device-code approval path.

### Fixed
- Preserve loaded and freshly refreshed Kanban tickets when the board receives new data, so board state no longer resets while users page or refresh.

### Changed
- Rework the Kanban board controls into a dedicated toolbar and keep project filtering, column visibility, and project settings in one place.
- Simplify current-changes file-change presentation by removing draft-specific badges and ordering entries strictly by newest timestamp.
- Remove transcript-ingestion plumbing from protocol updates and deliveries, along with the related transcript debug surface in the ticket panel.

### Security
- Tighten CLI authentication with PKCE, explicit callback validation, and clearer failure handling when the agent token is invalid or revoked.

### Removed
- Remove the transcript-ingest API, CLI helper, and transcript-ingestion validation schema now that the pipeline is retired.

### Chore
- Bump the package version to `2.9.0`.

## [2.8.0] - 2026-03-23:17:20

### Added
- Add a hard-refresh control to the nav header (plus new `app:reload` IPC) so Electron windows and PWAs can refresh beyond cached service workers.
- Expand the About page so update prompts list running agent sessions with stop buttons and toast feedback, ensuring installers can close active agents before updating.

### Fixed
- None.

### Changed
- The Diff pane now nests secondary review tickets in an accordion and only surfaces review-phase rationales, with the view model filtering tickets accordingly.

### Security
- None.

### Chore
- Bump the package version to `2.8.0`.

## [2.7.0] - 2026-03-23:16:29

### Added
- Build the transcript ingestion pipeline: add `agent_transcript_events` and `change_rationale_drafts` (with RLS and migrations), expose `/api/protocol/transcript-ingest`, and ship a new `bin/_cli/transcript-ingestion.mjs` (plus the CLI counterpart) that tails local Claude/Codex logs, infers high-signal events, promotes output into ticket events, and seeds draft change rationales.
- Introduce `tickets_created` tracking in `feed_posts` plus shipment of delegate metadata through `protocol.spawn`, giving feed posts structured references to spawned tickets and letting the CLI feed card render them via the new column.

### Fixed
- None.

### Changed
- File-change pages now include `change_rationale_drafts`, mark the draft rows with a badge, and keep drafts ordered after committed rationales; the validation schema and types support the new transcript ingestion payload.
- Feed cards (and the Gemini post generator) now show tickets created during the session, and spawn/protocol state records delegates and parent-session events so feeds can report which tickets came out of each agent run.

### Security
- None.

### Test
- Add regression suites for transcript parsing/draft generation plus the delivery guard scenarios that cover outside-git repos, `--skip-file-change-check`, absolute/backslash paths, and credential precedence; ensure no agent-facing instructions mention `file_changes` artifacts.

### Chore
- Bump the package version to `2.7.0`.

## [2.6.0] - 2026-03-23:14:08

### Added
- Let `ovld protocol` commands read summaries, questions, artifacts, or entire payloads from disk (`--summary-file`, `--question-file`, `--artifacts-file`, `--payload-file`) while guarding against conflicting flag combinations so large inputs stay shell-friendly but remain validated before dispatching.
- Surface every managed bundle/slash-command file in the CLI Settings modal and wire an “Open in Finder” button via the new `app:reveal-file` IPC helper (and preload/typings) so agents can inspect the exact files that the bundle or slash-command manages.

### Fixed
- None.

### Changed
- Make `resolveAuth` prefer the `AGENT_TOKEN` environment variable over stored credentials so CLI(installed) sessions can override cached tokens immediately.

### Security
- None.

### Test
- Add regression tests that spin up temporary git repositories to cover clean/missing/mismatched change rationale paths, demonstrate the new `--payload-file` workflows, and ensure the CLI honors `AGENT_TOKEN` ahead of saved credentials.

### Chore
- Bump the package version to `2.6.0`.

## [2.5.0] - 2026-03-23:13:30

### Added
- Add a git-aware preflight to both `bin/_cli/protocol.mjs` and the published CLI binary that inspects `git status --porcelain`, ensures every delivery with local changes includes at least one matching `changeRationales.file_path`, and exposes `--skip-file-change-check` for explicitly opt-ing out.

### Fixed
- None.

### Changed
- Agent bundle templates (bundle `1.5.0`) and the ticket prompt remind agents to cover every meaningful git-tracked change in `changeRationales`, discourage sending `file_changes` artifacts on deliver (use `next_steps`, `note`, etc.), clarify that the `user_follow_up` event does not need to fire on the initial ticket message, and reiterate that deliveries must represent local file changes.

### Security
- None.

### Test
- Add regression tests that spin up temporary git repositories to prove the CLI accepts clean repos, rejects deliveries missing `changeRationales`, rejects mismatched paths, and succeeds once a matching rationale path is provided.

### Chore
- Bump the package version to `2.5.0`.

## [2.4.0] - 2026-03-23:10:49

### Added
- Persist structured `changeRationales` payloads in the new `file_changes` table (with its migration, indexes, trigger, and RLS policies) so protocol handlers and the MCP tools store per-file rationale rows instead of bundling them into generic artifacts.

### Fixed
- When an agent posts an update after a ticket has already moved into `review` or `complete`, automatically move the ticket back to `execute`, resume the agent session, and emit a `ticket_reopened` event so follow-up work resumes cleanly.
- `auth/check-token` now rejects revoked or expired tokens in a single branch so polling clients reliably see invalid credentials.

### Changed
- Ticket Live’s CLI quickstart shows the attach command until objectives have executed and then flips to the resume/restart lines so the panel always matches the current session state.
- Every ticket mutation now revalidates both `/u` and `/projects`, and read/unread toggles raise errors on failure, keeping the board views synchronized after any write.

### Security
- Project file APIs (`/file-tree`, `/file-changes`, `/file-attribution`) now assert organization membership before returning data so file metadata can’t leak across teams.
- Electron renderers now launch with `sandbox: true`, Next requires `NEXT_PUBLIC_SUPABASE_URL`, applies HSTS/Permissions headers, and a new migration revokes TRUNCATE/REFERENCES/TRIGGER grants from the anonymous and authenticated roles to shrink their privileges.

### Chore
- Bump the package version to `2.4.0`.

## [2.3.0] - 2026-03-22:14:38

### Added
- Introduce Sunpeak MCP app for ticket card, including resources, tools, and a gap analysis document.

### Changed
- Relocate agent token management to MCP & Cloud Agents and refine project API data access.
- Increase feed size.

### Fixed
- Fix `@mentions` in blank Kanban cards on `/u` board by using default project working directory.

### Chore
- Bump the package version to `2.3.0`.

## [2.2.0] - 2026-03-21:11:21

### Added
- Add top-level `ovld create` and `ovld prompt` commands with numbered project selection, and let `prompt` launch an agent immediately after ticket creation.
- Add `GET /api/protocol/projects` so protocol clients can enumerate projects for the signed-in organization.
- Add individual read/unread actions on Kanban cards so ticket notifications can be managed per card.

### Fixed
- None.

### Changed
- Resolve ticket creation against the selected project's organization, preventing cross-organization ticket creation and making the project choice the source of truth.
- Update CLI help, settings guidance, and packaging docs to reflect the new project-selection flow.
- Improve feed post generation with stricter Gemini JSON handling so titles, bodies, tradeoffs, tags, files, and human action items are normalized before saving.

### Security
- Reject ticket creation when the chosen project does not belong to the caller's organization.

### Documentation
- Refresh the packaging guide to describe `ovld create` instead of `ovld tickets create`.

### Chore
- Bump the package version to `2.1.0` and update the Supabase function deploy command to match the current release flow.

## [2.0.0] - 2026-03-21:09:55

### Added
- Add a dedicated `/feed` page that displays Gemini-synthesized agent activity posts with actionable follow-ups (`human_actions`).
- Restructure documentation into a new route group with a dedicated layout and sidebar, allowing for easier navigation and separation from the core application layout.
- Add an integrated documentation page (`/docs`) and introduce application analytics tracking.

### Changed
- Improve Demo UX by updating the demo board description and skipping terminal window rendering when no terminal output lines are present.
- Add an automatic server-side redirect to the onboarding flow if the authenticated user has no organizations or projects.
- Move the main app out of the shared root layout to properly support the independent documentation design.

### Fixed
- Unify path normalization in file change parsing by automatically stripping trailing file annotations from paths, ensuring file change links resolve securely.

### Chore
- Bump the package version to `2.0.0` to reflect these major additions and navigational refactors.

## [1.21.0] - 2026-03-20:15:25

### Added
- Introduce a dismissible **Announcement Bar** for logged-in users to share timely project updates.
- Refactor the **Current Changes explorer** (Electron) with added support for line-level addition/deletion statistics (lines added/removed) on each modified file.
- Add support for viewing untracked file stats in the Electron filesystem IPC.

### Changed
- Refine the **Landing Page** (`app/page.tsx`) with a more prominent link to the documentation.
- Optimize the `FileListPane` and `DiffPane` in Current Changes for clearer hunk-level metadata and better rendering.
- Update the `CliQuickstart` to show the latest `ovld connect` and `ovld restart` commands across different agent types.

### Fixed
- Resolve the issue where the file attribution and rationale counts in `FileListPane` were incorrectly calculated.
- Address minor layout flickers in `KanbanBoard` when dragging tickets across columns.

### Chore
- Bump the package version to `1.21.0` to reflect these updates to the Current Changes explorer and Announcement Bar.

## [1.20.0] - 2026-03-20:14:45

### Added
- Extract the "Tools and Acceptance Criteria" section from `TicketPanelContent` into its own `TicketToolsAndCriteria` component to improve code organization and reusability.
- Introduce the `TicketStatusSelect` custom UI component to provide a consistent and improved ticket status management interface.
- Implement an **Early Access** enrollment flow and a dedicated **Product Demo** interactive page.
- Expose the `/early-access` and `/demo` routes in the public routing configuration so visitors can access landing materials without logging in.

### Fixed
- Resolve the Safari login stall issue by adding a hard redirect fallback in the authentication form.
- Address a model reasoning bug in the `agent-launcher` service when preparing Electron launches.
- Improve the reliability of the MCP protocol route by addressing potential edge-case issues in `app/api/mcp/route.ts` and updating relevant tests.
- Tweak the `MentionableTextarea` and `MarkdownContent` components to resolve minor rendering and positioning artifacts.

### Changed
- Major redesign of the landing page (`app/page.tsx`) to introduce the product demo and early access call-to-actions.
- Refactor the `TicketDocumentUpload` component to use a collapsible Accordion interface, aligning it with other ticket management UI elements.
- Update `TicketExecutionTargetSelect`, `TicketProjectSelect`, and other ticket management components to use the new custom status and project selectors for a more unified UI.
- Refine local font loading in `(auth)` and main layouts to ensure stable typography during application transitions.

### Chore
- Bump the package version to `1.20.0` to reflect the latest refactor, bug fixes, and feature additions.

## [1.19.0] - 2026-03-19:15:37

### Added
- Introduce the `record_change_rationales` MCP tool and protocol action so agents can persist structured, hunk-level rationale records for meaningful code changes during a session.
- Add a centralized `agent-model-catalog` and `agent-models.json` to manage supported AI providers and models across the stack, replacing hardcoded lists in the UI.
- Implement server-side logic in the `mcp-server` Edge Function and `record-change-rationales` handler to store structured rationales in the database.
- Wire up local font loading in the `(auth)` layout to ensure consistent typography during login and signup flows when offline.

### Fixed
- None.

### Changed
- Update `update` and `deliver` protocol handlers to accept optional `changeRationales` payloads, allowing agents to submit rationales alongside their regular progress reports.
- Refine the `AgentSplitButton` and CLI settings to consume the new dynamic model catalog for provider and model selection.
- Update `bin/ovld` CLI commands (`attach`, `protocol`, `setup`) to support the revised protocol schemas and model data.
- Update agent instructions in the ticket prompt to treat `changeRationales` as structured ticket content persisted in the `change_rationales` table, rather than just local file references.
- Force `display: block` for local fonts in both main and auth layouts to ensure text renders immediately with the correct typography.

### Security
- None.

### Chore
- Bump the package version to `1.19.0`.

## [1.18.0] - 2026-03-19:14:38

### Added
- Add a tooltip to the Default model selector so the “Default” option explains it reflects the last model used in the terminal.

### Fixed
- Port the file mention dropdown into `document.body` so it floats above overflowing Kanban columns instead of being clipped.

### Changed
- None.

### Security
- None.

### Documentation
- Reinforce the AGENT instructions by explicitly forbidding agents from creating a new branch before they start work or commit.

### Chore
- Bump the package version to `1.18.0` so the release metadata matches this changelog entry.

## [1.17.0] - 2026-03-19:09:37

### Added
- Ship the new `AgentModelSelector` UI inside the AgentSplitButton and CLI settings so agents can pick their preferred provider, model, and thinking/effort level before launching work.
- Add an `agent_models` catalog plus the `sync-agent-models` Supabase Edge Function that refreshes Anthropic, OpenAI, and Gemini model lists (and prunes stale entries) for the selector to consume.

### Fixed
- None.

### Changed
- Pass the selected model and thinking flags through the launch helpers so desktop/WebCLIs launch the agent binary with the same preferences that are stored in the CLI settings and user config.

### Security
- None.

### Chore
- Bump the package version to `1.17.0` so the release metadata matches this changelog entry.
- Seed scripts now insert the default `jake@c.com` user in auth so local environments start with a known account.

## [1.16.0] - 2026-03-19:08:13

### Added
- Implement user profile image management and expand settings with dedicated user pages for profile, sessions, and agent tokens.

### Fixed
- Prevent spurious auto-logouts during tab switching by rate-limiting session validation.
- Resolve login stuck at "signing in" by replacing server action `redirect()` with client-side navigation.

### Changed
- Update the default Kanban card background gradient and selected state border styles.

### Security
- None.

### Refactor
- Consolidate Kanban board ticket state management to a single source of truth, removing `useOptimistic` and `realtimeOverrides`.

### Chore
- Bump the package version to `1.16.0` to align the release metadata with this changelog entry.

## [1.15.0] - 2026-03-18:19:23

### Added
- Ship `packages/overlord-cli` with the Electron build (include it in both `files` and `asarUnpack`) so the desktop release bundles the `overlord`/`ovld` CLI helpers.

### Fixed
- None.

### Changed
- Load Space Grotesk and IBM Plex Mono from the bundled `public/fonts` assets so the UI no longer depends on remote Google Font downloads and renders consistently offline.
- Tidy the ticket prompt protocol sections by removing the redundant base URL line, keeping the instructions focused on attaching, updating, and the ticket ID itself.

### Security
- None.

### Chore
- Bump the package version to `1.15.0` to align the release metadata with this changelog entry.

## [1.14.0] - 2026-03-18:16:49

### Added
- Add a dedicated OAuth callback API endpoint to connect Claude Code integrations, allowing users to securely authenticate and store session tokens.
- Add ticket search capabilities to the protocol API, enabling external agents to discover relevant work items.
- Implement file change parsing and direct diff link generation to provide smoother reviewing experiences in the UI.

### Fixed
- Prevent CLI configuration errors by cleanly closing active OAuth callback servers, avoiding EADDRINUSE conflicts.

### Changed
- Soften global white color styling and add a drop shadow to the left side panel for improved visual separation and a more premium aesthetic.
- Auto-focus the organization name input field when the component loads so new users can begin setup immediately without extra clicks.
- Refactor font loading and update the settings modal dimensions/navigation for a cleaner layout.

### Security
- None.

## [1.13.0] - 2026-03-18:15:50### Added
- Add a user-selectable editor scheme preference (VS Code, Cursor, Zed, Windsurf, or custom) in the Appearance settings so file links across the app open in your preferred editor.
- Add an Electron drag region to the authentication layout so the login window can be moved by its header when running in the desktop app.

### Changed
- Refine the onboarding wizard UX with smoother transitions and cleaner state management when creating workspaces and projects.
- Relocate and separate the web onboarding flow to a dedicated route to ensure a consistent experience across web and desktop clients.

### Removed
- Clean up unused API routes and legacy engineering templates for old Claude Code and Codex integrations.

### Chore
- Bump the package version to `1.13.0`.

## [1.12.0] - 2026-03-18:12:51

### Added
- Auto-detect the active Claude Code session ID for `ovld protocol attach` and `ovld protocol update` so native session tracking works without manually passing `--external-session-id`.

### Fixed
- None.

### Changed
- Update the managed agent-bundle instructions and protocol payload guidance to include `externalSessionId` and the current `ovld protocol` workflow.

### Security
- None.

### Chore
- Bump the package version to `1.12.0` and the managed bundle version to `1.2.0`.

## [1.11.0] - 2026-03-18:12:10

### Added
- Launch a dedicated full-page onboarding experience for web signups that walks new visitors through workspace creation, a desktop download/skip step, and first-project setup (including project color and working-directory guidance) before redirecting to `/u`, keeping the modal-based tutorial reserved for Electron sessions.
- Add a CLI-install checkpoint and a visual ticket-flow explainer to the desktop wizard so Electron users can install `ovld` in-app and see how tickets progress from creation to terminal launches before they start working.

### Fixed
- None.

### Changed
- Auto-redirect web visitors who lack an organization or project to `/onboarding`, keep electron clients on the modal flow, and point homepage CTAs plus auth links at `/signup` so new accounts go through the guided setup.
- Align the authentication actions so login/signup share the `next` parameter, sign-outs return to `/login`, and email confirmation flows now reroute new users to onboarding after verifying their address.
- Make `ovld protocol spawn` create tickets in `draft` status by default to keep spawned work awaiting review.

### Security
- None.

### Documentation
- Update AGENTS.md and the ticket prompt guidance to spell out the new “no git commits unless explicitly requested” rule and reinforce that delivering a ticket closes the work, matching the updated tutorial expectations.

## [1.10.0] - 2026-03-17:11:02

### Added
- Add the reusable `CliQuickstart` section inside the Ticket Live panel so agents can copy `ovld connect` and `ovld restart` commands for their preferred agent (including native resume snippets when a session ID is available) without leaving the ticket view.
- Expose a managed Slash Command installer from the CLI settings modal by wiring an `agentSlash` IPC service, status tracking, and action button so Claude, Cursor, and Gemini can add or remove durable `/connect`, `/load`, and `/spawn` helpers with one click alongside the prompt bundle installer.

### Fixed
- None.

### Changed
- Rebuild the CLI settings content around the published `ovld` alias: list the new `ovld protocol` and `ovld restart` commands, show exact file paths touched by each plugin, and tie the plugin action button to the revised status badges so the settings guidance now matches the shipped binary and install layout.
- Install and manage the slash-command files together with the Claude bundle manifest so the button in Settings, the installer service, and the Electron bundle remain in sync about which files are deployed.
- Move the CLI quickstart into an accordion-backed component and refresh the ticket live commands to rely on `ovld connect`/`ovld restart` plus the native resume helper so human agents always see the most accurate restart instructions.

### Security
- None.

## [1.9.0] - 2026-03-17:10:06

### Added
- Persist the native MCP `external_session_id` across the stack (database migration, Supabase functions, update/deliver routes, and the MCP proxy header) and add the `--external-session-id` flag so agents can store the native session identifier and show precise `ovld resume`/native restart commands.
- Introduce the Configure Agent Permissions onboarding step plus the Electron `agentPermissions` service/IPC so Claude, Codex, Cursor, and Gemini can install persistent allow rules for `ovld protocol` and `curl -sS -X POST` without repeated prompts.

### Fixed
- None.

### Changed
- Switch every user-facing instruction (ticket prompts, onboarding steps, CLI guides, AGENTS templates, and slash-command installers) to mention the `ovld` CLI alias and the new home-directory-based command files so the docs match the published binary and install locations.
- Rework the Ticket Live CLI quickstart to live inside an accordion, default to `ovld` commands, and leverage the new native resume helper plus `mcp-session-id` so the panel shows the correct restart command for the current agent session.

### Security
- None.

## [1.8.0] - 2026-03-16:16:01

### Added
- Replace the old Ask button with a multi-agent Discuss button so tickets can launch the ask flow with the preferred agent, showing agent-specific loading states in Electron and copying the right prompt when running in the browser.
- Add a CLI Quickstart section inside the Ticket Live panel that lists per-agent connect and restart commands (including native resume snippets when available) with easy copy buttons so human agents can reconnect or resume a session without leaving the ticket UI.

### Fixed
- None.

### Changed
- Rework the CLI settings page into an agent plugin chooser that groups prompt/skill bundles and slash-command installers, surfaces bundle install/repair/uninstall actions, and keeps the per-agent slash-command docs/copy buttons handy for each option.
- Clarify ask-mode guidance across the bundle templates, prompt-context builder, and protocol prompts by introducing the new opening phrase, explaining when to save notes, and spelling out the expected user_follow_up event behavior depending on whether the session is in Ask mode or regular work.

### Security
- None.

### Documentation
- Rewrite the MCP Authentication & Client Integration guide around the current surface matrix, describe the OAuth-protected `/api/mcp` proxy plus the `/api/auth/token` exchange, document the device-code endpoints, and call out the expected environment variables so teams know which flows apply to OAuth-capable clients versus headless runtimes.

## [1.7.0] - 2026-03-16:14:52

### Added
- Add a managed Claude/Codex bundle installer (shared service, IPC hooks, preload bindings, onboarding step, and settings controls) so the desktop app can merge the Overlord skill/hook content, track a versioned manifest, and repair or uninstall the durable configuration without overwriting user files.
- Add `ovld setup <agent|all>` and `ovld doctor` commands that reuse the same bundle manifest so standalone CLI users can install or validate the agent bundles exactly like the Electron flow.

### Fixed
- Retry JWKS verification without the `authenticated` audience before falling back to `supabase.auth.getUser()` so MCP OAuth JWTs issued to custom client IDs still resolve correctly.

### Changed
- Introduce an `agent-capabilities` resolver, have Electron/CLI detect the bundle manifest, pass an `instructionMode` flag to `/api/protocol/context`, and emit the slim bundle prompt when that mode is requested so the reusable workflow guidance lives in the installed skill or AGENTS.md while remaining compatible with legacy requests.

### Security
- None.

### Documentation
- Add annotation metadata (titles, hints, visibility) to every MCP tool plus the refreshed ticket-card UI resource so hosts and clients can describe each tool and UI snippet more clearly.

### Chore
- Bump the package version to `1.7.0` to align the release with this changelog entry.

## [1.6.0] - 2026-03-14:12:45

### Added
- Write CLI-friendly `~/.ovld/credentials.json` alongside the Electron credentials file so `npx overlord` commands reuse the exact agent token saved by the app without requiring a separate login flow.

### Fixed
- None.

### Changed
- Make `resolveAuth()` prefer `AGENT_TOKEN` from the environment before falling back to saved credentials so temporary overrides (like CI overrides or dev env tweaks) are respected by both the CLI and Electron launchers.

### Security
- None.

### Chore
- Bump the package version to `1.6.0` to align the release with this changelog entry.

## [1.5.0] - 2026-03-14:12:16

### Added
- Add a browser-hidden `electron-drag-region` element to the auth layout so the login window can be moved via its title bar when running inside Electron.

### Fixed
- Preserve the user’s existing Claude `PermissionRequest` hooks when writing the Overlord notification hook so models, plugins, and other preferences aren’t overwritten.

### Changed
- `writePermissionRequestHookFiles` now reads `~/.claude/settings.json`, keeps any existing hook entries, and appends the Overlord hook before writing the merged data to the temp file, making the hook writer a more polite consumer.

### Security
- None.

### Chore
- Bump the package version to `1.5.0` to match this release.

## [1.1.0] - 2026-03-14:09:47

### Added
- None.

### Fixed
- Normalize agent token handling so whitespace-trimmed or missing tokens always fall back to the organization-scoped key before launching agents, preventing blank bearer tokens from hitting the protocol API.

### Changed
- Introduce a shared `normalizeAgentToken` helper and use it in `AgentSplitButton`, `AskTicketButton`, and Electron’s launch preparation so every launch path trims and validates the provided token consistently.

### Security
- None.

### Documentation
- Add the agent launch reliability testing engineering plan to clarify the testing goals and coverage needed around tokens, flags, and Electron contracts.

### Chore
- Bump the package version to `1.1.0` to align with this release.

## [1.0.0] - 2026-03-14:08:53

### Added
- Show toast errors when agent launches or the Ask flow fails to open the configured terminal so users get actionable guidance about their terminal settings and agent tokens.

### Fixed
- Make the Electron terminal IPC launch helper wait for shell commands, add `open -a` fallback variants, and bubble precise failure details for most terminal targets (Warp, Ghostty, Alacritty, Kitty, Hyper, cmux, and custom apps) so the external terminal launch path is more reliable and debuggable.

### Changed
- Navigate to new projects through `buildProjectPath` so the Creator modal always uses the shared project route builder instead of hand-constructing the URL.

### Security
- None.

### Chore
- Bump the package version to `1.0.0` to align the release with the changelog entry.

## [0.63.0] - 2026-03-13:16:25

### Added
- None.

### Fixed
- Resolve CLI/Electron login failures caused by proxy or rewrite hosts by using the platform URL returned from `/api/auth/config` when exchanging Supabase tokens and persisting credentials, ensuring the saved `platform_url` matches the actual Overlord origin.

### Changed
- Derive the MCP endpoint (`/api/mcp`) from the current platform base URL so local MCP requests automatically follow the same host when `NEXT_PUBLIC_OVERLORD_MCP_URL` isn’t supplied.

### Security
- None.

## [0.62.0] - 2026-03-13:17:45

### Added
- Guide new users through a five-step tutorial (create workspace/project, download the desktop app, install/configure an agent, and read the ticket flow) that auto-opens for fresh accounts or incomplete runs and remembers progress so you can pick up where you left off.
- Surface CLI agent setup instructions (install command, `npx overlord setup`, and your default agent token) inside the wizard and persist the preferred agent so future visits default to that vendor.
- Add a “Take Tutorial” action to the sidebar rail so you can revisit the wizard at any time, starting at the post-setup steps once you already have a project.

### Fixed
- None.

### Changed
- Wrap the app in a tutorial provider that loads onboarding state, refreshes the UI after workspace creation, and auto-launches the modal when the profile indicates an incomplete tutorial or a new account.

### Security
- None.

### Chore
- Add an `profiles.onboarding` JSON column via a migration so the tutorial can store completed steps, skip status, and preferred agent metadata.

## [0.60.0] - 2026-03-13:16:00

### Added
- Add file-to-ticket attribution API (`/api/projects/[projectId]/file-attribution`) and integrate it into the Electron-only Current Changes explorer so you can see which tickets touched each modified file and filter the file list by ticket.

### Fixed
- None.

### Changed
- Current Changes view now loads change rationales and file attributions together, shows the active Git branch and a refresh control, and keeps the selected file stable when the status list updates.
- Electron agent launches now always open in an external terminal by generating a temporary launch script and sending it to your configured terminal app, with support for window/tab/custom-hotkey behaviors.

### Security
- None.

### Removed
- Remove the embedded terminal workspace and in-app terminal panels; all agents now run in your external terminal.

### Refactor
- Refactor `ExecutionTargetBadge`, Kanban ticket components, and related UI to clarify agent vs human execution targets and reduce rendering complexity.

### Chore
- Simplify `electron-builder` configuration to package `dist-electron`, Next.js standalone output, and CLI binaries without special-casing native modules.

### Added
- New `ExecutionTargetBadge` component to visually differentiate agent and human execution targets on ticket cards with color-coded theming.
- New `prompt-context` module with structured context building functions (`buildPromptContextSections`, `renderPromptContextMarkdown`) that organize ticket metadata, guidance, history, artifacts, and shared state into a coherent prompt structure.
- Agent session external URL storage to track where a session was launched from (e.g., IDE, web, CLI).
- Enhanced protocol attach handler with expanded context gathering: recent events, project metadata, and user profile information.
- Support for execution target (agent/human) in ticket prompt context and MCP tools.

### Fixed
- None.

### Changed
- SettingsModal now responsive on mobile with dropdown navigation instead of sidebar, improving usability on small screens.
- Ticket components (Kanban and list cards) now display execution target badges to clarify agent vs. human work allocation.
- Protocol attach and update handlers gather richer context from database queries, enabling more informative agent prompts.
- MCP handlers updated to use new prompt context module for consistent formatting across attach, update, and context operations.

### Security
- None.

## [0.58.0] - 2026-03-13:12:00

### Added
- Add error boundary pages for `/projects`, `/u`, and `/account` routes so unhandled errors show a recovery UI instead of crashing the page.

### Fixed
- Fix `InlineEditField` memory leak: replace `setTimeout` with `requestAnimationFrame` for post-drop cursor positioning.
- Fix `TicketPanelContent` crash: destructure parallel query results individually so a single failed sub-query no longer crashes the entire panel.

### Changed
- None.

### Security
- Replace permissive `using(true)` RLS policies on `agent_sessions`, `artifacts`, `shared_state`, and `ticket_events` with proper org-scoped policies using the `is_ticket_org_member()` helper; AGENT+ role required for writes, MANAGER+ for deletes.
- Add `assertTicketAccess()` guard to all ticket mutation server actions (`updateTicketField`, `updateTicketStatus`, `updateTicketPriority`, `updateTicketExecutionTarget`, `setTicketProject`, `deleteTicket`, `markSessionDisconnected`) to verify user authorization before mutating.
- Harden MCP edge function: replace wildcard CORS with an origin allowlist (cooperativ.io, ovld.ai, Vercel previews, localhost), add server-side input validation for all tool calls, sanitize error messages to prevent internal details leaking to clients, and enforce a 30-minute session timeout that marks stale sessions as disconnected.
- Add request tracing via `x-request-id` header (client-provided or auto-generated) and include the reference ID in error responses for debugging.
- Support `x-organization-id` header for multi-org OAuth JWT users in MCP.

## [0.57.0] - 2026-03-12:19:22

### Added
- Add lightweight `protocol connect`, `load-context`, and `spawn` endpoints plus matching `ovld protocol` subcommands so agents can start tracking a ticket without reloading its context, fetch a ticket’s context read-only, or spawn a new ticket and session mid-conversation.
- Add a rationale-aware Current Changes explorer in Electron that loads local Git status/diffs, surfaces change rationales per file, lets you filter files by ticket, and shows hunk-level popovers tied to each rationale so reviewers understand why each edit exists.

### Fixed
- None.

### Changed
- Make the project settings toggle switch between the Work Board and Current Changes view and stay disabled (with a tooltip) until a linked working directory exists, preventing navigation to the Electron-only explorer when no repo is configured.

### Security
- None.

### Documentation
- Document the new mid-session operations (`connect`, `load-context`, `spawn`) in the ticket prompt and CLI settings (Claude/Cursor/Gemini slash-command templates) so agents know which command to run, what each call returns, and when to report the returned `SESSION_KEY`/`TICKET_ID`.

## [0.56.0] - 2026-03-12:18:30

### Added
- Add lightweight `protocol connect`, `load-context`, and `spawn` endpoints with matching CLI subcommands/flags so agents can start tracking a ticket, inspect context, or create+connect a new ticket without reloading the entire deliver context.
- Persist per-user hidden Kanban columns for the shared ticket view by caching preferences in localStorage when no project is selected, keeping board layouts consistent across scopes.

### Fixed
- None.

### Changed
- None.

### Security
- None.

### Documentation
- Document the new mid-session `connect`, `load-context`, and `spawn` workflows inside the ticket prompt guidance so agents know which CLI commands to run during a session.

## [0.55.0] - 2026-03-12:15:30

### Added
- Enhance ticket creation and loading functionality in Kanban components with improved card interactions and state management.

### Fixed
- Fix change rationales never being recorded due to required hunks validation blocking submissions.

### Changed
- None.

### Security
- None.

## [0.54.0] - 2026-03-12:10:06

### Added
- None.

### Fixed
- None.

### Changed
- None.

### Security
- None.

### Chore
- Treat `node_modules/node-pty` as an `extraResources` asset in `electron-builder.yml` so the native addon ships with packaged Electron builds without unpacking the rest of `node_modules`.

## [0.53.0] - 2026-03-12:09:01

### Added
- Persist per-user, per-project board preferences (hidden Kanban columns and preferred board/list view) in the new `project_user_preferences` table so column visibility and the selected view survive refreshes and stay scoped to each project.
- Surface ticket card context menu actions on both Kanban and list layouts so you can raise/reduce priority or mark a card as unread without leaving the board, with the column menu propagating the same unread/reading logic.
- Extend the Change Explorer diff view to call the new `/api/projects/[projectId]/change-rationales` endpoint, show counts for linked change rationales next to each file, and reveal hunk-level cards that describe the rationale label, why/impact text, and related ticket/event/session.
- Add `--change-rationales-json` and `--change-rationales-file` flags to `ovld protocol update`/`deliver` plus supporting prompt docs so CLI agents can submit structured change rationales from inline JSON or files.

### Fixed
- None.

### Changed
- Tickets board and view toggles now read from the per-project preferences when rendering, and the controls write back through the new server actions so every project remembers its hidden columns and last-used view when you return.
- The new ticket modal in Electron loads local project files for `@path` mentions whenever a working directory is linked, keeping mention suggestions in sync with the repository you are working in.
- Overlord protocol payload validation and prompt helpers now require metadata keys to be strings and drop the redundant `mcpOnly` flag so the MCP configuration guidance stays simpler.

### Security
- None.

## [0.52.0] - 2026-03-11:22:22

### Added
- Add Change Explorer feature for Electron: inspect all uncommitted changes from linked working directories with per-file unified diff rendering.
- Add Current Changes page at `/projects/[projectId]/current-changes` (Electron-only) to browse and review local repository modifications.
- Add Change Rationale system to track why changes were made, with explicit attribution to tickets and agent sessions.
- Add API routes for submitting and retrieving change rationales during agent `update` and `deliver` operations.
- Add ticket 'is_read' status to improve ticket tracking and provide visual indicators in Kanban and list views.
- Add global hotkey for toggling into and out of Current Changes view while in Electron.

### Fixed
- Fix Kanban and list view state management for ticket read/unread status tracking.

### Changed
- Enhance Electron IPC filesystem API with improved directory validation and error handling.
- Update agent protocol documentation to guide agents on submitting change rationales with structured metadata.
- Update project settings section with new entry point for accessing Change Explorer.
- Update hotkeys page documentation to include new keyboard shortcuts for Change Explorer navigation.

### Security
- None.

## [0.51.0] - 2026-03-11:14:32

### Added
- Add TicketsViewControls component for unified ticket view state management across list and board layouts.
- Add database-backed agent configuration system with per-user persistence and multi-device sync support.

### Fixed
- Fix Kanban card collapse behavior to properly maintain expanded/collapsed state.

### Changed
- Refactor layout and loading components for improved user experience with enhanced onboarding state handling.
- Replace UserTicketsLoading component with TicketsBoardLoadingSkeleton for better visual consistency.
- Refactor InlineEditField to improve file mention path handling with better state synchronization.
- Update RootLayout styles and session management in proxy utility for improved public path handling.
- Update documentation URLs and settings references to reflect new domain configuration.
- Migrate agent configuration storage from localStorage to database for persistent, multi-device support.

### Security
- None.

### Refactor
- Refactor Kanban board and related components (KanbanBoard, KanbanColumn, BlankTicketCard, TicketListView, TicketsBoardContent) for better organization and maintainability.

### Chore
- Update package.json dependencies and Electron configuration.
- Enhanced ElectronLoginScreen with improved authentication flow.

## [0.50.0] - 2026-03-09:09:48

### Added
- Add Electron filesystem IPC handlers for validating linked directories and listing project files from the local machine.
- Add shared local-directory access hook used by ticket action buttons to verify Electron working-directory availability before launching agents.

### Fixed
- Fix objective file mention suggestions and linked-file loading in Electron by sourcing project files through local IPC instead of server-side filesystem lookups.
- Fix ticket board and panel mention-file loading in Electron requests so local-only directories no longer trigger server-side file scans.
- Fix stale ticket and project views after ticket, project, status, and Everhour mutations by revalidating current `/projects` and `/u` route paths.

### Changed
- Update ticket panel working-directory resolution to preserve configured local directories in Electron while keeping web behavior unchanged.
- Standardize server action cache revalidation to use shared project/ticket path builders instead of legacy organization-scoped routes.

### Security
- None.

## [0.49.0] - 2026-03-07:20:00

### Added
- Add OAuth runtime configuration module (`lib/auth/oauth-runtime.ts`) for centralized environment variable handling across auth routes.
- Add backward compatibility support for legacy single-client OAuth environment variables in OAuth configuration resolution.

### Fixed
- None.

### Changed
- Refactor auth routes (`/api/auth/config` and `/api/auth/token`) to use centralized OAuth runtime configuration module.
- Improve OAuth configuration error messages to indicate support for legacy environment variable names.

### Security
- None.

### Removed
- Remove obsolete feature planning documents.

## [0.48.0] - 2026-03-07:18:00

### Added
- Begin thin wrapper migration for Electron: production builds now load hosted platform URL instead of local Next.js server.
- Add runtime environment allowlist to Electron production build path, restricting generated env vars to public configuration only.

### Fixed
- Fix list ticket layout in TicketListCard and TicketListView for consistent rendering.

### Changed
- Improve time entries screen with enhanced EverhourNavTimer and TimeEntriesPanel components.
- Update Next.js configuration for optimal build performance.
- Refactor Electron platform URL resolution to separate dev (localhost) and production (hosted) boot paths.

### Security
- Begin removing service-role credentials from Electron production build artifacts as part of thin wrapper migration.

### Removed
- Remove local Next.js server startup from packaged Electron production builds.

## [0.47.0] - 2026-03-07:12:00

### Added
- Add BlankTicketCard component for creating new tickets directly in Kanban columns.
- Add UserTicketsSettingsPanel for managing ticket view preferences.
- Add OrganizationOnboardingModal for new organization setup flow.
- Add MentionableTextarea component for handling @file mentions in ticket objectives.
- Add multi-status filtering in ticket list view to filter by multiple ticket statuses simultaneously.
- Add TicketsViewToggle component for switching between Kanban and list views.

### Fixed
- Fix OAuth public client configuration by ensuring client_secret_hash is never null, improving compatibility with GoTrue versions that require non-nullable strings.

### Changed
- Refactor InlineEditField to use the extracted MentionableTextarea component for better code organization.
- Update Kanban and ticket list components for improved filtering and rendering logic.
- Update EverhourNavTimer and TimeEntriesPanel for enhanced Everhour integration.
- Update ElectronLoginScreen authentication flow.

### Security
- None.

### Removed
- Remove AllTasksHeaderSection component.

## [0.46.0] - 2026-03-06:21:04

### Added
- None.

### Fixed
- None.

### Changed
- Add Everhour integration to the navigation header and ticket panel.
- Add a dropdown menu to the ticket panel with copy ticket ID and delete ticket actions.

### Security
- None.


## [0.45.0] - 2026-03-06:19:33

### Added
- None.

### Fixed
- None.

### Changed
- Update AboutPage to label the local Overlord URL as "Local URL" instead of "OVERLORD_URL" for improved clarity.

### Security
- None.

## [0.44.0] - 2026-03-06:16:11

### Added
- Add a default agent trigger selector to the Agents & MCP settings and persist the choice so the launch command bar, agent split buttons, and live launches always honor the stored preference.
- Document keyboard shortcuts via a new Hotkeys settings page and surface Cmd/Ctrl+F (focus ticket search) plus Cmd/Ctrl+N (open the new ticket modal) so those actions stay reachable without reaching for the mouse.

### Fixed
- Ensure the Electron terminal manager starts zsh, bash, and fish as login shells so local environment variables and dotfiles are available before running commands.
- Remove the `h-dvh` restriction from the Kanban scroll container so columns can flex to the available viewport height without cutting off content.

### Changed
- Default the tickets page to list view on mobile, hide the board/list toggle there, and keep desktop views respecting saved preferences so small-screen users land in a layout that feels native.

### Security
- Refresh Electron sessions via a new `auth:refreshSession` IPC handler that uses the OAuth token endpoint, persist the rotated refresh token, and trigger proactive refreshes before expiry so the Electron app no longer signs users out when Supabase tries to refresh.

## [0.43.0] - 2026-03-06:14:06

### Added
- Add Everhour sync guidance and a `Disconnect` workflow inside the project settings modal: the new controls describe the 1:1 naming requirement, include a button that calls `disconnectProjectFromEverhourAction`, and remember the linked `everhour_project_id` so the UI reflects whether the project is connected.

### Fixed
- Electron token refresh handling and storage.

### Changed
- Project layout now fetches `everhour_project_id` and passes it through the modal so the Everhour controls never lose sight of whether a project is linked.
- Tickets that land in review-type statuses (either from deliver or updates) are now given the lowest `board_position` so they always appear at the top of the review column; the same logic runs in the MCP deliver/update handlers.
- The root metadata and web manifest include the Apple touch icons, startup image, and 256/512/1024 artwork so Overlord presents correctly as a PWA/Apple home-screen app.

### Security
- Electron auth now listens for Supabase `TOKEN_REFRESHED` events and exposes an `auth:saveRefreshToken` IPC method so refreshed tokens persist across restarts and the app can restore sessions without forcing another login.

## [0.41.0] - 2026-03-05:14:10

### Added
- None.

### Fixed
- Improve CLI auth error handling with clearer messaging for port conflicts during OAuth callback, detecting EADDRINUSE errors and suggesting remediation steps.

### Changed
- Update authentication redirect flow to send users to `/u` (My Tasks board) after sign-in instead of onboarding page, assuming users with existing accounts are familiar with the system.
- Refactor agent-related components with improved type safety and cleaner prop handling in AgentSplitButton, AskTicketButton, and CopyTicketPromptButton.
- Added agent config management by adding it to the database
- Enhance TerminalProvider initialization and state propagation for improved reliability.
- Refine settings panel layout and MCP configuration UI for better visual hierarchy.

### Security
- None.

### Chore
- Minor dependency and internal type definition updates.

## [0.40.0] - 2026-03-05

### Added
- Support for extra CLI flags in agent launch configuration (e.g., `--enable-auto-mode`) passed from local agent settings.

### Fixed
- Fix layout overflow issues in TerminalWorkspace and SidePanelProvider with improved flex container sizing.
- Improve main content area layout with proper `overflow-hidden` and flex properties for better resizable panel integration.

### Changed
- Enhanced agent launcher service to accept and apply custom CLI flags for all agent types (Claude, Codex, Cursor, Gemini).
- Refine TerminalProvider to propagate flags parameter through agent launch API.
- Update TerminalWorkspace resizable panel layout for better vertical space management.

### Security
- None.

### Removed
- None.

### Chore
- Update Electron IPC and preload types for terminal agent launch signatures.
- Improve type definitions for terminal launch configuration with flags support.

## [0.37.0] - 2026-03-05:00:00

### Added
- Add PWA (Progressive Web App) manifest and service worker configuration for offline support and installability.
- Add local agent configuration helper (`lib/helpers/local-agent-config.ts`) for improved agent environment setup.
- Add PWA component suite (`components/pwa/`) with service worker integration and caching strategies.

### Fixed
- Fix error boundary component handling for improved error reporting and recovery.
- Improve Electron authentication flow with better credential handling.

### Changed
- Update Electron authentication gate and login screen for improved session management.
- Refine agent split button and ticket button components for better UX.
- Update ticket prompt generation and context handling.
- Enhance MCP agent configuration page with improved settings layout.

### Security
- None.

### Removed
- None.

### Chore
- Update Supabase configuration for PWA and service worker support.
- Update TypeScript configuration and type definitions for Electron platform.
- Update package dependencies and yarn lock.

## [0.36.0] - 2026-03-04

### Added
- PWA (Progressive Web App) skill configuration.
- Enhanced MCP protocol handler with improved artifact and context operations.

### Fixed
- None.

### Changed
- Updated skills index and configuration files for Overskill integration.

### Removed
- None.

### Chore
- Update package dependencies and Overskill configuration.

## [0.34.0] - 2026-03-04

### Added
- MCP settings improvements and enhanced protocol handlers.

### Fixed
- Fix MCP protocol handlers to properly support artifact management and context operations.

### Changed
- Refactor authentication flow to use new (auth) layout directory pattern.
- Update MCP protocol routes and handlers with improved validation and error handling.
- Consolidate OAuth-based authentication pages under new auth layout structure.
- Improve proxy utilities for MCP request handling.

### Removed
- Remove legacy authentication pages (device login, confirm-email, electron-login, standalone login, oauth consent, onboarding).
- Remove MCP_SETUP.md documentation in favor of integrated settings panel.
- Remove legacy UpdatesPage settings component.

### Chore
- Update package dependencies and protocol validation schemas.

## [0.33.0] - 2026-03-04

### Added
- None.

### Fixed
- Fix ResizablePanel defaultSize and minSize props in TerminalWorkspace and TerminalPanel to use percentage strings instead of bare numbers, correcting react-resizable-panels v4 behavior where numbers are interpreted as pixels.
- Fix TerminalWorkspace layout with proper flex container adjustments and overflow handling for correct height and scrolling behavior.
- Fix Kanban board scrolling and layout by changing overflow-x-auto to overflow-x-scroll with proper height constraints.
- Fix SidePanelProvider height handling to ensure full-height layout with proper flex constraints.
- Improve TerminalPanel styling with better dark theme support using darker background colors and white text.

### Changed
- Remove legacy organization-scoped routing (`[organizationId]/projects/*`) as projects are now accessed via organization-agnostic `/projects/:projectId` routes.
- Refactor root layout to use h-full instead of h-dvh for improved flex container behavior with parent constraints.
- Update TerminalPanel header styling with better visual hierarchy and active state indication.
- Change default terminal mode from 'embedded' to 'external' and default launch mode from 'window' to 'tab' in Electron settings.
- Simplify Kanban board and column padding for better visual consistency.
- Add explanatory comment in TerminalWorkspace documenting react-resizable-panels v4 sizing requirements.

### Removed
- Remove legacy organization-scoped project and ticket routes and their corresponding pages/layouts.

### Chore
- Bump package version to `0.33.0`.

## [0.32.0] - 2026-03-04

### Added
- None.

### Fixed
- Fix ResizablePanel defaultSize and minSize props in TerminalWorkspace and TerminalPanel to use percentage strings instead of bare numbers, correcting react-resizable-panels v4 behavior where numbers are interpreted as pixels.
- Fix TerminalWorkspace layout with proper absolute positioning and flex container adjustments for correct height handling.
- Fix layout CSS classes in root layout and sidebar for proper minimum height constraints and overflow handling.

### Changed
- Add explanatory comment in TerminalWorkspace documenting react-resizable-panels v4 sizing requirements.

### Chore
- Bump package version to `0.32.0`.

## [0.31.0] - 2026-03-03:23:27

### Added
- Add OAuth client configuration in seed files for CLI and Electron login flows.
- Enhanced agent token management with improved endpoint handling and security validation.
- Add device-code polling throttling with `next_poll_at` tracking to prevent rapid request bursts.

### Fixed
- Fix copy prompt button functionality and styling.
- Fix `getPlatformURL` resolution for web deployment contexts.

### Changed
- Enhance Supabase OAuth integration with improved token validation and credential handling.
- Update auth flows to properly handle OAuth client configuration from seed data.
- Improve device-code authentication polling behavior with throttling enforcement.

### Security
- Enforce stricter validation of Supabase OAuth access tokens and client_id claims in token exchange endpoints.
- Add device-code poll throttling with HTTP 429 responses to prevent enumeration attacks.

### Chore
- Bump package version to `0.31.0`.

## [0.30.0] - 2026-03-03:18:00

### Added
- Add account settings area with a profile overview and an `Agent tokens` tab that lists active CLI and desktop tokens with revoke controls.
- Add Electron desktop login flow powered by Supabase OAuth PKCE, including an `/electron-login` screen, loopback callback handler, and encrypted `agent_token` storage for the desktop app.
- Add `/oauth/consent` Supabase OAuth consent page that shows the requesting client, requested scopes, and approve/deny actions for browser-mediated logins.
- Add device-code login endpoints (`/api/auth/device/request` and `/api/auth/device/poll`) so CLIs and agents can initiate browser-based authorization using short user codes.

### Fixed
- None.

### Changed
- Route web login through an updated `AuthForm` that carries an optional `next` path through sign-in and sign-up, improving redirects back to OAuth consent and other guarded pages.
- Require authenticated desktop sessions in Electron by wiring `ElectronAuthGate` into the root layout so unauthenticated users are redirected to the new login screen before accessing the dashboard.
- Use per-user, organization-scoped `agent_tokens` with expiry when generating ticket launch commands in the ticket panel, instead of loosely scoped tokens.

### Security
- Harden `/api/auth/token` to only accept Supabase OAuth access tokens that contain a non-empty `client_id` claim from the configured allowlist and belong to a user who is a member of an organization before issuing or reusing an `agent_token`.
- Enforce device-code poll throttling by adding a `next_poll_at` column and returning HTTP 429 `slow_down` responses when clients poll faster than the allowed interval.
- Store Electron desktop `agent_token` credentials encrypted via `safeStorage` in a locked-down `~/.ovld/electron-credentials.json` file instead of plaintext.
- Enforce revocation/expiry checks and best-effort `last_used_at` updates when resolving `agent_tokens` in the MCP edge function so cloud agents only authenticate with active tokens.

### Documentation
- Document the Overlord auth contract and supported credential types/flows in `docs/agent-authorization.md`, covering web, Electron, CLI, MCP, and local secret boundaries.

### Chore
- Bump package version to `0.30.0`.

## [0.29.0] - 2026-03-03:17:05

### Added
- Add a resizable, embedded terminal workspace to the Electron app root layout, allowing users to run agents and commands directly inside the dashboard with a persistent terminal area.
- Add `TerminalWorkspace` layout component with `ResizablePanelGroup` integration for splitting the main view between dashboard content and the embedded terminal.
- Add support for "Embedded" vs "External" terminal modes in Electron, configurable via Settings and automatically persisted.

### Fixed
- Fixed a button type error in `AgentSplitButton.tsx` by providing correctly typed event handlers for standard button actions.
- Improve CLI environment resolution by making `OVERLORD_BASE_URL` optional and deriving defaults based on the active runtime context.

### Changed
- Update `TerminalProvider` to manage multiple terminal sessions, active session tracking, and seamless switching between embedded and external launch modes.
- Refactor `AppLayout` to wrap main content in the new `TerminalWorkspace` so the terminal area is shared across all dashboard views.
- Update agent launch instructions and prompts to include explicit directives for agents running in the context of the Overlord protocol.

### Chore
- Bump package version to `0.29.0`.

## [0.28.0] - 2026-03-03:09:24

### Added
- Add browser-based OAuth consent flow at `/auth/authorize`, showing requesting client details, scopes, and approve/deny actions for CLI/Electron sign-ins.
- Add OAuth PKCE login for the CLI: `ovld auth login` now opens a loopback browser flow, discovers config via `/api/auth/config`, exchanges Supabase tokens for an organization-scoped `agent_token` via `/api/auth/token`, and persists credentials.

### Fixed
- None.

### Changed
- Enable the Supabase OAuth server and point its consent UI to the new Next.js authorize page.
- Ticket prompt copy actions now pass context so local vs cloud prompts include the appropriate protocol instructions.

### Security
- Enforce agent token lifecycle with `revoked_at`/`expires_at` columns and validation, rejecting revoked or expired tokens and recording `last_used_at` on protocol requests.
- Require organization membership before issuing CLI agent tokens during the OAuth exchange flow.

### Documentation
- Serve a full MCP usage guide on GET to the MCP edge function base route, including workflow steps, artifact handling, and the tool reference; CORS now permits GET for this endpoint.

### Chore
- Bump package version to `0.28.0`.

## [0.27.0] - 2026-03-02:19:05

### Added
- Add stable `clientTicketId` generation for optimistic ticket creation on the Kanban board, ensuring ID consistency across client and server.
- Add wait-and-retry logic in `TicketPanelContent` when loading newly created tickets to handle database propagation delays in optimistic flows.

### Fixed
- Fixed Everhour time-entry resolution and error parsing stability.
- Fixed missing draft-objective handling in agent launch (protocol context) and prompt copy actions, providing clearer error feedback.

### Changed
- Refactored `createTicketInColumnAction` to accept an optional pre-assigned `ticketId` from the client.

### Security
- None.

### Chore
- Bump package version to `0.27.0`.

## [0.26.0] - 2026-03-02:16:30

### Added
- Add `AnnouncementBar` component to the root layout for app-wide user notifications and announcements.
- Add `AskTicketButton` to the ticket header, enabling agents to be launched in "ask" mode (Electron) or copying an ask-mode prompt to the clipboard (web) without starting a full run.
- Add `launchMode` parameter (`'ask'` or `'run'`) to agent launch and terminal provider flows so callers can control whether the agent is prompted to ask clarifying questions or execute immediately.
- Add `TicketPanelLive` composite component with a live activity feed (`LiveActivityFeed`), storage artifact viewer (`LiveArtifacts`), shared-state inspector, and `AgentSessionBadge` with animated pulse indicator for running sessions; includes a "Force stop" control that marks an attached session as disconnected.

### Fixed
- Namespaced the localSecret to prevent collisions with other instances of Overlord running on the same machine.

### Changed
- Ticket prompt generation now requires a saved draft objective; if none exists an error is returned rather than falling back to the ticket's stored objective or title, ensuring agents always receive a deliberate, up-to-date objective.
- Remove the ticket title from the agent instructions header — the prompt now identifies the ticket by reference ID only (`**ref**`) to avoid stale or misleading title text in long-running sessions.
- Update `CopyTicketPromptButton` to handle touch events alongside click events for improved mobile and hybrid-input device support.
- Show the "Run agent" bar in `LaunchCommandBar` only when running inside Electron so web users are not presented with controls that require the desktop app.

### Security
- None.

### Chore
- Bump package version to `0.26.0`.

## [0.25.0] - 2026-03-02:15:15

### Added
- Add MCP server configuration snippets for Claude Code, Cursor, Codex CLI, and ChatGPT in Settings to simplify agent integration.

### Fixed
- Improve CLI `ovld auth login` to handle non-JSON or malformed responses with clearer error messages and snippets of the received content.
- Fixed copybutton on web

### Changed
- None.

### Security
- None.

### Refactor
- None.

### Chore
- Bump package version to `0.25.0`.

## [0.24.0] - 2026-02-27:15:00

### Added
- Add Kanban card context menu with "Mark unread" so users can reset waiting-response and review indicators and get notified again for that ticket.
- Add shadcn-style context menu UI component for card and future right-click actions.

### Fixed
- None.

### Changed
- Rename `PLATFORM_URL` to `OVERLORD_URL` throughout the system (env, CLI, protocol, Electron, docs) so configuration and agent prompts use a single, consistent variable name.
- Refactor SettingsModal and ticket prompt layout and copy for improved clarity and functionality.

### Security
- None.

### Refactor
- Refactor ticket prompt building and SettingsModal structure; extend ticket-waiting-response helpers with `markTicketReviewUnread` and `markTicketWaitingUnread` for context-menu-driven unread state.
- Align CLI auth and protocol modules to use `OVERLORD_URL` for platform URL resolution.

### Test
- Expand ticket-waiting-response tests to cover mark-unread behavior and timestamp helpers.

### Chore
- Bump package version to `0.24.0`.

## [0.23.0] - 2026-02-27:10:00

### Added
- Add Agents & MCP, Cloud agents & MCP, and CLI sections in Settings with a running-agents overview, stop controls, and guided setup for cloud IDE agents.
- Add per-user agent token management backed by database tables so Claude Code, Codex, Cursor, and Gemini can authenticate to Overlord via environment and domain snippets.
- Add a ticket prompt copy action that builds a full Overlord protocol prompt using the latest ticket state, saved custom instructions, and an MCP endpoint derived from Supabase.

### Fixed
- None.

### Changed
- Change ticket creation, update, and board reorder actions to share helpers for resolving projects/organizations, placing new tickets at the end of Kanban columns, and revalidating board and detail routes so `/u` and project views stay in sync.
- Standardize environment helpers and ticket prompt generation to derive platform and MCP URLs from `OVERLORD_URL`, `NEXT_PUBLIC_SITE_URL`, and Supabase configuration so agents copy prompts that work across deployments.

### Security
- Store personal agent tokens in a dedicated table scoped to organizations and expose rotation from Settings so leaked tokens can be revoked while keeping access tied to Overlord membership and roles.

### Refactor
- Refactor ticket actions around shared helpers for board revalidation, status-change event logging, and objective execution so Kanban behavior stays consistent across create, update, reorder, and delete flows.

### Chore
- Bump package version to `0.23.0`.
- Regenerate Supabase `database.types.ts` typings and environment helpers to match the latest schema and configuration.

## [0.22.0] - 2026-02-27:09:00

### Added
- Add Supabase Storage-backed ticket document uploads with a drag-and-drop section in ticket details, including listing, download, and delete for per-ticket documents.
- Add protocol artifact upload endpoints for prepare-upload, finalize-upload, and get-download-url that issue signed Supabase Storage URLs and create artifact records tied to tickets and sessions.
- Add MCP `artifact_prepare_upload`, `artifact_finalize_upload`, and `artifact_get_download_url` tools to the Overlord MCP server so cloud agents can manage storage-backed artifacts without calling REST directly.

### Fixed
- None.

### Changed
- Update ticket protocol prompt instructions to highlight MCP-based artifact tools and recommend MCP over raw REST when available.
- Align ticket detail panel layout around a dedicated Documents section co-located with objectives and acceptance criteria so humans can see uploaded files alongside agent activity.

### Security
- Sanitize artifact filenames and enforce ticket-scoped storage prefixes before issuing signed upload or download URLs to protect against path traversal and cross-ticket access.
- Require organization membership and AGENT/MANAGER/ADMIN roles for artifact write operations and validate membership for read operations across protocol and MCP artifact flows.

### Refactor
- Share artifact access, storage-path helpers, and signed upload URL builders between protocol API routes and Supabase MCP handlers to keep authorization and storage semantics consistent.

### Chore
- Bump package version to `0.22.0`.

## [0.21.0] - 2026-02-26:23:15

### Added
- Add Claude PermissionRequest hook integration for Electron agent launches so tool permission prompts also surface as Overlord notifications.

### Fixed
- Fix Electron agent launches that previously failed when the ticket context markdown endpoint returns an error by falling back to agent-specific context commands from the protocol API.

### Changed
- Change Electron agent launcher to always use a per-launch Claude settings file that registers the PermissionRequest hook alongside the ticket context markdown file.

### Security
- Ensure PermissionRequest hook HTTP calls include the local runtime secret header when available so notifications respect the tightened local protocol security model.

### Refactor
- Refactor Electron agent launcher around shared protocol header helpers and context-command fallback handling to improve resilience and error reporting.

### Chore
- Bump package version to `0.21.0`.

## [0.20.0] - 2026-02-26:22:45

### Added
- Add skeleton loading states for My Tasks (`/u`) and project tickets routes so boards feel responsive while data loads.
- Add a local runtime metadata file and per-instance shared secret so the Electron app and CLI can mutually authenticate local protocol traffic.
- Add a standalone `overlord-cli` npm package plus sync/publish scripts so the CLI can be installed via npm or used outside the desktop bundle.

### Fixed
- None.

### Changed
- Change CLI protocol and ticket commands to derive their platform URL and auth headers from the local runtime metadata when available, reducing misconfiguration between the desktop app and CLI.

### Security
- Require a `X-Overlord-Local-Secret` header on protocol and device-code auth endpoints when running locally, rejecting requests that do not present the per-instance secret.
- Store the local runtime secret and platform URL in a locked-down `~/.ovld/runtime.json` file and only honor it when file permissions and ownership are secure.

### Refactor
- Centralize CLI auth header construction and local runtime resolution through shared helpers in the credentials and Electron local-runtime services.

### Chore
- Bump package version to `0.20.0`.
- Add `cli:sync` and `cli:publish` scripts for keeping the published CLI package in sync with the bundled binary.

## [0.19.0] - 2026-02-26:21:15

### Added
- Add `ovld attach [ticketId] [agent]` CLI subcommand for interactive ticket search and agent launching, making it easy to start a session without knowing the ticket ID upfront.
- Add per-agent slash command setup cards in Settings → CLI so users can install a `switch-ticket` slash command or rule for Claude Code, Codex CLI, Cursor, and Gemini CLI with a one-click copy of the install command.
- Persist the user's default project selection in the `profiles` table so the chosen default project survives browser sessions and is shared across devices.

### Fixed
- None.

### Changed
- Show project color dot alongside project name in the Default Project chooser dropdown for quicker visual identification.
- Display the installed `ovld` version number in the CLI settings section (e.g., `ovld v0.19.0 installed at …`).
- Add "Automatically updated when the desktop app updates." note under a current CLI install to set expectations.

### Security
- None.

### Refactor
- Extend `getCliInstallStatus` to detect stale CLI wrappers (pointing to an old app bundle path) and surface an "outdated" warning with a "Reinstall CLI" prompt instead of silently showing the wrong version.

### Chore
- Add `default_project_id` foreign-key column to `profiles` table migration.
- Bump package version to `0.19.0`.

## [0.18.0] - 2026-02-26:20:10

### Added
- Add user-level profile custom agent instructions stored in a `profiles` table with per-user row-level security and surfaced in a new Settings “Customization” tab.
- Add support for injecting saved custom instructions into ticket prompts for protocol context and “Copy prompt” flows so agents automatically honor team conventions and priorities.
- Add a shared `--timeout` flag (and `OVERLORD_TIMEOUT` env var) across protocol CLI subcommands so request timeouts are configurable instead of hanging indefinitely in constrained runtimes.
- Add a `--artifacts-file` flag to `ovld protocol deliver` to load artifacts from a JSON file, avoiding brittle shell-escaping for large inline JSON payloads.

### Fixed
- Fix ticket search organization scoping in the API route by awaiting `cookies()` correctly before reading the selected-organization cookie.
- Guard Kanban board ticket hydration against rows missing a `project_id` so malformed tickets no longer crash or silently corrupt board views.
- Enforce valid ticket phases for conversation follow-ups by validating the `phase` field against the known `ticketStatuses` enum.

### Changed
- Change the protocol attach REST endpoint to delegate to shared `runAttachProtocol` logic and emit structured logs with ticket ID, content length, status, and duration.
- Change the deliver protocol API to fast-ack after persisting the deliver event, moving artifact inserts, ticket status updates, and session completion into an `after()` background task with Sentry instrumentation.
- Update agent ticket prompts to include an optional “Custom instructions” section and explicitly require agents to post updates echoing user messages before doing new work.
- Update nav ticket search results to show human-friendly ticket sequence numbers (for example `#123`) when available before falling back to the legacy ticket identifier.
- Improve the ticket conversation composer send actions to use `LoadingButton` with explicit loading and disabled states for answers and follow-ups.
- Restrict project file mention discovery to Kanban board view and add a short timeout when listing workspace files so stalled filesystem calls do not block ticket boards.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- Reduce perceived latency for protocol deliver in sandboxed or slow environments by decoupling artifact persistence and ticket status updates into a background task while returning a fast 200 response.
- Reduce recomputation on large Kanban boards by memoizing column sorting, column lookup maps, and file-mention search results.

### Refactor
- Refactor `resolveSession` to verify organization membership and update heartbeats in a single joined query instead of separate ticket and session lookups.
- Extract attach protocol behavior into `runAttachProtocol` so the REST route and Supabase MCP handler share consistent logic and ticket payload fields.
- Add `supabase/functions/tsconfig.json` and include Supabase edge functions in the main ESLint project configuration for consistent type-checking and linting.

### Test
- Add `protocol-deliver.test.mjs` regression tests covering request timeouts, large artifact payload delivery, `--artifacts-file` handling, non-2xx responses, and unreachable servers.

### Documentation
- Capture an in-depth analysis of deliver stalling in sandbox environments and recommended timeout and fast-ack patterns in `ai/history/2026-02-26-deliver-sandbox-reachability-analysis.md`.

### Chore
- Add a `profiles` table migration with auth-triggered profile seeding and row-level security policies.
- Bump package version to `0.18.0`.

## [0.17.0] - 2026-02-26:10:13

### Added
- Add file mention autocomplete (`@path`) when creating tickets from Kanban columns, powered by each project's local file tree.
- Add an Appearance settings section with Light, Dark, and System theme selection across the app.
- Add a dedicated `ticket_reopened` event type for resumed tickets so reopen actions are explicit in ticket history.

### Fixed
- Fix Kanban cross-column drag behavior so insertion previews and dropped ticket placement stay stable without waiting for a full refresh.
- Fix ticket search fallback behavior when full-text search returns no results by retrying against ticket titles.
- Fix Everhour time-entry loading against multiple API response and query variants to reduce missing-record failures.

### Changed
- Change follow-up conversation entries to persist as `user_follow_up` events and store verbatim user message text.
- Improve Electron CLI installation to choose writable global bin paths when available and return clearer PATH guidance.
- Update modal and sheet surfaces to use the popover palette for improved contrast in dark mode.

### Security
- None.

### Documentation
- Document that follow-up conversation submissions map to `ticket_events(event_type='user_follow_up')`.

### Chore
- Bump package version to `0.17.0`.
- Rename the `build-dev` package script to `build`.

## [0.16.0] - 2026-02-25:17:00

### Added
- Add ticket search in the nav header with full-text search over ticket title and identifier, backed by a new `search_vector` column and API route.
- Add MCP (Model Context Protocol) Supabase Edge Function so cloud-based agents (e.g. Claude Code, Codex) can interact with Overlord tickets via JSON-RPC.
- Add CLI installer in Electron: Settings "Install CLI" installs `ovld` to `~/.local/bin` from the app bundle so desktop users can run the agent CLI without a separate install.

### Fixed
- None.

### Changed
- Make the entire Kanban card clickable to open the ticket in the side panel, with a hover shadow; Everhour timer button remains independently clickable and no longer uses nested links.

### Security
- None.

### Removed
- Remove protocol decision API route; decision flow is no longer exposed as a separate endpoint.

### Documentation
- Document CLI installation approach (Electron bundle and `npx overlord` for web) and update MVP local setup and terminal task submission docs.

### Chore
- Bump package version to `0.16.0`.

## [0.15.0] - 2026-02-25:13:45

### Added
- None.

### Fixed
- None.

### Changed
- Redirect `/projects` index route to `/u` so project navigation lands on the My Tasks board instead of a separate project list.
- Refine `/u` My Tasks layout to label views as "Team Tasks" or "All Tasks" and adjust copy based on the selected workspace cookie.

### Security
- None.

### Removed
- Remove legacy organization-scoped root routes now that `/u` and `/projects/:projectId` are the primary entry points for tickets and projects.

### Chore
- Bump package version to `0.15.0`.

## [0.14.0] - 2026-02-25:13:30

### Added
- Add `/u` “My Tasks” board that shows tickets for the selected workspace or all workspaces, powered by the new workspace selector at the top of the sidebar.
- Add organization-aware workspace switcher to the sidebar via a selected-organization cookie so navigation and project lists stay scoped to the active team.
- Add organization-agnostic project and ticket routes (`/projects/:projectId` and `/projects/:projectId/:ticketId`) plus `/u/:ticketId` overlays that share the same side-panel ticket detail UI.
- Add `user_follow_up` ticket event type and emit follow-up events when resuming tickets from `review` or `complete` so the UI can distinguish fresh follow-up work from the initial delivery.

### Fixed
- Clear review indicators when tickets move back to `execute` so review dots and borders disappear once follow-up work begins.

### Changed
- Redirect legacy organization-scoped project and ticket routes to the new organization-agnostic `/projects/:projectId` URLs while keeping existing deep links working.
- Redirect organization root ticket pages to `/u` so each workspace opens directly into the My Tasks board.
- Update ticket list views and helper path builders to generate project-scoped ticket URLs (`/projects/:projectId/:ticketId`) instead of organization-prefixed paths.

### Security
- None.

### Refactor
- Refactor project layouts to centralize ticket boards and settings under a shared `ProjectLayoutClient` that loads project, status, and Everhour data from a single place.
- Tighten ticket board data loading by deduplicating ticket statuses and reusing `TicketsBoardContent` across user, organization, and project views.

### Documentation
- Document the planned web OAuth login flow in `feature-plans/web-oauth-login-flow-engineering-plan.md` to guide future implementation.

### Chore
- Bump package version to `0.14.0`.

## [0.13.0] - 2026-02-25:12:50

### Added
- Add `TicketLiveProvider` and `TicketPanelLive` so ticket side panels stream agent activity, shared state, and artifacts in real time with a dedicated activity feed.
- Add Everhour-powered `TimerWithTimeEntries` to ticket details so users with an API key can start timers and review logged time directly in Overlord.
- Add inline ticket header tools including `CopyTicketIdentifierButton` and a compact agent badge that highlights the current or most recent agent working on a ticket.
- Add project-level settings header and modal (name, color, working directory, Everhour sync) backed by `ProjectSettingsProvider` and `ProjectLayoutClient` for per-project configuration.
- Add `uploadImageArtifactAction` to save image artifacts into a project’s `.overlord/artifacts` directory and surface them on the ticket timeline.

### Fixed
- Ensure deliver protocol completions emit a `status_change` event so Kanban review indicators and sounds reliably trigger when tickets move into `review`.

### Changed
- Store a `recent_agent` identifier on tickets and update it from the deliver protocol so boards and ticket details can distinguish between the running agent and the most recent delivering agent.
- Expand ticket board queries to include `recent_agent` and Everhour task IDs so Kanban cards can show who last delivered and whether a ticket is wired to time tracking.
- Refine ticket detail layout to group objectives, tools, and acceptance criteria into clearer sections and route agent launches through the new `AgentSplitButtonLive` and `LaunchCommandBar` integration.
- Update project layouts to wrap boards in `ProjectLayoutClient`, showing inline project settings and Everhour awareness while rendering errors through a shared `ErrorBoundary`.

### Security
- None.

### Refactor
- Extract shared waiting-response and review “unopened” timestamp helpers into `ticket-waiting-response` so both indicators share consistent localStorage tracking.
- Restructure project settings into a dedicated context and modal, separating layout concerns from server actions while using `LoadingButton` for async updates.
- Consolidate ticket live state management around `TicketLiveProvider` so realtime hooks, session state, and launch controls share a single source of truth.

### Chore
- Refresh Snaplet data model to match the latest database schema.
- Enhance the Electron release upload script to bump versions when requested, normalize `latest*.yml` asset paths, upload builds under `electron/<version>/`, and prune older versions from Supabase storage.
- Bump package version to `0.13.0`.

## [0.12.0] - 2026-02-25:00:00

### Added
- Persist a "Restart session command" artifact from the deliver protocol endpoint when one is not provided so users can easily resume sessions from the Live panel.

### Fixed
- None.

### Changed
- Update deliver protocol handling to move tickets into `review` and mark agent sessions as `completed` when a deliver event is stored.
- Route Electron agent launches through the protocol context endpoint, using the ticket’s project working directory when available and surfacing per-agent launch commands and prompts in the ticket Live panel.

### Security
- None.

### Refactor
- Drop the unused `ticket_number` column from the `tickets` table.

### Chore
- Bump package version to `0.12.0`.

## [0.11.0] - 2026-02-24:13:40

### Added
- Add support for `cmux` and custom external terminal apps, including a configurable app name or path used when launching ticket terminals from Electron.
- Add a custom external terminal app setting stored in the Electron settings store and surfaced in the Settings modal when the "Custom…" option is selected.

### Fixed
- Restrict onboarding and project “Local directory” pickers to Electron so browser sessions no longer show an unusable OS-specific directory chooser.

### Changed
- Tweak project settings header layout, typography, and Everhour sync button copy for a more compact, consistent appearance.
- Clarify project working directory help text to emphasize that agent terminal sessions open in the configured path.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- None.

### Refactor
- Extend Electron terminal IPC routing and settings schema to handle additional external terminal app variants while preserving default behavior.

### Test
- None.

### Documentation
- None.

### Chore
- Bump package version to `0.11.0`.

## [0.10.0] - 2026-02-24:13:25

### Added
- Add Supabase Realtime-backed Kanban subscriptions for tickets, ticket events, and agent sessions so blocking questions, review transitions, and agent activity appear in near real-time with audio and toast notifications.
- Add Agents settings view to list, refresh, and stop running agent sessions from the app, with direct links back to ticket details.
- Add terminal preferences for embedded vs external mode, preferred external terminal app (Terminal, iTerm2, Warp, Ghostty, Alacritty, Kitty, Hyper), and whether launches open in a new window or tab.
- Add database publication migration enabling realtime notifications for tickets, ticket events, agent sessions, artifacts, and shared_state updates.

### Fixed
- Fix Kanban board state getting stale when realtime channels error or time out by resyncing ticket, waiting-response, review, and agent-session state from Supabase.

### Changed
- Update waiting-response and review indicators to rely on the latest ticket-event timestamps plus local open history so unread dots and sounds only fire for genuinely new events.
- Refine Kanban card visuals for running agents and unread indicators to better highlight active work and tickets needing attention.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- Reduce full-board reloads by combining realtime subscriptions with lightweight background polling for ticket and agent state.

### Refactor
- Refactor Electron terminal IPC and settings storage into a JSON-backed settings store for terminal mode and external terminal preferences.
- Restructure Kanban board state management around maps and refs to isolate realtime overrides from the base ticket list.

### Test
- None.

### Documentation
- None.

### Chore
- Bump package version to `0.10.0`.

## [0.9.0] - 2026-02-24

### Added
- Add realtime Kanban overrides for ticket title/status and agent session state updates so cards reflect active work without a full reload.
- Add persistent ticket view preference storage via cookie-backed server actions so board/list mode follows the user across pages.

### Fixed
- Fix default project chooser selection behavior to avoid incorrect project targeting from the navigation flow.
- Refresh ticket detail panels when the underlying ticket row updates so status and metadata stay in sync while viewing a ticket.
- Include `public` assets in Electron standalone build output so packaged app runtime assets resolve correctly.

### Changed
- Move project board rendering into the project layout and remove duplicate page-level board mounts for project routes.
- Preserve per-column Kanban scroll position and refine running-agent visual emphasis on active cards.
- Standardize Electron app-menu update labels for clearer title casing and status copy.
- Present executed objectives in chronological order with consistent numbering.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- None.

### Refactor
- Extract shared objective timeline sorting helpers for cleaner objective rendering logic.

### Test
- None.

### Documentation
- None.

### Chore
- Bump package version to `0.9.0`.

## [0.8.0] - 2026-02-24

### Added
- Add a `permission-request` protocol endpoint and Claude launch hook support so tool-permission requests show up as blocking ticket notifications in Overlord.
- Add prior `deliver` history and saved `artifacts` to protocol attach responses so resumed sessions load richer context.
- Add a projects index page at `/:organizationId/projects` with project cards for faster navigation.

### Fixed
- Validate ticket ownership before creating agent sessions during protocol attach to prevent invalid session creation for missing tickets.
- Improve protocol update route error fallback messaging when event creation fails.
- Set `created_by` for protocol-created follow-up tickets to preserve ticket authorship metadata.
- Correct Everhour error status parsing so HTTP codes are extracted reliably.

### Changed
- Move project settings into the project layout so settings stay consistent across project views while ticket pages stay focused on board/list content.
- Keep Kanban horizontal scroll position across remounts and sort tickets by `board_position` in visible columns.
- Refresh Kanban and launch UI agent display with branded icons, active-state matching, and a quick ticket details link from cards.

### Security
- Stop returning raw internal error details from protocol APIs; log server-side and capture exceptions in Sentry instead.

### Removed
- None.

### Deprecated
- None.

### Performance
- Parallelize ticket-status and ticket reorder position updates to reduce board and status reorder latency.

### Refactor
- Centralize shared helper logic for agent type mapping, objective-title derivation, and hex color normalization.

### Test
- None.

### Documentation
- Update protocol prompt documentation to describe attach responses with `deliver` history and `artifacts`.

### Chore
- Bump package version to `0.8.0`.

## [0.7.0] - 2026-02-24

### Added
- Add review-phase ticket indicators on the Kanban board, including unread review dots and a dedicated review notification sound.
- Add support for additional external terminal targets in Electron settings and launch flow: Ghostty, Alacritty, Kitty, Hyper, tmux, and cmux.
- Add an install-update confirmation step that warns when one or more agent sessions are still attached.

### Fixed
- Preserve the selected agent identifier during protocol attach by defaulting to `AGENT_IDENTIFIER` in CLI protocol commands.

### Changed
- Update board ticket loading to include latest `review` status-change timestamps for card-level unread review state.
- Replace notification audio assets with MP3 variants and align waiting/complete sounds with the new event handling.
- Upgrade project status settings to a collapsible, drag-and-drop reorder experience.

### Security
- None.

### Removed
- None.

### Deprecated
- None.

### Performance
- None.

### Refactor
- Extract generic unopened-timestamp detection so waiting-response and review indicators share the same comparison logic.

### Test
- None.

### Documentation
- Clarify Overlord protocol prompt guidance with explicit phase and artifact type lists.

### Chore
- None.

## [0.6.0] - 2026-02-24

### Added
- Agent waiting-response notifications on the Kanban board, including realtime `question` event detection, a toast message, an audio cue, and per-ticket unread indicators.
- New local ticket-open tracking helper (`lib/helpers/ticket-waiting-response.ts`) to suppress waiting-response indicators after a ticket has been viewed.
- Full project status management actions and UI controls to rename, reorder, and delete statuses.
- Database migration to add `icebox` as a default status for organizations and include it in future seeded default status sets.

### Changed
- Ticket board data loading now includes the active agent identifier and latest blocking question timestamp, improving card-level agent and waiting-state visibility.
- Kanban card and launch UI visuals were refined (updated active-agent highlighting, waiting dot indicator, and launch bar copy adjustments).
- Settings modal was redesigned into sectioned navigation (`Integrations`, `Terminal`, `Updates`) with improved Electron-specific settings grouping.
- `getPlatformUrl()` now prefers `OVERLORD_URL` before `NEXT_PUBLIC_SITE_URL` and local fallback.

### Security
- Electron renderer responses now receive an explicit Content Security Policy header with stricter source controls and environment-aware `connect-src`.

## [0.5.0] - 2026-02-24

### Added
- Initial changelog entry.
