# SSH Cloud Agent Execution

**Ticket:** 1d6c2197-40a3-4001-ae79-ee624fce70fa
**Date:** 2026-03-13
**Status:** Planning

## Problem

Users can only run agents locally via the Electron app. There is no way to trigger an agent on a remote server and interact with it through a separate terminal client like Termius.

## Solution

A "trigger + attach" pattern where Overlord initiates the agent on the remote server via SSH, the agent runs in a named tmux session, and the user attaches via their own SSH client independently. The web app shows ticket progress via the existing protocol callbacks — no terminal streaming required.

## Architecture

```
Web App → "Run on [Server]" → Overlord Backend
                                  ↓ SSH
                              Remote Server
                              $ tmux new-session -d -s ol-{ticketId} \
                                "OVERLORD_URL=... AGENT_TOKEN=... claude ..."
                                  ↓
                          Agent runs, calls back to /api/protocol/*
                                  ↑
User in Termius → ssh myserver → tmux attach -t ol-{ticketId}
                              (interacts with live agent session)
```

The entire protocol layer (`/api/protocol/attach`, `/update`, `/deliver`, `/artifacts/*`) is **unchanged**. The remote agent authenticates and communicates with Overlord identically to a local agent. Session tracking, events, artifacts, and real-time updates all work as-is.

---

## Database

### New table: `ssh_server_profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | int FK | org-scoped |
| `created_by` | uuid FK | |
| `name` | text | e.g. "Dev Box" |
| `host` | text | IP or hostname |
| `port` | int | default 22 |
| `username` | text | SSH login user |
| `encrypted_private_key` | text | pgcrypto encrypted |
| `default_working_dir` | text | e.g. `/home/ubuntu/project` |
| `last_tested_at` | timestamptz | set on successful test |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: org members can read; only `created_by` or org admin can write/delete.

### `agent_sessions` update

Use the existing `external_url` column to store the tmux session name (e.g. `tmux://ol-abc123`) so the web app can surface the attach command in the UI.

---

## Backend

### SSH launch endpoint: `POST /api/protocol/ssh-launch`

1. Validate agent token + org membership
2. Fetch `ssh_server_profiles` record (verify ownership)
3. Decrypt private key
4. SSH into server using `ssh2` npm package
5. Write ticket context to `/tmp/ol-{id}-ctx.md` on remote
6. Write permission hook script to `/tmp/ol-{id}-perm-hook.sh`
7. Write settings JSON to `/tmp/ol-{id}-settings.json`
8. Execute:
   ```bash
   tmux new-session -d -s ol-{shortId} \
     "OVERLORD_URL=... AGENT_TOKEN=... TICKET_ID=... \
      claude --append-system-prompt \"$(cat /tmp/ol-{id}-ctx.md)\" \
      --settings /tmp/ol-{id}-settings.json \
      'Begin working on this ticket...'"
   ```
9. Return `{ sessionName: "ol-abc123", host: "myserver.com" }`

### Test connection endpoint: `POST /api/ssh-servers/test`

SSH in, run `echo ok`, return success/error. Called before saving a profile.

---

## UX

### 1. Settings → "Cloud Servers" page

New page: `/[org]/settings/servers`

- Table of configured servers: Name, Host, Last tested, Actions (Test / Edit / Delete)
- "Add Server" button opens a drawer:

```
┌─ Add SSH Server ──────────────────────────────────┐
│                                                    │
│  Display name      [ Dev Box                    ]  │
│  Host              [ 192.168.1.100              ]  │
│  Port              [ 22    ]                       │
│  Username          [ ubuntu                     ]  │
│                                                    │
│  Private key       [ Paste PEM key or upload    ]  │
│                    (stored encrypted, never shown) │
│                                                    │
│  Working directory [ /home/ubuntu/myproject     ]  │
│                                                    │
│              [ Test Connection ]  [ Save ]         │
└────────────────────────────────────────────────────┘
```

### 2. `AgentSplitButton` dropdown — Cloud section

```
[Claude ▼]
  ─── Local ───
  ✓ Claude
    Codex
  ─── Cloud ───
    Dev Box
    AWS t3.micro
    + Add server…
```

Selecting a cloud server changes the launch behavior from "open PTY" to "call `/api/protocol/ssh-launch`".

### 3. Post-launch banner (ticket view)

Shown in place of the terminal panel after clicking a cloud server:

```
┌──────────────────────────────────────────────────────────────┐
│  Agent started on Dev Box                      [Dismiss]     │
│                                                              │
│  Attach in Termius:  tmux attach -t ol-abc123  [Copy]       │
│                                                              │
│  Session will persist if you disconnect.                     │
└──────────────────────────────────────────────────────────────┘
```

The ticket event feed and session status continue updating in real time from protocol callbacks.

### 4. Manual mode (zero-infrastructure fallback)

Enhanced "Copy Cloud" in the existing dropdown generates a tmux-wrapped command for users who don't want to store SSH keys in Overlord. Paste directly into an open Termius session:

```bash
OVERLORD_URL=https://... AGENT_TOKEN=tok_xxx TICKET_ID=abc123 \
  tmux new-session -A -s ol-abc123 \
  "claude --append-system-prompt '...' 'Begin working on this ticket...'"
```

---

## Build Sequence

1. **`ssh_server_profiles` table + RLS** — migration, generated types, server actions
2. **Settings UI** — Cloud Servers page, add/edit/delete/test drawer
3. **Test connection endpoint** — validate SSH credentials before saving
4. **SSH launch endpoint** — `ssh2`-based execution, writes context files, starts tmux session
5. **`AgentSplitButton` cloud section** — server picker in dropdown
6. **Post-launch banner** — attach instructions, live session state display
7. **Manual "Copy Cloud (tmux)" mode** — enhanced clipboard command generation

---

## Files Likely Touched

| File | Change |
|---|---|
| `supabase/migrations/` | New migration for `ssh_server_profiles` |
| `types/database.types.ts` | Regenerated |
| `lib/actions/ssh-servers.ts` | CRUD + test connection actions |
| `app/api/protocol/ssh-launch/route.ts` | SSH launch endpoint |
| `app/api/ssh-servers/test/route.ts` | Test connection endpoint |
| `app/[organizationId]/settings/servers/page.tsx` | Cloud Servers settings page |
| `components/features/SshServerDrawer.tsx` | Add/edit server drawer |
| `components/features/AgentSplitButton.tsx` | Add cloud server section |
| `components/features/CloudAgentBanner.tsx` | Post-launch attach instructions |

## Open Questions

- Should SSH private keys be encrypted with pgcrypto at the column level, or delegated to a secrets manager (Vault)?
- Should tmux session names use full ticket UUID or a short hash to avoid collisions?
- Should we support password auth at all, or SSH key only?
- Does the `ssh-launch` endpoint live in Next.js API routes or as a Supabase Edge Function?
