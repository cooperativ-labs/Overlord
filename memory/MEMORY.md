# Overlord Project Memory

## Architecture
- **Next.js App Router** (Server Components by default)
- **Supabase** for DB + Auth (local Docker for dev, Supabase Cloud for production)
- **Electron** full app bundling Next.js — NOT a thin wrapper
  - Dev: starts local Supabase + Next.js
  - Prod: Supabase Cloud (no Docker), Next.js standalone server in Electron
- **Vercel** for web deployment
- `organizations.id` is `integer` (not UUID)

## CLI (`ovld`)
- Entry: `bin/ovld.mjs` → `bin/_cli/index.mjs`
- Credentials stored at `~/.ovld/credentials.json`
- Auth: device-code flow via `/api/auth/device/request` + `/api/auth/device/poll`
- Protocol commands: `ovld protocol attach|update|decision|ask|read-context|write-context|deliver`
- Ticket commands: `ovld tickets create|list`, `ovld ticket context <id>`
- Legacy: `ovld run|resume|context` (still work)

## Protocol Auth
- `lib/overlord/protocol-auth.ts`: `resolveAgentToken(request)` — discriminated union
  - Success: `{ context: AgentTokenContext, error: null }` where `AgentTokenContext = { userId, organizationId, tokenId, tokenValue }`
  - Failure: `{ context: null, error: NextResponse }` (401)
- **No global OVERLORD_AGENT_TOKEN** — all auth is per-user via `agent_tokens` table
- `_lib.ts` `parseProtocolBody` returns `ParseResult<T>` discriminated union: `{ ok: true, data, tokenContext }` | `{ ok: false, errorResponse }`
- Routes use: `if (!parsed.ok) return parsed.errorResponse;`
- All protocol routes scope DB queries to `parsed.tokenContext.organizationId`
- Tokens auto-created in `agent_tokens` when user creates their first organization (onboarding)

## Key Tables
- `agent_tokens`: per-user CLI tokens (`user_id`, `organization_id integer`, `token`)
- `device_auth_codes`: device-code OAuth flow (`device_code`, `user_code`, `access_token`)
- `organizations`: `id` is **integer** (not UUID!)
- `tickets`: has `objective`, `acceptance_criteria`, `available_tools`, `execution_target`

## Common Patterns
- Service role client: `createServiceRoleClient()` from `@/supabase/utils/service-role`
- User-scoped client: `createClient()` from `@/supabase/utils/server` (uses cookies)
- Protocol validation schemas in `lib/overlord/validation.ts`
- Server actions use `'use server'` directive
- `yarn generate` to regenerate Supabase types after migrations

## Files: Key Paths
- `lib/overlord/protocol-auth.ts` — agent token validation
- `lib/overlord/validation.ts` — all Zod schemas for protocol API
- `lib/env.ts` — env var helpers
- `app/api/protocol/_lib.ts` — shared protocol request parsing
- `app/api/auth/device/` — device-code auth endpoints
- `app/auth/device/` — device approval web page
- `bin/_cli/` — CLI modules
- `electron/main.ts` — Electron entry point
