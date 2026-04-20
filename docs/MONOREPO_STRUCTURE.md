# Monorepo Structure

The repository is now organized as a workspace-based monorepo.

## App surfaces

- `apps/web`: the Next.js web application
- `apps/desktop`: the Electron desktop shell and packaging config
- `apps/mobile`: scaffold for the future Expo / React Native mobile app
- `apps/ticket-card`: the Sunpeak ticket-card MCP app

## Shared code

- `lib`: shared runtime code still consumed across surfaces during the transition
- `supabase`: shared database, auth, and edge-function code
- `types`: shared generated and hand-written types
- `packages/overlord-cli`: publishable CLI package
- `packages/shared`: reserved workspace for future extracted cross-surface modules

## Transitional notes

- The repo root is now the workspace orchestration layer.
- Root scripts continue to work and delegate into the relevant app workspace.
- Shared code is still rooted at the repo top level for now; future work can progressively move
  stable cross-surface modules into `packages/shared`.
- Electron desktop build details and troubleshooting are documented in `docs/ELECTRON_BUILD.md`.
