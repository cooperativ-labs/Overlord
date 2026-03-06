# Changelog

All notable changes to this project will be documented in this file.

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
