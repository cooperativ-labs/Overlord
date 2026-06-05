# RBAC Roles Reference

This document summarizes the organization roles currently implemented in Overlord. It is based on the role enum, server actions, and Supabase RLS policies in this repository.

Current role ladder, from least to most privilege:

1. `VIEWER`
2. `AGENT`
3. `MANAGER`
4. `ADMIN`

Higher roles inherit the affordances of lower roles unless noted otherwise.

## At a glance

| Role | Core affordance |
| --- | --- |
| `VIEWER` | Read organization data and follow work. |
| `AGENT` | Read everything a viewer can, plus create and update project and ticket work. |
| `MANAGER` | Read and edit operational work, plus manage members and invitations. |
| `ADMIN` | Full organization administration, including org settings and execution-target management. |

## Shared baseline for every org member

All four roles can read organization-scoped product data that is guarded by membership rather than by elevated role. In practice that means members can generally:

- view the organization itself
- view other organization members
- view projects
- view tickets
- view schedule entries
- view project-to-target links and organization-owned execution target assignments
- view shared project resource directories, including primaries configured by other members

The main differences between roles are which members may create or modify work, manage other people, or change organization infrastructure.

## `VIEWER`

`VIEWER` is read-only in the RBAC hierarchy.

Affordances:

- View tickets, feed, and project activity.
- View organization members.
- View projects, ticket schedules, execution-target assignments, and shared resource directories.
- Use self-scoped capabilities that do not depend on org role elevation, such as managing their own user-owned devices or their own personal execution-target records.

Limits:

- Cannot create or update projects.
- Cannot create or update tickets.
- Cannot create or update schedule entries.
- Cannot invite members, change member roles, or remove members.
- Cannot change organization settings.
- Cannot manage organization execution targets.
- Cannot write project resource directories on organization-owned targets.

## `AGENT`

`AGENT` is the first role with write access to normal delivery work.

Affordances:

- Everything a viewer can do.
- Create projects.
- Update projects.
- Create tickets that they own.
- Update tickets.
- Create and update schedule entries.
- Create and run agent sessions and write ticket-adjacent execution data such as attachments, artifacts, transcript events, and change rationales where the related policies allow `AGENT` and above.

Limits:

- Cannot delete projects or tickets based on the current role policies.
- Cannot invite members or manage membership.
- Cannot change organization settings.
- Cannot manage organization execution targets.
- Cannot manage project resource directories on organization-owned targets. On personal targets, ownership controls access instead of role.

## `MANAGER`

`MANAGER` is the highest non-admin operational role.

Affordances:

- Everything an agent can do.
- Delete projects.
- Delete tickets.
- Delete schedule entries.
- Invite members.
- Resend and cancel invitations.
- Change member roles up to their own role ceiling.
- Remove members who do not outrank them.
- Manage project resource directories on organization-owned execution targets.

Limits:

- Cannot assign or promote anyone above `MANAGER`.
- Cannot demote or remove the last remaining `ADMIN`.
- Cannot change admin-only organization settings.
- Cannot attach or manage organization execution targets.

## `ADMIN`

`ADMIN` is the top organization role.

Affordances:

- Everything a manager can do.
- Update and delete the organization itself where those flows are exposed.
- Update organization settings such as name, git provider, feed retention, and logo.
- Manage organization membership without the manager ceiling, subject to the last-admin safeguard.
- Create, update, and delete organization invitations.
- Create, update, and delete organization execution-target assignments and project execution-target links.
- Manage admin-only configuration tables such as ticket statuses.
- View devices across the organization in addition to their own devices.

Limits:

- The codebase still preserves some non-role ownership rules. For example, a personal execution target owned by another user is not writable just because someone is an admin.

## Important exceptions

Some affordances are not controlled only by the org role enum.

### Personal execution targets use ownership first

Project resource directories follow a mixed rule:

- On a personal target, only the target owner may write directories.
- On an organization-owned target, `MANAGER` and `ADMIN` may manage directories.
- All organization members may still read the shared primary directory.

That means an `AGENT` or `ADMIN` can still be blocked from modifying directories on a personal target owned by someone else.

### Self-scoped records are not admin-only

Some tables are scoped to the acting user rather than to org role elevation. For example:

- users can manage their own `user_execution_targets`
- users can manage their own execution-target SSH credentials
- users can manage their own device records

Those capabilities should be treated as ownership-based, not as proof that a lower org role has broader organization authority.

## Practical summary

If you need a simple mental model:

- Use `VIEWER` for people who only need visibility.
- Use `AGENT` for contributors who should create and advance work but not manage people or org infrastructure.
- Use `MANAGER` for team leads who need to operate projects and membership.
- Use `ADMIN` for workspace owners who manage organization settings, execution targets, and top-level configuration.

## Related pages

- [Users guide](./public/users-guide.md)
- [Target-scoped resources](./target-scoped-resources.md)
- [Checkpoints and change-tracking](./checkpoints-change-tracking.md)
