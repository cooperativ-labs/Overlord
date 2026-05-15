# Electron SSH / remote workspace implementation (archived)

This document captures how **remote SSH execution and the remote filesystem helper** worked in the Overlord **desktop (Electron) app** before that code was removed. It is intended as a reference if we reintroduce similar behavior later. **Mobile SSH** (Expo native module, `MobileRemoteWorkspaceClient`) was **not** removed and is documented only in passing here.

## Product goals (what the implementation enabled)

1. **Agent launch over SSH** — From a ticket, opening an external terminal ran an `ssh …` command that executed the chosen agent (Claude Code, Codex, etc.) **on the remote host**, with ticket context inlined (base64) so no local temp file was required on the server.
2. **Remote workspace filesystem** — Git status, diffs, branch operations, and listing project files for a project configured with structured SSH settings used a **persistent SSH connection** and a small **Node HTTP helper** running on the remote host, instead of invoking a new `ssh` process per IPC call.
3. **One-shot remote helper install** — The desktop app could stream a bundled `install.sh` + `server.mjs` to the remote machine over SSH and persist auth token / paths in the local Electron settings store.

## Major components and file map

| Concern | Location (paths relative to repo root) |
|--------|----------------------------------------|
| SSH tunnel + `RemoteWorkspaceClient` | `apps/desktop/electron/services/remote-tunnel.ts` (removed) |
| Remote helper install IPC | `apps/desktop/electron/ipc/remote-install.ts` (removed) |
| Filesystem IPC (`local` vs `remote`) | `apps/desktop/electron/ipc/filesystem.ts` (remote branch removed) |
| Agent launch / context URL / SSH wrap | `apps/desktop/electron/services/agent-launcher.ts` (SSH paths removed) |
| Terminal IPC → `prepareAgentLaunch` | `apps/desktop/electron/ipc/terminal.ts` (SSH payload removed) |
| Preload bridge | `apps/desktop/electron/preload.ts` (`remoteHelper`, `checkSshConnection`, remote `WorkspacePayload` removed) |
| Types for renderer | `types/electron.d.ts` |
| Main process registration | `apps/desktop/electron/main.ts` (`registerRemoteInstallIpc` removed) |
| Tailscale CLI probe (UI for “Tailscale SSH” auth) | `apps/desktop/electron/ipc/tailscale.ts` (retained; no `ssh2`) |
| SSH command parsing / PTY | `lib/ssh/shell-utils.ts` — `parseSshCommand` (removed with desktop-only use) |
| Bundled remote artifacts | `apps/desktop/electron/resources/remote-agent/` + build step in `scripts/electron-build.mjs` |
| Electron builder extra resource | `apps/desktop/electron-builder.yml` (`extraResources` → `remote-agent/`) |
| Shared types | `lib/workspace/types.ts` — `SshConnectionConfig`, etc. (still used by web + mobile) |
| HTTP client to helper | `lib/workspace/remote.ts` — `RemoteWorkspaceClient` (still used by factory / server paths) |

## Dependency: `ssh2`

The main process used the Node **`ssh2`** package (`Client`, `forwardOut`, `exec`) for:

- Installing the remote helper (`remote-install.ts`)
- Maintaining tunnels (`remote-tunnel.ts`)

Auth modes mirrored in both places:

- **`authMethod: 'key'`** — Read `privateKeyPath` from disk (tilde expanded); optional `passphrase`.
- **`authMethod: 'tailscale'`** — `authHandler: ['none']` on the client; remote Tailscale SSH accepts per tailnet ACLs (requires `tailscale up --ssh` on the target).
- **`authMethod: 'agent'`** (default) — `SSH_AUTH_SOCK` forwarded into `ConnectConfig.agent`.

## Remote helper install (`remote-install`)

**IPC:** `remote-install:install`, `remote-install:status`

**Flow:**

1. Load `remote-agent/install.sh` and `remote-agent/server.mjs` from app resources (packaged under `process.resourcesPath/remote-agent/` or dev `electron/resources/remote-agent/`).
2. `renderInstallScript` embedded the server bundle as base64 (preferred marker `__OVERLORD_REMOTE_BUNDLE_B64__`) with fallbacks for older script shapes.
3. `ssh2` `exec` ran: `OVERLORD_HELPER_VERSION=<bundled> bash -s -- --with-bundle` with the full script on the channel stdin (`channel.end(script)`).
4. The script installed `~/.overlord/remote/server.mjs`, wrote `~/.overlord/remote/token`, and printed stdout markers: `OVERLORD_REMOTE_INSTALLED`, `TOKEN=…`, `SERVER_PATH=…`, `NODE_BIN=…`, `VERSION=…`.
5. On success, the main process wrote to `electron-store` (via `services/settings-store.ts`):

   - `remoteHelperToken:<projectId>`
   - `remoteHelperServerPath:<projectId>`
   - `remoteHelperNodeBin:<projectId>`
   - `remoteHelperVersion:<projectId>`

**Status IPC** read those keys and compared `remoteHelperVersion` to `BUNDLED_REMOTE_HELPER_VERSION` from `lib/workspace/helper-version.ts`.

## Remote tunnel (`remote-tunnel`)

**Exported API:** `resolveRemoteWorkspaceClient`, `closeTunnel`, `shutdownAllRemoteTunnels`.

**Per-`projectId` cache (`tunnels` map):**

1. **`connectSsh`** — Same auth matrix as install; keepalive ~15s, ready timeout 20s.
2. **`launchRemoteHelper`** — `ssh.exec('OVERLORD_REMOTE_PORT=0 <nodeBin> <serverPath>', { pty: false })`.
   - The remote server bound `127.0.0.1:0`, then printed **`OVERLORD_REMOTE_READY host:port`** on stdout (regex-driven handshake).
3. **`openLocalForward`** — Created a Node `net.Server` on **local** `127.0.0.1:<ephemeral>`; each accepted socket called `ssh.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort)` and piped streams.
4. Wrapped traffic in **`RemoteWorkspaceClient`** with `endpoint: { host: '127.0.0.1', port: localPort }`, `authToken` from `remoteHelperToken:<projectId>`, and `remoteWorkingDirectory`.

**Reuse:** If the same `projectId` already had an open tunnel with the same `remoteWorkingDirectory`, the existing local forward was reused.

**Teardown:** `ssh.once('close', …)` removed the tunnel record and closed the local server. `shutdownAllRemoteTunnels` ran on app shutdown via `teardownFilesystemIpc`.

## Filesystem IPC (`filesystem.ts`)

Payload supported:

- **`mode: 'local'`** (default when no `ssh`) — `LocalWorkspaceClient(directory)`.
- **`mode: 'remote'`** — Required `ssh` (validated with Zod `SshConfigSchema` + cast to `SshConnectionConfig`), `remoteDirectory`, and `projectId`; resolved via `resolveRemoteWorkspaceClient`.

**`filesystem:check-ssh-connection`** forced `mode: 'remote'` (with fallback `remoteDirectory: '/'`) and called `WorkspaceClient.checkHealth()` to validate SSH + helper.

Checkpoint handlers remained **local-only** (`directory` on disk).

## Agent launch over SSH (`agent-launcher.ts`)

**Inputs (removed):** `sshCommand`, `remoteWorkingDirectory`, `serverMultiplexer`.

**Detection:** `isRemote = Boolean(input.sshCommand?.trim())`.

**Protocol context URL** — Added `&workspace=ssh` when remote so `/api/protocol/context/...` could resolve paths for the SSH workspace.

**Context delivery:**

- Locally: context written to a temp file; agents used `$(cat /path/to/file)` or `@file` (Gemini local path avoided inline expansion issues).
- Remotely: context **base64** embedded in the remote bash script; decoded into `_OVLD_CTX_FILE` on the server (`mktemp` + `trap` cleanup). Codex retained special env `_OVLD_CODEX_CMD` / `_OVLD_CTX_FILE`.

**SSH invocation:**

- Built a remote bash one-liner: PATH augmentation, optional `cd <remote cwd>`, `export` env vars (`OVERLORD_*`, `TICKET_ID`, etc.), decode context, then agent command.
- **`parseSshCommand`** from `lib/ssh/shell-utils.ts` with `{ forceTty: true }` produced argv for `ssh` so interactive CLIs received a TTY (`-tt` behavior).
- Final launch command: `<ssh argv> '<remote script>'` with careful `shellQuote`.

**Multiplexer (tmux on server):** `wrapRemoteCommandWithMultiplexer` wrote the agent command to a remote temp script and substituted `{script}` in the user’s template from settings (`serverExternalTerminalTmuxCommand`).

## Terminal IPC (`terminal.ts`)

`LaunchAgentPayloadSchema` included optional `sshCommand` and `remoteWorkingDirectory`. When present, `getServerMultiplexerConfig()` (reading `serverExternalTerminalApp`, `serverExternalTerminalTmuxCommand`, …) was passed into `prepareAgentLaunch` as `serverMultiplexer`.

Launch scripts used `exec "$SHELL" -i -c …` so shell **aliases** in the user’s profile worked for odd `ssh` wrappers.

## Preload / renderer contract

- **`WorkspacePayload`** allowed `mode`, `remoteDirectory`, `ssh`, `projectId`.
- **`filesystem.checkSshConnection`**
- **`remoteHelper.install` / `remoteHelper.status`**

## Build / packaging

`scripts/electron-build.mjs` **Step 5.5** copied `apps/remote-agent/scripts/install.sh` and esbuild-bundled `apps/remote-agent/src/server.ts` → `apps/desktop/electron/resources/remote-agent/server.mjs`.

`electron-builder.yml` declared `extraResources` from `apps/desktop/electron/resources/remote-agent` → `remote-agent` beside the app bundle.

## Web UI that drove Electron-only behavior

- **`SshWorkspaceSection`** — Saved structured SSH to Supabase; on desktop, **Install helper / Update** called `electronAPI.remoteHelper.*`.
- **`TerminalPage`** — “Server terminal settings” controlled tmux on the **remote host** during SSH launches (`serverExternalTerminal*` store keys).

## Difference vs mobile

Mobile does **not** use `ssh2` in Electron. It uses the **`apps/mobile/modules/ssh`** Expo module + **`MobileRemoteWorkspaceClient`** (`apps/mobile/lib/workspace/remote-client.ts`) to reach the same HTTP helper concept over the device’s SSH stack.

## Reintroduction checklist (short)

If bringing this back:

1. Restore `ssh2` dependency and `@types/ssh2`; re-add tunnel + remote-install IPC + preload APIs + types.
2. Restore filesystem `remote` mode and `check-ssh-connection`.
3. Restore agent-launcher SSH branch + `lib/ssh/shell-utils.ts` (or equivalent quoting).
4. Restore `electron-build` bundle step and `electron-builder` `extraResources`.
5. Align with **connector / protocol / MCP** parity rules (see internal `agent-connector-update` / `drift-review` skills).

---

*Archived when SSH support was removed from the Electron main process; behavioral details reflect the codebase at removal time.*
