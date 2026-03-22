# Sunpeak MCP Gap Analysis

This review compares Overlord's current MCP implementation to Sunpeak's recommended MCP App approach, with a focus on compatibility with ChatGPT and Claude.

## Current Strengths

- The public MCP entrypoint stays on the app domain at `/api/mcp`, which is the right shape for host-facing integrations.
- OAuth protected-resource metadata is exposed from the public route, and bearer challenges are rewritten back to the public metadata URL.
- The MCP server already exposes tools, resources, and a working inline app flow for `create_ticket_draft`.
- `sunpeak` is already installed in the repository, so the main gap is adoption, not package setup.

## Main Gaps Versus Sunpeak

### 1. The app UI is still built as a custom `ext-apps` implementation, not a Sunpeak app

Current state:

- Source UI lives in `mcp-apps/ticket-card/src/main.tsx`.
- The deployed resource served by MCP is a giant compiled HTML string in `supabase/functions/mcp/ui/ticket-card-resource.ts`.

Why this is weaker than the Sunpeak approach:

- Sunpeak expects a clear app structure with co-located resources and tools.
- The current setup creates two sources of truth: React source and compiled inline HTML.
- Reviewing, testing, and iterating on the resource is harder because the edge function owns the final output blob.

Recommended improvement:

- Move the MCP app into a Sunpeak-style structure:
  - `src/resources/ticket-card/ticket-card.tsx`
  - `src/tools/create-ticket-draft.ts`
  - `tests/simulations/*.json`
- Treat the built app as a normal artifact instead of embedding the compiled HTML bundle directly in a TypeScript constant.

### 2. There is no Sunpeak simulator workflow or simulation coverage

Current state:

- MCP tests only cover metadata helpers and a small proxy helper.
- There are no MCP app simulations for draft creation, save success, validation failure, cancellation, or host capability differences.

Why this matters:

- Sunpeak's recommended workflow relies on simulations and a local simulator to reproduce host runtime behavior without repeatedly reconnecting ChatGPT.
- Without simulations, regressions in host-specific UI behavior are easy to miss.

Recommended improvement:

- Add simulation fixtures for:
  - draft created successfully
  - save succeeds
  - save returns tool error
  - save succeeds but omits returned ticket
  - host lacks `sendMessage` but supports model-context updates
- Add one lightweight smoke path that runs the ticket card in a local simulator.

### 3. Host-adaptive UI support is minimal

Current state:

- The ticket card uses `useApp` and `useHostStyles` from `@modelcontextprotocol/ext-apps/react`.
- It does not use higher-level host hooks like safe area, display mode, viewport, locale, or device capabilities.

Why this matters:

- Sunpeak's guidance is explicitly oriented around ChatGPT and Claude host differences.
- The current UI is functional, but it leaves host adaptation mostly manual.

Recommended improvement:

- Migrate the resource to Sunpeak hooks such as:
  - `useToolData`
  - `useHostContext`
  - `useDisplayMode`
  - `useSafeArea`
  - `useCallServerTool`
- Wrap the resource in `SafeArea` and make layout choices based on host context instead of assuming a single presentation mode.

### 4. The resource delivery model is hard to maintain

Current state:

- `resources/read` returns inline HTML text from a checked-in compiled string.

Why this is weaker than the Sunpeak approach:

- Sunpeak's docs recommend a normal app build flow and, for production, serving published resource output from your own MCP server.
- Inline compiled HTML in the edge function makes cache busting, asset management, and review harder than necessary.

Recommended improvement:

- Add a build step that produces a versioned static artifact for the MCP app.
- Serve the built app from a stable Overlord-owned URL and let the MCP resource definition reference that built output.

### 5. The tool and resource definitions are not organized for scale

Current state:

- Tool metadata is centralized in `supabase/functions/mcp/tools.ts`.
- The interactive app logic is split across handler code, tool metadata, source React code, and compiled resource text.

Why this matters:

- Sunpeak's resource-per-folder and tool-per-file convention scales more cleanly when more MCP apps are added.
- The current layout is workable for one app, but it will become brittle if Overlord adds more interactive resources.

Recommended improvement:

- Use Sunpeak-style file ownership so each interactive tool owns:
  - schema
  - metadata
  - structured response shape
  - linked resource
- Keep the MCP server focused on auth, routing, and protocol plumbing.

## What Does Not Need to Change

- Keep `/api/mcp` as the public endpoint.
- Keep the current OAuth protected-resource metadata pattern.
- Keep support for both OAuth JWTs and agent tokens.
- Keep the MCP tool surface aligned with the existing `ovld protocol` lifecycle.

Those parts already match the repo's connector architecture and are compatible with the goal of supporting ChatGPT and Claude.

## Recommended Migration Order

1. Move `ticket-card` into a Sunpeak app/resource/tool layout without changing the MCP contract.
2. Add Sunpeak simulation fixtures and a local simulator workflow.
3. Replace the checked-in compiled HTML string with a build artifact pipeline.
4. Expand host-aware behavior using Sunpeak hooks and safe-area/display-mode handling.
5. Use the same pattern for future Overlord interactive MCP resources.

## Relevant Files Reviewed

- `app/api/mcp/route.ts`
- `app/api/mcp/[...path]/route.ts`
- `lib/mcp/oauth-metadata.ts`
- `supabase/functions/mcp/index.ts`
- `supabase/functions/mcp/tools.ts`
- `supabase/functions/mcp/auth.ts`
- `supabase/functions/mcp/handlers/create-ticket-draft.ts`
- `supabase/functions/mcp/ui/resources.ts`
- `supabase/functions/mcp/ui/ticket-card-resource.ts`
- `mcp-apps/ticket-card/src/main.tsx`

## Primary Sunpeak References

- Sunpeak overview: https://sunpeak.ai/docs/
- Sunpeak simulator docs: https://docs.sunpeak.ai/library/chatgpt-simulator
- Sunpeak `runMCPServer` docs: https://docs.sunpeak.ai/api-reference/simulations/run-mcp-server
