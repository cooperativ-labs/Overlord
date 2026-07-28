# Terminal ↔ Overlord Mission Linking (coo:502)

Investigation of how a terminal session can deterministically surface a deeplink back to
its Overlord Desktop mission, without making it the agent's responsibility.

## Problem

A terminal running an agent has no visible identity. The operator must remember (or
reconstruct) which Overlord mission a given window belongs to, and manually go find it in
Desktop. Asking the agent to print the link is unreliable — agents forget, paraphrase, and
the link would only appear when the model chooses to emit it.

The fix must therefore live in **deterministic surfaces**: the launch script, the CLI's own
output, and the harness hooks — all of which run whether or not the model cooperates.

## Current state (verified)

| Piece | Where | Status |
| --- | --- | --- |
| Deeplink format | `backend/push-notifications.ts:302` — `overlord://missions/${mission.id}` | Exists, mobile push only |
| `overlord://` registration | `desktop/src/main.ts:163` `app.setAsDefaultProtocolClient('overlord')` | Registered |
| `overlord://` routing | `desktop/src/main.ts:170` `queueOAuthCallback` → `parseDesktopOAuthHandoffUrl` | **Only `overlord://auth/callback` is handled. Any other URL is silently dropped.** |
| Mission route in the shell | `webapp/web/router.tsx:147` `/user/missions/$missionId` (and `/projects/$projectId/missions/$missionId`) | Exists |
| Main → renderer push channel | `desktop/src/ipc.ts` + `preload.ts` (`overlord:quick-task-shown` pattern) | Exists, reusable shape |
| Launch script generation | `cli/src/terminal-launcher.ts` `terminalInnerCommand` / `terminalLaunchScriptContent` | Single choke point for every terminal launch |
| Mission id in the terminal env | `cli/src/launch.ts:86` exports `MISSION_ID` / `OVERLORD_MISSION_ID` | Present for Overlord-launched terminals only |
| Session-key cache | `cli/src/session-key.ts` — path is `sha256(cwd + "\0" + missionId)` | **Not reversible**: you cannot ask "which mission is this directory on" |
| Stop hook | `connectors/adapters/claude/scripts/stop-hook.sh` | Already prints `[Overlord] …` after every agent turn |

Two gaps fall out of this table and they are the real work:

1. **The deeplink is a dead link on the desktop.** `overlord://missions/<id>` is emitted by
   push notifications today but nothing in Desktop consumes it. Printing it in a terminal
   before fixing this just produces a link that does nothing.
2. **A manually attached terminal has no discoverable mission.** `MISSION_ID` is only set
   when Overlord launched the terminal. When the operator runs `ovld protocol attach` by
   hand in an existing shell, nothing on disk maps that cwd back to a mission, so hooks and
   status lines have nothing to read.

## Recommended design

Four small, independent pieces. Each is useful on its own; together they cover every way a
terminal becomes associated with a mission.

### 1. `cli/src/mission-link.ts` — one formatter, one source of truth

```ts
export function missionDeepLink(displayId: string): string;      // overlord://missions/coo:502
export function missionLinkLine(opts: {
  displayId: string; title?: string; hyperlink?: boolean;
}): string;
```

`missionLinkLine` emits an OSC 8 hyperlink (`\e]8;;overlord://missions/coo:502\e\\coo:502 —
Title\e]8;;\e\\`) when the stream is a TTY and the terminal is known to support it, and a
plain `coo:502 · overlord://missions/coo:502` otherwise. Honour `NO_COLOR` / `TERM=dumb` and
an `OVERLORD_NO_TERMINAL_LINKS=1` escape hatch. Nothing else in the codebase should build
this string by hand.

Terminal-support caveat: iTerm2 supports OSC 8 and cmd-click on `scheme://` text;
Terminal.app supports neither OSC 8 nor custom-scheme autolinking, so the plain text form is
copy-paste only there. If clickability everywhere matters, `missionLinkLine` can additionally
render the backend-derived `https://…/user/missions/<id>` URL, which every terminal autolinks.

### 2. Launch-time banner — deterministic for every launched terminal

`terminalInnerCommand` already builds the exact line that runs in a freshly opened terminal
(`cd … && exports; pre-launch; agent`). Prepend one `printf` of the mission link plus an OSC
title set (`\e]0;coo:502 — Title\a`). Agent-agnostic (Claude, Codex, Cursor, pi all go through
here), no contract change, ~10 lines.

Caveat on the title: Claude Code rewrites the terminal title during a session, so treat the
title as a nice-to-have and the printed banner as the guarantee.

### 3. Attach-time banner + an active-mission pointer — covers manual attach

`ovld protocol attach` (and `connect` / `resume-follow-up`) is the exact moment a terminal
becomes associated with a mission. Two additions there:

- Print `missionLinkLine(...)` to **stderr**, so it appears in the terminal but never
  pollutes the JSON on stdout that agents parse.
- Write a reverse-lookup pointer alongside the existing session-key cache:
  `~/.overlord/active-mission/<sha256(cwd)>.json` → `{ missionId, displayId, title, updatedAt }`.
  This is the primitive the current `session-key.ts` hashing deliberately cannot provide, and
  it is what makes every later surface (hooks, status line, `ovld` banner on any command) a
  two-line read instead of a backend round trip.

### 4. Per-turn footer — the link under every delivery/summary

Add the same line to the existing Stop hook output. Keep the adapters dumb: have the hook
call a new CLI subcommand rather than formatting anything itself.

```bash
ovld protocol mission-link --mission-id "${MISSION_ID:-}"   # falls back to the cwd pointer
```

The Claude Stop hook already prints `[Overlord] …`; this is one extra `echo`. Mirror it into
the codex / cursor / antigravity / pi adapter stop hooks. Because Stop fires when the agent's
turn ends, the link lands directly beneath every delivery and summary — which is the
"header/footer to any delivery" the objective asks for, with zero model involvement.

### 5. Desktop handler — required, otherwise the link is decorative

In `desktop/src/main.ts`, generalize URL intake: a new `parseMissionDeepLink(url)`
(`hostname === 'missions'`, first path segment is the id) sitting next to
`parseDesktopOAuthHandoffUrl`, and a `queueDeepLink` dispatcher that routes to either the
OAuth handler or a mission handler. The mission handler calls `showOrCreateMainWindow()` and
pushes `overlord:navigate` → `/user/missions/<id>` over the existing main→renderer IPC
pattern (same shape as `overlord:quick-task-shown`), with the renderer calling
`router.navigate`. Queue the URL when the window isn't ready yet, exactly as the OAuth path
already does.

Validate the id server-side-ish: accept only `[A-Za-z0-9:_-]{1,64}` before navigating, so a
hostile `overlord://` URL cannot steer the shell to an arbitrary route.

## Contract impact

`CONTRACT.md` line 316 currently scopes Desktop's URL-scheme ownership to
"Remote OAuth callback ownership: registers `overlord://auth/callback` …". Extending Desktop
to consume `overlord://missions/<id>` is a **stable-interface change and needs a contract
version bump (35)**. Proposed wording to add to the Desktop component:

> **Mission deep-link ownership**: registers and consumes `overlord://missions/<missionId>`,
> where `<missionId>` is a mission UUID or workspace display id. The link carries no
> credential, ticket, or payload; Desktop resolves it by focusing the shell window and
> navigating to the mission route, and rejects any id outside `[A-Za-z0-9:_-]{1,64}`.

Impact on other modules:

- **Mobile** — none; it already emits this exact URL for push (`backend/push-notifications.ts`),
  so the format becomes shared rather than mobile-private. No payload change.
- **CLI** — additive only: a new `ovld protocol mission-link` subcommand, a new stderr banner,
  a new local pointer file under `~/.overlord/`. No protocol/API change, no attach-response
  change.
- **Connectors** — additive one-line change to each adapter's Stop hook. The conformance
  manifests declare a contract version and will need re-validation against 35.
- **Backend / Webapp** — none. The mission routes already exist.

## Recommended sequencing

1. Desktop deeplink handler + `overlord:navigate` IPC (unblocks everything; makes the
   already-shipped push-notification deeplink work too).
2. `cli/src/mission-link.ts` + launch-script banner + attach banner + active-mission pointer.
3. `ovld protocol mission-link` + Stop-hook footer across adapters.
4. Contract bump to 35 and conformance-manifest revalidation.

Steps 1–3 are each independently shippable. Step 2 alone already removes the day-to-day
"which mission is this window?" problem even before the click target works.

## Rejected / deferred alternatives

- **Claude Code `statusLine`** — genuinely persistent at the bottom of the terminal and the
  closest literal match to the request. Rejected for now because it is Claude-only, it means
  writing into the user's `~/.claude/settings.json` (Overlord installs a *plugin* for Claude
  today and does not own that file — see `cli/src/connectors.ts`), and a single `statusLine`
  slot cannot be shared with a status line the user already configured without chaining their
  command, which is fragile. Worth revisiting as a per-connector opt-in once the pointer file
  from step 3 exists, since the status-line script then reduces to `ovld protocol mission-link`.
- **Terminal title only** — free, but Claude Code rewrites the title mid-session and the title
  is not clickable. Kept as a bonus on top of the banner, not as the mechanism.
- **Making the agent print the link** — explicitly out of scope per the objective, and
  unreliable.
- **A new device/launch setting to toggle the banner** — deliberately skipped. The banner is
  one line of stderr; the `OVERLORD_NO_TERMINAL_LINKS` env escape hatch is cheaper than a
  round trip through `/api/launch-settings`, the contract, and the settings UI.
