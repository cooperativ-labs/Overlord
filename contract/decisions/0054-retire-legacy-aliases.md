# ADR 0054: Retire legacy alias routes and protocol aliases

- Date: 2026-11-13
- Status: accepted
- Contract version: 170.0.0
- Supersedes: none
- Amends: [ADR 0029](0029-deliberate-project-routing.md) (the `--inbox` alias is retired),
  [ADR 0035](0035-account-connections-module.md) (the compatibility aliases are retired)

## Context

Several surfaces were kept only so that older clients would keep working while their
replacements shipped:

- ADR 0035 moved every personal credential into the account-connections module and kept the
  older routes as thin compatibility aliases over it: `GET/PUT/DELETE /ext/everhour/integration`
  (already `deprecated`), `GET/PUT/DELETE /ext/everhour/user-connection`,
  `GET/DELETE /ext/github/user-connection` and `POST /ext/github/user-connection/authorize`. An
  in-process hit counter (`backend/connections/alias-telemetry.ts`) logged their use. The
  OpenAPI description already recorded no first-party caller (`x-overlord-consumers:
  [unverified]`): the web app, CLI, desktop, MCP and OverlordMobile all use `/api/connections`.
- The agent protocol carried three compatibility names: the `search-missions` alias of
  `search`, the `--inbox` alias of `--unassigned-to-project` (ADR 0029), and
  `list-organizations`, a legacy name that returned only the caller's current workspace
  (`auth-status` and `GET /api/authorized-workspaces` report workspace context). Protocol search
  also kept `--response-version 1`, the legacy array, as its default although every first-party
  caller (hosted MCP `overlord_search_missions`, the local MCP shim and the connector skills)
  asks for version 3.
- The human "respond in terminal" release (`POST /api/agent-requests/{id}/release`) and the
  session-input cancel (`POST /api/agent-session-inputs/{id}/cancel`) already answered 410 for
  every caller, and no client calls them any more.
- Several operations still listed `webapp` as a consumer after the web app stopped calling them.
- The CLI's channel sentinel (`cli/src/agent-session/sentinel.ts`) was never wired into a launch
  path.

The repository owner approved retiring these surfaces in one major increment.

## Decision

1. The four `/ext/everhour` and `/ext/github` personal-connection alias route families, their
   operations, the alias-only schemas (`EverhourUserConnectionDto`,
   `UpdateEverhourIntegrationBody`, `GitHubUserConnectionDto`, `GitHubUserAccountDto`,
   `GitHubUserAuthorizationDto`, `BeginGitHubUserAuthorizationBody`), the `@deprecated`
   `EverhourIntegrationDto`, the alias-only service functions and the hit counter are removed.
   The paths answer 404. `/api/connections` is the only surface that sets, reads or erases a
   personal Everhour or GitHub connection. A GitHub sign-in such an alias started before the
   retirement still completes at `/api/auth/callback/github/repository`.
2. Protocol `search` is the only name of the search command; `search-missions` answers 404 like
   any unknown subcommand. `list-organizations` is removed with no protocol replacement;
   `auth-status` reports the caller's identity and workspace context. `create` refuses
   `--inbox` with 400 `invalid_input`; `--unassigned-to-project` is the only way to ask for an
   account-owned inbox item.
3. Protocol `search` defaults to `--response-version 3` (`SearchResponseV3`). Version 2 stays;
   any other value, including the retired 1, is refused with 400 `invalid_input`. Every search
   form is now an aggregate read authorized per workspace (v2, v3) or per project
   (`--reference`), as those forms already were.
4. `POST /api/agent-requests/{id}/release` and `POST /api/agent-session-inputs/{id}/cancel`
   (the human routes, not the channel routes) are removed; they now answer 404 instead of 410.
   `POST /api/agent-session-inputs` keeps its 410 because the CLI still calls it.
5. `webapp` is removed from `x-overlord-consumers` where the web app no longer calls the
   operation. An operation left with no known caller is marked `[unverified]` (ADR 0048) and
   kept: `DELETE /api/profile/default-project`, `POST /api/missions/{id}/artifacts` and
   `GET /ext/github/repos` are live routes.
6. The unused CLI channel sentinel is deleted.

Not decided here: the REST v1 search route `GET /api/missions/search` stays, because
`ovld missions list` calls it. The virtual execution target surface stays, because runtime code
(`packages/core/service/project-execution-target.ts`) still reads virtual targets and their
gateway registrations; retiring it needs its own decision.

## Consequences

- A client still calling a retired alias or protocol name gets 404 (routes, subcommands) or 400
  (`--inbox`, `--response-version 1`) and must move to `/api/connections`, `search`,
  `--unassigned-to-project` or the v3 response. No first-party client in this repository or in
  OverlordMobile calls any of them.
- External CLI or MCP users who scripted `ovld protocol search-missions`, `list-organizations`,
  `create --inbox` or relied on the v1 array from protocol search must update their scripts;
  callers that passed no `--response-version` now receive the v3 envelope.
- Every conformance manifest is restamped to 170.0.0; OverlordMobile's manifest must be
  restamped by its owner.
- No stored data, migration, authorization rule or vocabulary changes.

## Alternatives considered

- Keep the aliases until the hit counter reads zero for 90 days (ADR 0035's criteria): rejected
  by the owner; no first-party caller exists and the counter was never collected centrally.
- Keep `--response-version 1` but change only the default: rejected because it keeps a second
  permission path (the ambient-workspace v1 search) alive for no caller.
- Rename `list-organizations` to a workspace-context command: rejected as unnecessary;
  `auth-status` and `GET /api/authorized-workspaces` already answer it.
