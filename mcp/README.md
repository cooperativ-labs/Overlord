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
`/oauth/approve`; approving creates a scoped `USER_TOKEN` with the
`mission_lifecycle` preset and exchanges the one-time authorization code for a
bearer access token. Refresh tokens are not issued in contract version `0`.

When a client supplies an OAuth `resource` parameter, Overlord binds it to the
canonical hosted `/mcp` URL at approval and token exchange. A mismatch returns
`invalid_target`, while missing, denied, expired, revoked, or malformed access
credentials receive an OAuth-compatible `401` challenge at `/mcp`.

When the SPA is deployed separately from the backend, the hosted web build can
serve same-domain OAuth discovery metadata and proxy `/mcp` plus OAuth token
traffic to the backend. Set `OVERLORD_BACKEND_URL` and
`OVERLORD_WEBAPP_PUBLIC_URL` in the web deployment so remote MCP clients can use
the webapp domain as the MCP resource.

## Tools

The current tool catalog is mission-first:

- `overlord_resolve_project`
- `overlord_create_project`
- `overlord_search_missions`
- `overlord_create_mission`
- `overlord_create_inbox_item`
- `overlord_load_mission_context`
- `overlord_add_objectives`
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

Hosted MCP cannot observe an agent's local current working directory. Tools
that create missions require explicit `projectId`; clients should call
`overlord_resolve_project` first when project identity comes from an exposed
repository resource carrying `.overlord/project.json`. If that file lists
multiple projects, use the entry with `isPrimary: true` (also the top-level
`projectId`) unless the caller names a different linked project.

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
