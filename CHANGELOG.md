# Changelog

All notable changes to this project will be documented in this file.

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
- `getPlatformUrl()` now prefers `PLATFORM_URL` before `NEXT_PUBLIC_SITE_URL` and local fallback.

### Security
- Electron renderer responses now receive an explicit Content Security Policy header with stricter source controls and environment-aware `connect-src`.

## [0.5.0] - 2026-02-24

### Added
- Initial changelog entry.
