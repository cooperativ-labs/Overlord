# Agent ecosystem review — 2026-11-20

Source report: Overlord mission **coo:1318** ("Agent ecosystem change review (2026-11-20)").
This file is the in-repo record of that report and of the work plan that came out of it. It is a
planning document only: no runtime behavior changes.

Contract impact: none.

## Coverage

| Harness | What was read | Gaps |
| --- | --- | --- |
| Claude Code | Changelog 2.1.307–2.1.329 (Oct 21–Nov 19) | 2.1.305/306, 2.1.313, 2.1.315 missing from the fetched text |
| Codex | GitHub releases 0.167.2–0.171.0 (Nov 11–20) | developers.openai.com is blocked by the scheduled environment's network policy; Oct 20–Nov 10 not reviewed |
| Cursor | Changelog Oct 13–Nov 6 | No cursor-agent CLI, hooks or rules entries in that window |
| Antigravity | Extend docs: Hooks, Plugins | Docs carry no dates or versions |

Compared against connectors 0.3.74 (`connectors/HARNESS-MATRIX.md`), the adapter hooks and
scripts, `cli/src/launch.ts` and `cli/src/agent-session/inbox.ts`.

## Possible breakages

| ID | Finding | Severity | Where it is handled |
| --- | --- | --- | --- |
| B1 | Antigravity docs list plugin locations `~/.gemini/config/plugins/<name>/` and `.agents/plugins/`; the adapter installs to `~/.gemini/antigravity-cli/plugins/overlord`. Not yet verified on a real install. | High | coo:1324.5e2h |
| B2 | Antigravity `plugin.json` lacks `displayName` and has fields outside the documented manifest; untested against `agy plugin validate --strict`. | Low | coo:1324.5e2h |
| B3 | Claude Code 2.1.325: sandboxed Bash asks by default (`sandbox.autoAllowBashIfSandboxed` restores the old behavior). | Medium | Not yet scheduled |
| B4 | Claude Code 2.1.325: scheduled tasks and `/loop` ask before running skills that declare `allowed-tools` or hooks. `overlord-mission` declares neither. | Low | None needed |
| B5 | Claude Code 2.1.326: `"decision":"block"` holds in more cases. `stop-hook.sh` prints plain text and `inbox.ts` blocks only when injecting. | Low | None needed |
| B6 | Claude Code 2.1.317/318: nested `claude -p` in runner sessions gets its own session ID. | Medium | coo:1323.n938 |
| B7 | Claude Code self-hosted runner: `--trust-workspace false` disables repo hooks and skills; built-in `gh api` off by default. | Low | Verify if Overlord uses self-hosted runners |
| B8 | Codex 0.169: `codex exec` ignores project config and MCP in untrusted folders unless `--trust`. Interactive launches unaffected. | Medium for headless | coo:1325.t6xw, coo:1325.ke1y |
| B9 | Codex 0.168: explicit `features.multi_agent` warns; 0.170/0.171 removed legacy sandbox-policy config. | Low | coo:1325.t6xw |
| B10 | Opus 4.8 fast mode removed Nov 30, 2026 (Claude Code 2.1.316). | Medium | Not yet scheduled |

## Work plan

The enhancement opportunities were organised into one mission per harness.

| Mission | Scope | Objectives |
| --- | --- | --- |
| coo:1318 | The scan report, plus cross-agent items: E4 MCP tasks for long Overlord MCP operations (c8f4), E5 token-safe MCP registration (m1fw) | 2 |
| coo:1323 | Claude Code: replace shell hooks with `mcp_tool` hooks (plan → MCP tools → switch-over), hook heartbeat and subagent identity, status line, plugin hygiene | 6 |
| coo:1324 | Antigravity: install path and manifest, lifecycle hooks (tier 0 → tier ≥1), Claude plugin import test | 3 |
| coo:1325 | Codex: re-verify the hooks adapter, then an app-server control-plane adapter (spike → adapter → launch integration → child threads → model picker → status line → security and end-to-end) | 8 |
| coo:1326 | Cursor: Agent SDK cloud mode (plan → delivery reviewer → backend support → objective worker → blocked helper, GitHub bridge, cron routines → protocol evals → Origin listing → security and end-to-end) | 10 |

### Decisions recorded

- **Claude hooks (coo:1323):** Overlord requires Claude Code ≥ 2.1.328, so the plugin moves to
  `mcp_tool` hooks with no shell-script fallback. The decision hook uses `onFailure: "block"`; Stop
  and capture hooks fail open. The `ovld` CLI protocol (`ovld protocol …`, `ovld agent-session …`)
  stays supported as the fallback and shares one core implementation with the MCP tools.
- **Codex (coo:1325):** app-server mode is for Overlord-launched sessions; user-started sessions
  keep the hooks adapter. App-server mode stays default-off until its security review and
  end-to-end verification pass.
- **Cursor cloud mode (coo:1326) baseline:** one branch per mission; objectives run in sequence on
  it; each objective commits and pushes before delivering, and the delivery records the SHA; the
  next objective starts from that SHA; the user finishes by reviewing and merging.

### Run order

The project Run Queue (paused) holds coo:1318, coo:1323, coo:1324 and coo:1325; coo:1326 is not
queued yet.

1. coo:1324.5e2h — Antigravity install path (possible live breakage)
2. coo:1325.t6xw — re-verify the Codex connector
3. coo:1318.m1fw — token-safe MCP registration (before the setup changes in coo:1323 and coo:1325)
4. coo:1323 — Claude Code, all six objectives in order
5. coo:1318.c8f4 — MCP tasks (after coo:1323's hook MCP tools land)
6. coo:1324 — remaining Antigravity objectives
7. coo:1325 — remaining Codex objectives

Objectives that change `cli/src/setup.ts`, the MCP server or the contract run one at a time, so
contract versions don't collide.

## Follow-ups not yet scheduled

- B3 and B10: review launch and agent-pod settings for the sandboxed-Bash ask default and for any
  pinned Opus 4.8 fast mode.
- Allow developers.openai.com in the scheduled environment's network policy so future scans can
  read the Codex changelog.
- coo:1164.mw5j ("Verify Codex and Antigravity documentation") is covered by coo:1324.2kwc and
  coo:1325.t6xw and can be closed once they land.
