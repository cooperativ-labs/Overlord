# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
