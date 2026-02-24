# Changelog

All notable changes to this project will be documented in this file.

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
