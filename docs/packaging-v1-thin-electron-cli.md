# Packaging V1: Supabase Cloud + Thin Electron Wrapper + CLI-First Agents

## Summary

V1 production architecture:

- **System of record:** Supabase Cloud (DB + Auth) and a hosted web app (Vercel).
- **Desktop app:** a **thin Electron wrapper** that loads the hosted web UI and provides local integrations (terminal/PTY, notifications).
- **Agents (Claude Code / Codex):** communicate with Overlord **via the CLI** (not `curl`), using the same `/api/protocol/*` routes.
- **Online required:** acceptable for V1.
- **No web-initiated agent runs:** the web app does **not** start/drive Claude/Codex sessions directly.

This is intentionally “minimum moving parts” while preserving a clean path to a future headless connector and MCP tools.

## Key Decisions

### 1) Supabase Cloud is the source of truth (production)

- Tickets, events, artifacts, shared state, and sessions live in Supabase Cloud.
- Realtime updates flow from Supabase Realtime to the web UI.
- Local Supabase (Docker) is **dev-only**.

### 2) Electron is a thin wrapper over the hosted web UI

Electron responsibilities (V1):

- Render the hosted Overlord UI.
- Provide local integrations (embedded terminal/PTY via `node-pty`, OS notifications, deep links).
- Bundle the Overlord CLI so “agents can work” without the user separately installing a CLI.

Electron should **not** be the system of record and should not require Docker in production.

### 3) CLI-first: agents talk to Overlord via `ovld`

Agents running in Claude Code / Codex use the CLI to:

- Create tickets
- Fetch context for a ticket
- Post protocol events (`attach`, `update`, `decision`, `ask`, `read-context`, `write-context`, `deliver`)

Why CLI-first:

- Works in both Claude Code and Codex permission models (approving `ovld …` is simpler than approving lots of `curl …` patterns).
- Keeps auth, retries, payload validation, and API shape consistent across agent runtimes.
- Makes it easy to bundle and evolve without re-teaching agents new HTTP details.

### 4) Auth lives in the CLI (device-code flow)

V1 auth direction:

- User runs `ovld auth login`.
- CLI opens a device-code flow in the browser, user logs into Overlord, and the CLI receives tokens.
- CLI stores tokens locally and uses them for subsequent `ovld …` commands.

Agents do **not** need to paste API keys into prompts.

### 5) No provider account linking in V1 (Claude/Codex)

Overlord does not need users to “log into Claude/Codex inside Overlord” for V1 because:

- Overlord is not dispatching runs to vendor-hosted compute.
- The agent runtime is local (Claude Code / Codex app), and it can already run `ovld …` locally.

Provider linking becomes valuable later if we want true web-initiated, unattended runs (“run this ticket in the cloud”), centralized spend limits, or deep provider-specific UX.

## Intended Workflows

### A) Brainstorm → create ticket (in Claude Code / Codex)

1. User brainstorms with agent.
2. Agent runs `ovld create "..."` and chooses a project from the numbered list.
3. Overlord web UI shows the new ticket immediately.

### B) Work a ticket (in Claude Code / Codex)

1. Agent runs `ovld ticket context <ticketId>` to fetch the current “ticket prompt”.
2. Agent starts work and posts:
   - `ovld protocol attach …` (first)
   - `ovld protocol update …` (progress)
   - `ovld protocol decision …` (key choices)
   - `ovld protocol ask …` (blocking questions)
   - `ovld protocol deliver …` (final)
3. Web UI streams updates via Supabase Realtime.

### C) Web UI + Electron

- Web UI is the primary UX.
- Electron is an optional shell that adds local terminal/PTY and notifications for users who want them.

## CLI Naming Change: `coop` → `ovld`

The CLI base command is now:

- `ovld` (primary)

Documentation, onboarding, and future tooling should refer to `ovld` as the default.

## Follow-Ups (Not Required for V1 Decisions)

- **Headless connector/daemon:** a later step (`ovld connector start`) so the web UI can enqueue work that a local machine claims and executes, without Electron being open.
- **MCP server:** expose a stable tool surface (`create_ticket`, `list_tickets`, `enqueue_job`, `post_update`, `deliver`) that calls the same Overlord APIs and can be used by multiple agent runtimes.

## Electron Auto-Update Hosting (Supabase Storage)

For Electron app updates, host release artifacts in a public Supabase Storage bucket:

- Bucket: `app-downloads`
- Prefix: `electron/`
- Version folder format: semver from `package.json` (example: `0.1.3`)

### Required layout

`electron-updater` (generic provider) expects metadata files at the feed root and can reference binaries inside version folders:

```text
app-downloads/
  electron/
    latest-mac.yml
    latest-linux.yml
    latest.yml
    0.1.3/
      Overlord-0.1.3-mac-arm64.zip
      Overlord-0.1.3-mac-arm64.dmg
      Overlord-0.1.3-linux-x64.AppImage
      Overlord-0.1.3-linux-amd64.deb
```

Important:
- Keep `latest*.yml` at `electron/` (not only inside the version folder).
- Artifact paths inside `latest*.yml` should point to the version folder (`<semver>/...`).
- Bucket must be publicly readable for direct updater downloads.
- Artifact filenames are generated from Electron Builder using:
  `artifactName: "${productName}-${version}-${os}-${arch}.${ext}"`.
- `scripts/upload-electron-release.mjs` now validates artifacts for the selected platform only.
- On macOS hosts it defaults to `--platform mac`; on Linux hosts it defaults to `--platform linux`.
- The Linux `.deb` is uploaded when present but currently logs a warning instead of blocking the release.

### Manual release checklist

1. Build macOS artifacts on a macOS machine and Linux artifacts on a Linux machine.
2. Confirm `release/` contains:
   - `Overlord-<version>-mac-arm64.dmg`
   - `Overlord-<version>-mac-arm64.zip`
   - `latest-mac.yml`
   - `Overlord-<version>-linux-x64.AppImage`
   - `latest-linux.yml`
   - `Overlord-<version>-linux-amd64.deb` when shipping the Debian package
3. Run `node scripts/upload-electron-release.mjs --no-bump --platform mac` on the macOS build host.
4. Run `node scripts/upload-electron-release.mjs --no-bump --platform linux` on the Linux build host.
5. Verify the public URLs under `app-downloads/electron/<version>/` and the root manifests at `app-downloads/electron/latest-mac.yml` and `app-downloads/electron/latest-linux.yml`.

### App configuration

The Electron app resolves update feed URL in this order:

1. `ELECTRON_UPDATE_URL` (explicit override)
2. Derived from Supabase URL:
   - base: `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
   - bucket: `ELECTRON_UPDATE_BUCKET` (default `app-downloads`)
   - prefix: `ELECTRON_UPDATE_PREFIX` (default `electron`)

Derived feed URL format:

```text
<SUPABASE_URL>/storage/v1/object/public/<bucket>/<prefix>
```
