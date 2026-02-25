# Engineering Plan: V1 Packaging (Supabase Cloud + `ovld` CLI + Thin Electron)

**Source:** `docs/packaging-v1-thin-electron-cli.md`
**Date:** 2026-02-23
**Status:** Planning

---

## Context

The current codebase has:
- All \`/api/protocol/*\` routes fully implemented (\`attach\`, \`update\`, \`ask\`, \`deliver\`, \`read-context\`, \`write-context\`, \`list-tickets\`, \`create-ticket\`, \`context/:ticketId\`)
- A dev-only CLI at \`scripts/overlord-cli.mjs\` (invoked via \`yarn overlord\`) covering \`list\`, \`attach\`, \`update\`, \`ask\` — no \`deliver\`, \`read-context\`, \`write-context\`, or \`auth\`
- Local Supabase dev setup only; no cloud deployment

This plan converts those pieces into a shippable V1 with three deliverables:

1. **`ovld` CLI** — standalone npm binary, full protocol surface, device-code auth
2. **Supabase Cloud + Vercel deployment** — production system of record
3. **Thin Electron wrapper** — shells the hosted web UI with local integrations

---

## Phase 1: `ovld` CLI Package

**Goal:** a standalone, installable `ovld` binary agents can use in Claude Code / Codex.

### 1.1 — Create `cli/` package structure

```
cli/
├── package.json          # name: "ovld", bin: { "ovld": "./dist/index.js" }
├── tsconfig.json
├── src/
│   ├── index.ts          # entry point; routes subcommands
│   ├── commands/
│   │   ├── auth.ts       # ovld auth login / logout / status
│   │   ├── tickets.ts    # ovld tickets list / create
│   │   ├── ticket.ts     # ovld ticket context <ticketId>
│   │   └── protocol.ts   # ovld protocol attach/update/ask/deliver/read-context/write-context
│   ├── lib/
│   │   ├── client.ts     # HTTP client (base URL + auth header)
│   │   ├── config.ts     # read/write ~/.ovld/config.json
│   │   └── output.ts     # consistent JSON and human-readable output
│   └── types.ts
```

**Command surface (complete):**

```
ovld auth login                         # device-code flow → store tokens
ovld auth logout
ovld auth status

ovld tickets list [--project <id>]
ovld tickets create --title "..." --description "..." [--project <id>]

ovld ticket context <ticketId>          # print full ticket prompt for agent consumption

ovld protocol attach   <ticketId> <agentIdentifier> [--method cli]
ovld protocol update   <sessionKey> <ticketId> "<summary>" [--phase <phase>]
ovld protocol ask      <sessionKey> <ticketId> "<question>"
ovld protocol deliver  <sessionKey> <ticketId> "<summary>" [--artifacts '[]']
ovld protocol read-context  <ticketId>
ovld protocol write-context <ticketId> <key> <value>
```

**Config file (`~/.ovld/config.json`):**
```json
{
  "baseUrl": "https://overlord.yourapp.com",
  "accessToken": "...",
  "refreshToken": "..."
}
```

Env overrides: `OVLD_BASE_URL`, `OVLD_TOKEN` (for agent environments with pre-set tokens).

### 1.2 — Auth: device-code flow

`ovld auth login` flow:
1. CLI POSTs to `/api/auth/device/start` → receives `device_code`, `user_code`, `verification_uri`
2. CLI opens `verification_uri` in the browser (or prints it)
3. CLI polls `/api/auth/device/token` until the user completes the browser flow
4. On success, stores `access_token` + `refresh_token` in `~/.ovld/config.json`
5. Subsequent commands attach `Authorization: Bearer <access_token>`

Token refresh: before each request, check expiry; if expired, call Supabase token refresh endpoint and update config.

**API routes to add:**
- `POST /api/auth/device/start` — creates a pending device auth record in Supabase
- `POST /api/auth/device/token` — polls status; returns tokens when user completes login
- `GET /api/auth/device/confirm` — web page user lands on after clicking `verification_uri`; shows the `user_code` and a "Approve" button

### 1.3 — Build and publish

- `tsup` for bundling (`cli/` → `dist/index.js`, shebang preserved)
- `package.json` `bin` field points to `dist/index.js`
- `npm publish` (or `npx ovld@latest`)
- CI: build + lint on push; publish on version tag

### 1.4 — Migrate `scripts/overlord-cli.mjs`

The existing script becomes the reference implementation for the HTTP request shapes. After `ovld` is published, `scripts/overlord-cli.mjs` is deprecated and `package.json` scripts are updated to invoke `ovld` directly.

---

## Phase 2: Supabase Cloud + Vercel Production Deployment

**Goal:** production system of record that both the web UI and `ovld` CLI point to.

### 2.1 — Supabase Cloud project setup

1. Create Supabase Cloud project.
2. Run existing migrations against the cloud project (`supabase db push`).
3. Deploy Edge Functions (`supabase functions deploy`).
4. Copy seed data as needed.
5. Configure Auth providers (email, future: OAuth).

### 2.2 — Environment variables (Vercel)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Cloud project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloud anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloud service role key (server-only) |
| `OVERLORD_AGENT_TOKEN_SECRET` | Signing secret for agent bearer tokens |
| `NEXT_PUBLIC_APP_URL` | `https://overlord.yourapp.com` |

### 2.3 — Vercel deployment

1. Connect repo to Vercel project.
2. Set environment variables above.
3. Configure `vercel.json` if needed (rewrites, headers).
4. Confirm `yarn build` passes in CI before first production deploy.

### 2.4 — Agent token provisioning (V1)

Until full device-code auth is wired up, provide a lightweight path for agents:

- User visits `/account/tokens` in the web UI → creates a named API token.
- Token is a signed JWT verified by `ensureAgentToken()` (already in `_lib.ts`).
- User sets `OVLD_TOKEN=<token>` in their agent environment.

This is the fallback for V1; device-code auth supersedes it once implemented.

---

## Phase 3: Thin Electron Wrapper

**Goal:** optional desktop shell that renders the hosted web UI and adds local integrations.

**Critical constraint:** Electron is a UI shell only. It does **not** bundle Supabase, Docker, or any database. All data lives in Supabase Cloud; the app requires an internet connection (acceptable for V1).

### 3.1 — Create `electron/` package

```
electron/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts           # Electron main process
│   ├── preload.ts        # Preload script (contextBridge)
│   └── ipc/
│       ├── terminal.ts   # node-pty PTY sessions
│       └── notifications.ts
├── build/
│   └── icons/            # App icons (macOS, Windows, Linux)
└── electron-builder.yml
```

### 3.2 — Main process responsibilities

1. **Load hosted web UI**: `mainWindow.loadURL('https://overlord.yourapp.com')` — the URL is hardcoded at build time (baked into the release artifact). There is no local Next.js server, no local Supabase, no Docker dependency in production.
2. **Bundle `ovld` CLI**: package the `ovld` binary in `resources/`. Expose its path via IPC so the embedded terminal knows where to find it.
3. **Terminal/PTY IPC**: expose `pty:create`, `pty:write`, `pty:kill` IPC channels using `node-pty`
4. **OS notifications**: expose `notify:send` IPC channel
5. **Deep links**: register `ovld://` protocol; forward to web UI route

### 3.3 — What Electron does NOT contain

| Thing | Reason excluded |
|---|---|
| Local Supabase / Docker | System of record is Supabase Cloud; no local DB in production |
| Next.js server | Web UI is served from Vercel; Electron is a viewport |
| Supabase credentials / service role key | All auth flows through the web UI or `ovld auth login`; no secrets baked into the Electron binary |

### 3.4 — Preload / contextBridge surface

```ts
contextBridge.exposeInMainWorld('overlord', {
  pty: { create, write, kill, onData, onExit },
  notify: { send },
  app: { version, ovldPath },
})
```

The web UI (Next.js) can detect `window.overlord` and offer terminal/notification features when running inside Electron.

### 3.5 — Packaging

- `electron-builder` targeting macOS (dmg + zip), Windows (nsis), Linux (AppImage)
- Auto-update via `electron-updater` pointing to a GitHub Releases or S3 bucket
- Code signing: macOS (Apple Developer cert), Windows (EV cert — can defer to V2)
- CI: build artifacts on tag push; upload to GitHub Releases

### 3.6 — Dev workflow

```bash
yarn electron:dev    # Electron loads localhost:3000 (local Next.js + local Supabase — dev only)
yarn electron:build  # packages Electron pointing at production Vercel URL
```

In production releases, Electron always points at the hosted URL. The `electron:dev` mode using localhost is **developer convenience only** and never ships.

---

## Phase 4: CLAUDE.md / Agent Onboarding Update

Once `ovld` is published and production is live, update:

1. **`CLAUDE.md`** — replace `yarn overlord` references with `ovld` commands; document `OVLD_BASE_URL` and `OVLD_TOKEN` env vars
2. **`scripts/install-agent-permissions.mjs`** — update to include `ovld …` patterns instead of `curl …`
3. **Ticket prompt template** — ensure `ovld ticket context <id>` output is a well-formed agent prompt with correct command examples
4. **README / onboarding docs** — install steps: `npm install -g ovld`, `ovld auth login`

---

## Sequencing and Dependencies

```
Phase 1 (CLI)
  └─ 1.1 package scaffold
  └─ 1.2 device-code auth (API routes + CLI auth command)
  └─ 1.3 all protocol commands
  └─ 1.4 publish npm package

Phase 2 (Cloud)           ← can run in parallel with Phase 1
  └─ 2.1 Supabase Cloud
  └─ 2.2-2.3 Vercel deploy
  └─ 2.4 agent token UI

Phase 3 (Electron)        ← depends on Phase 2 (needs a hosted URL)
  └─ 3.1-3.3 main process + IPC
  └─ 3.4 packaging + signing
  └─ 3.5 dev workflow

Phase 4 (Docs)            ← last; depends on Phase 1 and 2
```

---

## Out of Scope for V1

- Web-initiated agent runs (web UI does not dispatch Claude/Codex sessions)
- Provider account linking (Claude API keys, OpenAI keys stored in Overlord)
- Headless connector daemon (`ovld connector start`)
- MCP server surface (local MCP is for testing only; not a V1 deliverable)
- Offline mode / local-first data
- Bundled Supabase or Docker inside Electron — production Electron is a thin viewport over Vercel, not a self-contained app

---

## Exit Criteria

| Deliverable | Done when |
|---|---|
| `ovld` CLI | `npm install -g ovld && ovld auth login && ovld tickets list` works against production |
| Protocol commands | All 7 protocol commands (`attach`, `update`, `ask`, `deliver`, `read-context`, `write-context`, `ticket context`) work via `ovld` |
| Supabase Cloud | Migrations applied, auth working, realtime working in web UI |
| Vercel deploy | Production web UI live at custom domain |
| Agent token | User can generate a token in `/account/tokens` and use it via `OVLD_TOKEN` |
| Electron | App launches, loads hosted UI, embedded terminal opens with `ovld` on PATH |
| Docs | `CLAUDE.md` updated; agent can self-configure from ticket context output |
