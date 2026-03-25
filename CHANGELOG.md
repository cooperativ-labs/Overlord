# Changelog

All notable changes to this project will be documented in this file.

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
