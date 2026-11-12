# ADR 0024: Worktree/branch automation is a per-user preference

- Date: 2026-08-26
- Status: accepted
- Contract version: 126
- Supersedes: none
- Origin: contract v126 (no ticket named), backfilled 2026-11

## Context

`worktreeBranchAutomationEnabled` was a workspace setting, so one member's choice applied to everyone in the workspace.

## Decision

The setting moves to the acting profile's launch-session defaults. The workspace-level DTO fields keep their shape but mirror the user default, identical across every workspace the user belongs to; the workspace id on the launch-settings routes only selects the authorizing membership. Stored workspace values are not migrated.

## Consequences

- Users re-enable the toggle once.

## Alternatives considered

Not recorded.
