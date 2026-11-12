# ADR 0019: Self-minted tokens consent to every workspace of the organization

- Date: 2026-08-20
- Status: accepted
- Contract version: 105
- Supersedes: none
- Origin: contract v105 (no ticket named), backfilled 2026-11

## Context

Token creation required a workspace selection even when a user minted a token for their own CLI.

## Decision

A `USER_TOKEN` a signed-in user mints for themselves (CLI login, settings) consents to every current and future workspace in the caller's organization and asks for no selection. Workspace consent narrowing exists for third-party OAuth clients, which pass it from the approval screen. Runtime authorization is unchanged: consent is intersected with live membership and per-workspace RBAC. `user_tokens.workspace_id` and `workspace_user_id` are issuance attribution and never authorization inputs. Token ownership resolves from the authenticated profile and never falls back to the instance's oldest profile.

## Consequences

- Joining or leaving a workspace takes effect without reissuing a token.

## Alternatives considered

- Requiring a workspace selection for self-minted tokens (the previous behaviour): rejected because it made token creation fail for any account with more than one workspace, and there is no third party to narrow for.
