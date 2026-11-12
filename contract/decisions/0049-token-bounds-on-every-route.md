# ADR 0049: Token bounds apply to every route, including management routes

- Date: 2026-11-12
- Status: accepted
- Contract version: 169.0.0
- Supersedes: none

## Context

[authorization.md](../authorization.md) states that a `USER_TOKEN`'s effective access is
its workspace consent intersected with live membership and per-workspace RBAC, narrowed
further by its scope, and that the `requirePermission` gate enforces this uniformly. Some
routes authorize through derived role checks (workspace member, manager or admin,
organization admin) or through a mission lookup of their own, and the OpenAPI
description recorded that those routes evaluated the profile's memberships only. A few
routes that change stored state checked only a read action, and two identity fallbacks
could resolve a caller other than the authenticated one.

## Decision

- Derived role checks keep their meaning and are additionally bounded, for token
  requests, by the request's authorization snapshot (organization binding and workspace
  consent) and by the operation's permission in the token scope, through shared helpers
  in `backend/rbac.ts` built on the existing snapshot and `tokenScopeAllows`.
  Organization administration requires consent to every live workspace of the
  organization, because it acts on all of them.
- Lists of workspaces, organizations and notifications narrow to the token's
  organization and consented workspaces.
- Mission-addressed runner routes resolve missions through the standard,
  organization-bounded mission resolution and authorize a runner action.
- Routes that change stored state require the write action of their resource.
- The caller's profile is the authenticated one; only the loopback local operator with no
  resolvable profile falls back to the oldest active human profile.
- Stored-object keys are well-formed relative keys confined to their bucket, and
  organization images are addressed only by their organization's own key shape.
- Webhook test deliveries apply the dispatcher's private-network check, and saving a
  subscription refuses a literal private address.

Sessions keep the membership-derived behaviour.

## Consequences

- A major increment: access that the description documented for tokens and some custom
  roles is narrowed. Self-minted tokens with the default scopes are unaffected on the
  routes their clients use; hosted MCP OAuth tokens (`mission_lifecycle`) can no longer
  manage workspaces, members, invitations or organizations, which their scope never
  granted.
- Custom roles holding `session:read` without `session:attach`, or `mission:read` without
  `mission:update`, lose terminal-session forgetting and title regeneration.
- New routes with derived role checks call the shared token-bound helpers.

## Alternatives considered

- Replacing derived role checks with plain `requirePermission` grants: rejected because
  `MEMBER` holds no `workspace:*` grant and session behaviour must not change.
- Refusing every token on management routes: rejected because self-minted tokens are
  documented to act within their organization.
