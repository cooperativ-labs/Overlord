# Overlord Remote Agent

Tiny Node HTTP daemon that runs on an SSH target host. The Overlord desktop and
mobile clients reach it through an SSH port-forward and use it for filesystem +
git operations against the project working directory on that host.

## Install (invoked by the client)

1. Client runs `ssh host 'bash -s -- --with-bundle' < install.sh` with the
   bundled `server.mjs` appended between `OVERLORD_BUNDLE_BEGIN` /
   `OVERLORD_BUNDLE_END` markers on stdin.
2. The script drops the server into `~/.overlord/remote/` and emits an auth
   token at `~/.overlord/remote/token`.
3. Script prints `OVERLORD_REMOTE_INSTALLED` + `TOKEN=...` / `SERVER_PATH=...`
   / `NODE_BIN=...` for the client to capture.

## Launch (per session)

The client opens an SSH connection and runs:

```
<NODE_BIN> <SERVER_PATH>
```

The server binds `127.0.0.1:0` (random loopback port) and prints
`OVERLORD_REMOTE_READY <host>:<port>` on stdout. The client reads that line,
opens an SSH port-forward from a local ephemeral port to that remote port, and
makes HTTP calls through the forward.

## Protocol

- `GET /health` → `{ok, version}`.
- `POST /*` → JSON body `{workingDirectory, ...}`, bearer-token authed, returns
  the same shape as the corresponding `WorkspaceClient` method.

See `lib/workspace/types.ts` for the full interface.
