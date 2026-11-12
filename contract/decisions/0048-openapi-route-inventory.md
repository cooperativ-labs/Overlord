# ADR 0048: The OpenAPI description covers every registered route, with explicit exclusions and operation extensions

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.1.0
- Supersedes: none

## Context

ADR 0006 makes a hand-authored `contract/api/openapi.yaml` the source of truth
for REST, bootstrapped once from the code. Phase 4a of
`planning/feature-plans/contract-adr-openapi-migration.md` creates it. The
backend registers 280 method and path pairs across `backend/app.ts`, six
sub-routers and two extension routers. Some of them are not Overlord's API:
Better Auth serves its own routes under `/api/auth/*`, and a Local backend can
serve the built web app. Each operation also has to say who may call it, on
which edition it is served, who calls it, and whether it belongs to an
extension, none of which a router stack records.

## Decision

1. **Inventory.** `backend/app.ts` builds the Express app without listening and
   `backend/index.ts` starts it, so `scripts/list-rest-routes.mts` can import the
   real app and walk its router stack (the authoritative list, with every
   environment-gated route family switched on). The same script extracts the
   routes statically from the sources with the TypeScript compiler API as a
   cross-check and as the only source of per-route evidence (authentication
   middleware, and RBAC permissions named by the handler or the functions it
   calls).
2. **Parity.** `backend/openapi-route-parity.test.ts` (`yarn contract:parity`,
   run by `.github/workflows/contract.yml` and the backend suite) fails when a
   registered route has no operation, when an operation has no registered
   route, or when the runtime and static inventories disagree other than by a
   conditional route that is excluded.
3. **Exclusions.** The only registered routes without an operation are listed
   in the document's top-level `x-overlord-route-exclusions`, each with a
   `kind` (`provider-owned` or `non-api`) and a reason:
   - `ALL /api/auth/*`, Better Auth's handler (`provider-owned`). Overlord's own
     handlers registered before it (`/api/auth/desktop/*`,
     `/api/auth/browser/*` and the GitHub repository-consent callback
     `/api/auth/callback/github/repository`) are operations.
   - `GET *`, the single-page web app fallback a Local backend registers with
     `express.static` when a built web app is present (`non-api`).
   Health (`GET /api/health`), the change feed and realtime streams, OAuth
   discovery and the hosted MCP OAuth endpoints, the MCP transport endpoint
   (`/mcp`, registered when MCP is enabled) and the agent protocol transport
   (`POST /api/protocol/{subcommand}`) are operations. The MCP tools and the
   protocol subcommands they carry stay specified by the tool catalog and
   `protocol-commands.yaml` (ADR 0008).
4. **Operation extensions.** Every operation carries:
   - `x-overlord-permission`: the RBAC action (a value of `PERMISSIONS` in
     `auth/src/rbac/permissions.ts`) the route requires, or one of:
     `public` (no Overlord session or token; a handler may still verify a
     credential in the request, such as an OAuth client secret or a one-time
     ticket), `authenticated` (an authenticated caller with no RBAC action),
     `owner` (authenticated, and acting only on records owned by the caller's
     own profile), `channel-credential` (an agent session channel credential
     only), `workspace-member`, `workspace-manager`, `workspace-admin`,
     `organization-admin` (a role gate rather than an RBAC action), or
     `unknown` when the route's guard has not been established. An `unknown`
     operation whose evidence names several actions lists them in
     `x-overlord-permission-candidates`.
   - `x-overlord-edition`: `local`, `cloud` or `both`. `both` means the route
     is served on both editions even when a query mode or a provider is
     edition-specific.
   - `x-overlord-consumers`: a subset of `webapp`, `cli`, `desktop`, `mobile`,
     `runner`, `gateway`, `external`, or exactly `[unverified]` when no caller
     was established.
   - `x-overlord-extension`: `everhour` or `github`, on and only on the
     `/ext/<name>/` routes.
   - `x-overlord-schema-status: stub` while the operation has no request and
     response schemas.
5. **Stub ratchet.** `contract/api/openapi-ratchet.json` records the number of
   stub operations; `yarn contract:check` fails when the document has more, and
   also when it has fewer, so the recorded number is lowered in the change that
   adds schemas and cannot drift back up. The production gate requires zero.
6. **operationIds** are lowerCamelCase and unique. The bootstrap derived them
   mechanically from method and path (`getMissionsById`); they do not change
   when a description is edited, and renaming one once clients are generated
   from the document is a breaking change of the description.

## Consequences

- A new route lands with its operation, or the parity test fails; a new route
  without schemas also needs the ratchet raised, which review sees.
- The bootstrap values describe current behaviour. Where an extension value
  and the code disagree the code is what ships, the value is corrected and the
  disagreement is listed for review (ADR 0006). `unknown` permissions and
  `unverified` consumers are resolved in phase 4b.
- `architecture.md`, `conformance.md` and `packages/contract` describe a
  `/api/virtual-targets/v1/*` gateway surface that the backend does not
  register. It is not in the description, because the parity test admits only
  served routes; the divergence is flagged for review.

## Alternatives considered

- Static extraction only: rejected as the authority because mount prefixes,
  loops over path lists and conditional registration are easy to misread from
  source; kept as the cross-check and evidence source.
- Keeping the exclusions in the test: rejected because they are part of what
  the description claims and belong in the normative document.
- A list-valued `x-overlord-permission`: rejected for the bootstrap; several
  actions on one route are recorded as `unknown` with candidates until the
  route's guard is established.
