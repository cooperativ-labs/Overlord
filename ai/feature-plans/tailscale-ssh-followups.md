# Tailscale SSH — Follow-up Features

Four follow-up items deferred from the SSH connector rearchitecture (ticket `36f7d0d2-8432-47aa-b03e-0127ee29da4c`). Phase 4 of that ticket covers Tailscale SSH auth mode (#1) and the presence indicator (#3). The items below are tracked here so they don't get lost.

Context: Overlord's desktop app uses `ssh2` (npm) to open a remote-helper HTTP tunnel on a port-forwarded channel. SSH config is persisted as structured fields on `projects` (`ssh_host`, `ssh_port`, `ssh_user`, `ssh_auth_method`, `ssh_private_key_path`). Users on Tailscale reach hosts by MagicDNS name (`myserver` or `myserver.tailnet-xxx.ts.net`).

---

## #2 — Host discovery via `tailscale status --json`

**Problem.** Users have to type MagicDNS names by hand, which is error-prone and hides the full tailnet.

**Approach.**
- New Electron IPC: `tailscale:list-peers` → shells out to `tailscale status --json`, parses `Peer` map, returns `{ name, dns, os, online, addresses: string[] }[]`.
- UI: in `ProjectExecutionWorkspaceSelector`, add a "Pick from Tailnet" button next to the host input. Opens a popover listing peers (green dot = online). Selecting one populates `ssh_host` with the MagicDNS name.
- Fall back to manual input if Tailscale isn't installed/running (detected via the presence indicator in #3 from the core ticket).

**Open questions.**
- `tailscale` CLI path differs by OS (macOS app bundle vs. Linux `/usr/bin`). Probe in order, or ship a small helper that reads the standard install paths.
- No mobile equivalent — the RN Tailscale app doesn't expose peer listing. Mobile users keep the manual host field.

---

## #4 — MagicDNS-aware hostname hinting

**Problem.** Users don't get feedback about whether their hostname will resolve over Tailscale.

**Approach.**
- Pure client-side heuristic on the SSH config form: if `ssh_host` matches `*.ts.net` or is a bare label and Tailscale presence (from #3) reports `running && loggedIn`, render a subtle "Resolved via Tailscale" badge.
- Do not attempt DNS resolution from the renderer — it adds flakiness with no real value. The actual connection attempt is the source of truth.

**Out of scope.** Tailnet-name auto-detection (pulling the user's current tailnet suffix from `tailscale status --json`) — nice-to-have, revisit with #2.

---

## #5 — Tunnel reconnect on network changes

**Problem.** Tailnet IPs are stable, but the underlying route (wifi ↔ cellular, NAT changes, sleep/wake) drops the `ssh2` forwarded channel. Today the user has to toggle Execute-Locally and back to recover.

**Approach.**
- In `apps/desktop/electron/services/remote-tunnel.ts`, attach listeners to the `SshClient` (`'error'`, `'close'`) and the forwarded channel (`'close'`).
- On unexpected close, mark the `TunnelRecord` as `reconnecting`, emit an event to renderer (`remote-tunnel:reconnecting`), and retry `connectSsh` + `openLocalForward` with exponential backoff (1s → 30s cap, abort after 5 min).
- Preserve the local forwarded port so in-flight `RemoteWorkspaceClient` calls can retry transparently. If the remote helper's random port changed, update `TunnelRecord.remotePort` and re-open `forwardOut`.
- Add a status event stream consumed by a small indicator in the Execute-over-SSH toolbar: `connected | reconnecting | down`.

**Risk.** If the remote helper was killed (not just the network), reconnect will fail at the exec step. The retry loop should surface that distinctly so the user sees "Remote helper not running — reinstall?" instead of an infinite spinner.

---

## #6 — Mobile parity

**Problem.** React Native app needs the same Execute-over-SSH affordances, but mobile Tailscale works differently (OS-level VPN, no CLI access).

**Approach.**
- Reuse `lib/workspace/remote.ts` (`RemoteWorkspaceClient`) as-is — it only needs an HTTP base URL + bearer token.
- On mobile, the SSH tunnel is harder: options are
  1. **`react-native-ssh-sftp`** — opens an ssh2-compatible connection and port-forward; works when Tailscale VPN is active on the device.
  2. **Direct HTTP to helper's LAN port** — if the remote helper optionally binds a tailnet IP (not just 127.0.0.1), the phone can hit it directly over Tailscale with no port-forward. Requires adding an `OVERLORD_REMOTE_BIND` env knob to the helper and surfacing a "bind to tailnet" toggle during install. Simpler on mobile but widens the attack surface, so gate it behind a per-project opt-in.
- UI: in mobile Execute-over-SSH setup, detect Tailscale via deep-link probe (`tailscale://`) to hint "Ensure Tailscale is running". No list-peers feature (see #2).

**Decision needed.** Option 2 (tailnet-bound helper) is the clean path for mobile but must not be the default on desktop — keep desktop on 127.0.0.1 + `forwardOut`.

---

## Sequencing

Land these after the core ticket delivers. Rough order: #5 (reliability win, no UX change) → #2 + #4 together (they share the Tailscale CLI probe) → #6 (largest scope, mobile).
