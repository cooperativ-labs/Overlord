# MCP Module

The MCP module exposes a hosted Model Context Protocol endpoint for cloud
agents such as ChatGPT, Claude, and other MCP clients.

## Status

The first hosted implementation is mounted by the backend when
`OVERLORD_MCP_ENABLED=true`:

- `GET /mcp` returns server/tool metadata for authenticated callers.
- `POST /mcp` accepts JSON-RPC MCP requests.
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register`
- `GET /oauth/authorize` (redirects to the web approval page)
- `POST /oauth/token`
- `POST /oauth/revoke`

The public ChatGPT Apps surface uses Apps SDK-compatible metadata: every tool
has an input/output schema and safety annotation, and read tools may point at
the bundled `ui://overlord/*` widget resources. The widgets are self-contained
MCP Apps HTML; they render only a tool result's `structuredContent` and make no
third-party network or iframe requests.

The endpoint is intentionally backend-hosted, not a CLI shim. Local connector
MCP scripts for Codex, Claude Code, Cursor, and Antigravity continue to use
`ovld protocol` for checkout-local workflows.

## Authentication

MCP requests must authenticate through the backend Auth Layer before tools are
listed or invoked. Unauthenticated `/mcp` calls return a `WWW-Authenticate:
Bearer` challenge that points clients at the protected-resource metadata.

OAuth-aware clients can use dynamic client registration followed by an
authorization-code + PKCE flow. Approval happens in the web app at
`/oauth/approve`; it selects exactly one organization and either explicit
workspace consent or the all-current-and-future option for that organization.
Approval creates a scoped `USER_TOKEN` with the `mission_lifecycle` preset;
each call is still narrowed by the holder's live memberships and workspace RBAC.
An empty explicit consent list fails closed. Refresh tokens are not issued in
contract version `0`.

When a client supplies an OAuth `resource` parameter, Overlord binds it to the
canonical hosted `/mcp` URL at approval and token exchange. A mismatch returns
`invalid_target`, while missing, denied, expired, revoked, or malformed access
credentials receive an OAuth-compatible `401` challenge at `/mcp`.

When the SPA is deployed separately from the backend, the hosted web build can
serve same-domain OAuth discovery metadata and proxy `/mcp` plus OAuth token
traffic to the backend. Set `OVERLORD_BACKEND_URL` and
`OVERLORD_WEBAPP_PUBLIC_URL` in the web deployment so remote MCP clients can use
the webapp domain as the MCP resource.

`OVERLORD_WEBAPP_PUBLIC_URL` (or `OVERLORD_PUBLIC_URL`) must be set on the
**backend** deployment too, to that same webapp origin. It is the canonical
resource the backend publishes and the only one it accepts, and the approval
call reaches the backend directly rather than through the proxy — so a backend
that does not know the public origin rejects the connection with `invalid_target`
("OAuth resource must match this Overlord MCP server") even though every
discovery document looks correct. Connect clients to the same origin: mixing the
webapp `/mcp` URL with the backend's own hostname is the same mismatch.

## Tools

The current tool catalog is mission-first:

- `overlord_resolve_project`
- `overlord_create_project`
- `overlord_list_project_statuses` — read one project's board columns (names and order are per project; the status type is not)
- `overlord_search_missions`
- `overlord_create_mission`
- `overlord_create_inbox_item`
- `overlord_load_mission_context`
- `overlord_list_deliveries` — read normalized delivery summaries, verification/follow-up notes, and authoritative delivery evidence for one mission
- `overlord_launch_objective` — explicitly queue the normal execution request for one objective; this is distinct from attaching the MCP agent to work
- `overlord_reorder_future_objectives` — explicitly replace one mission's complete future-objective ordering
- `overlord_add_objectives`
- `overlord_update_objective` — turn auto-advance on or off and/or edit instruction text on draft/future objectives
- `overlord_queue_objective` — add, move, or remove one objective from the authoritative project Run Queue
- `overlord_attach_session`
- `overlord_update_session`
- `overlord_deliver_session`
- `overlord_add_artifact` — create a mission artifact mid-turn without delivering (type / label / contentText / externalUrl) via Protocol `add-artifact`
- `overlord_update_artifact` — revise an existing mission artifact in place (label / contentText / externalUrl) via Protocol `update-artifact`
- `overlord_record_work` — record work already finished in chat as one review-column mission (completed objective, file-change rationales, Gemini delivery summary), no attach/deliver cycle

Widgets are attached to project resolution, mission search, mission-context,
and delivery results:

- `ui://overlord/project-selector.html`
- `ui://overlord/mission-list.html`
- `ui://overlord/objective-viewer.html`
- `ui://overlord/file-changes.html`

The local connector MCP bridge scripts for Codex, Cursor, and Antigravity
advertise the same canonical tool names and input contract shape. Backend tests
compare those local `tools/list` responses against this hosted registry so a new
hosted tool cannot be added without updating shipped connector shims.

### Addressing a mission or an objective

Every mission-scoped tool takes `objectiveId` — an objective UUID or a display
id such as `coo:756.k7xm` — alongside `missionId`. A display id already names
its parent mission, so `missionId` is **optional** whenever one is supplied:
`overlord_load_mission_context`, `overlord_attach_session`,
`overlord_update_session`, `overlord_deliver_session`, `overlord_add_artifact`,
`overlord_add_objectives`, and `overlord_update_artifact` all derive it. An
objective **UUID** names no mission and still needs `missionId`.

On `overlord_load_mission_context` and `overlord_attach_session` the objective is
also a _pin_: it selects which objective to read or execute. That is the only way
to address a mission running objectives in parallel, where rediscovering "the
active objective" is ambiguous and returns `ambiguous_active_objective`. On
`overlord_add_artifact` it stamps objective provenance when no live `sessionKey`
is available. On `overlord_add_objectives` and `overlord_update_artifact` it only
supplies the mission scope.

`overlord_create_mission` and `overlord_add_objectives` accept optional
`autoAdvance` (boolean; default false), which maps to authoritative Run Queue
membership. `overlord_update_objective` maps its `autoAdvance` compatibility
input the same way. `overlord_queue_objective` is the explicit queue surface:
it takes `objectiveId`, optional queue/predecessor placement, and `remove` to
dequeue. The returned `autoAdvance` field is deprecated and derived from live
`queueEntry` membership; legacy storage writes retire next release and column
removal requires a later contract bump.

Hosted MCP cannot observe an agent's local current working directory. Tools
that create missions require explicit `projectId`; clients should call
`overlord_resolve_project` first when project identity comes from an exposed
repository resource carrying `.overlord/project.json`. If that file lists
multiple projects, use the entry with `isPrimary: true` (also the top-level
`projectId`) unless the caller names a different linked project.

### Search v3

`overlord_search_missions` returns grouped `SearchResponseV3` mission anchors
with matched objectives and deliveries. It accepts project and workspace
references, status/resource/date filters, `entityTypes`, `objectiveStates`,
`matchesPerResult`, and `detail` (`compact` by default, `full` for child
snippets and metadata). Compact retains child IDs and objective display IDs for
navigation. Artifacts are not indexed. Read `workspaceCounts`, `entityCounts`,
and `truncatedCandidates` before asserting completeness; `fallback` mode is a
recency listing rather than a text-match result.

`overlord_deliver_session` accepts the same optional `artifacts` shape as the
Protocol delivery operation — still valid when finishing a turn. Agents can also
publish artifacts mid-turn with `overlord_add_artifact` (Protocol `add-artifact` /
REST `POST /api/missions/:id/artifacts`) without delivering; artifacts are
validated and persisted by the existing Protocol/REST service layer, never
directly by MCP.

`overlord_update_artifact` is the supported way to revise such an artifact later
(for example during a follow-up objective) without creating a duplicate. It
requires the current `expectedRevision` and forwards to Protocol
`update-artifact`, which uses the same service as REST
`PATCH /api/missions/:id/artifacts/:artifactId`.

## Boundaries

MCP handlers call existing service/protocol functions and rely on their RBAC
checks. They must not write database tables directly. Hosted MCP intentionally
does not expose local filesystem inspection, runner queue claiming, execution
target mutation, or branch actions.
