# Muse Code Harness — Overlord Fit Assessment

Mission: `coo:624` — *Investigate the new Muse Code harness/agent and determine if it will fit into overlord*

Date: 2026-08-05  
Installed probe: Muse Code `0.1.0-R708.1` (`muse-stable`)

## Verdict

**Yes — Muse Code is a strong fit for Overlord.** It is a first-class terminal coding harness with a Claude/Codex-shaped callback surface (hooks, skills, MCP, headless exec), plus a `managed_hooks_path` knob that maps unusually cleanly onto Overlord's installer-owned hook model. Treat it as a **new connector candidate**, not a dead end and not a "model-only" integration.

Do **not** ship a production adapter on day one of the beta. Ship a fixture-backed spike first: the public docs and the shipping binary already disagree in small ways (notably the documented `muse hooks` CLI subcommand is absent from `0.1.0-R708.1` even though hook event names and `managed_hooks_path` are present in the binary).

## What Muse Code is

Meta's terminal + CI coding agent, released in beta 2026-08-05, co-trained with Muse Spark 1.2.

| Fact | Detail |
| --- | --- |
| Binary | `muse` (interactive TUI) / `muse exec` (headless) |
| Platforms | macOS and Linux only |
| Default model | `muse-spark-1.2` |
| Auth | Browser OAuth or `META_API_KEY` (required for CI / non-interactive) |
| Install | `curl -fsSL https://dev.meta.ai/install.sh \| sh` → `~/.local/bin/muse` |
| Docs | https://dev.meta.ai/docs/muse-code |

Evidence sources: official Meta docs under `/docs/muse-code/*`, plus a live install of `0.1.0-R708.1` in this environment (`muse --version`, `muse exec --provider echo --json`, binary string scan, `muse skills list --json`).

## Fit vs Overlord connector layers

Overlord needs four layers ([`connectors/docs/05-connectors-and-agent-plugins.md`](../../connectors/docs/05-connectors-and-agent-plugins.md)). Muse maps as follows:

| Layer | Muse Code surface | Fit |
| --- | --- | --- |
| Connector core | Skills load `SKILL.md` from user/project/`~/.agents/skills`, and also scan `.claude/skills` + `.codex/skills`. `muse skills import --from claude\|codex` exists. | **Excellent** — Overlord's existing skill core can land with little format change. |
| Connector plugin | Per-adapter skill template + hooks + MCP config | **Excellent** |
| Plugin adapter | No Claude-style marketplace plugin package required. Prefer: user skills install + `managed_hooks_path` + `mcp_servers` in `~/.config/muse/settings.json` (schema_version: 1). Project hooks at `<repo>/.muse/hooks.json`. | **Good** — different packaging, but simpler and closer to how Codex/Antigravity already diverge. |
| Prompt wrapper | Interactive: prompt argv. Headless: `muse exec --prompt-file`. Context file can be `@`-referenced or inlined like Pi/Claude. | **Good** |

### Agent-session capability shape

Likely integration shape: **`callback`** (Shape A), same family as Claude/Codex/Cursor — not OpenCode's control plane and not Pi's in-process extension.

Documented lifecycle hook events (binary confirms the names exist):

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreLLMCall`, `PostLLMCall`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`

That is a **near-superset** of what Overlord already grades on Claude. Expected first-pass capability map (all start as `unverified` until fixtures land):

| Overlord capability | Muse native | Notes |
| --- | --- | --- |
| `observe.prompt` | `UserPromptSubmit` | Direct map |
| `observe.toolCall` | `PreToolUse` | Direct map |
| `observe.toolResult` / `observe.fileEdit` | `PostToolUse` | Need tool-name vocabulary from real payloads |
| `observe.sessionLifecycle` | `SessionStart` / `Stop` | Direct map |
| `decide.shell` / `decide.mcp` / `decide.fileWrite` | `PermissionRequest` + staged shell approvals | Decision codec required; Muse stages compound shell commands |
| `inject.turnBoundary` | `Stop` inbox (pattern from Claude/Codex) | Verify response contract |
| `inject.midTurn` | TUI steer + `muse session-message` | Programmatic inject for Overlord inbox is **unverified**; session-message exists but is socket/token gated |
| `answer.structuredQuestion` | Clarifying-questions UI | Interesting future; not required for MVP |

`managed_hooks_path` is the standout: Meta documents managed hooks as **pre-approved** (no `muse hooks trust` step). That is the right place for Overlord's installer-owned agent-session scripts.

### Launch / runner

| Need | Muse flag / command |
| --- | --- |
| Binary | `muse` |
| Model | `--model muse-spark-1.2` |
| Reasoning | `--reasoning-effort none\|minimal\|low\|medium\|high\|xhigh\|ultra` (default high; `ultra` is client-side multi-agent aggressiveness) |
| Mission prompt file | `muse exec --prompt-file <path>` or interactive prompt argv |
| Trust project skills/hooks for launched runs | `--trust-workspace` |
| Unattended / pod | `--disable-approval` (keep sandbox) or `--yolo` (only in disposable isolation) |
| Machine events | `muse exec --json` → JSONL with `stream.id` session UUID |
| Resume | `muse resume <uuid>` / `muse exec --session-id <uuid>` |
| Auth for pods | `META_API_KEY` |

This is enough for `cli/src/launch.ts` + `agent-catalog-defaults.ts` without a contract version bump, following the same pattern as the Pi connector (`coo:308` plan).

### MCP

Settings block `mcp_servers` supports `stdio` and `streamable_http`. Overlord's existing `connectors/core/scripts/overlord-mcp.mjs` shim can be rendered with adapter key `muse` the same way Codex/Cursor/Antigravity do today.

Caveat from Meta: **MCP tools are not sandboxed**. Approval still applies. Same class of risk as other harnesses; document it in the adapter README.

## Comparison to current adapters

| Dimension | Claude | Codex | Cursor | Antigravity | **Muse (projected)** |
| --- | --- | --- | --- | --- | --- |
| Shape | callback | callback | callback | callback | **callback** |
| Hook vocabulary overlap | reference | high | medium (renamed) | medium (renamed) | **very high** |
| Managed / central hooks | plugin | plugin | plugin | plugin dir | **`managed_hooks_path`** |
| Skills format | SKILL.md | skills | rules/skills | skills | **SKILL.md + Claude/Codex import** |
| Headless | limited | yes | agent CLI | yes | **`muse exec` first-class** |
| Maturity in Overlord | tier 3 | tier 3 | tier 0 | tier 0 | **none yet** |
| Product maturity | GA-ish | GA | GA | evolving | **day-0 beta** |

Relative to Overlord's backlog, Muse looks **easier to integrate than Cursor/Antigravity** on hooks naming, and **comparable to Claude** on surface area — with higher change risk because it is brand new.

## Risks and gaps

1. **Beta churn.** Version is `0.1.0-R708.1`. Docs advertise `muse hooks list|validate|trust|run`; that subcommand is **not** in the installed binary. Hook *runtime* appears present (event names + `managed_hooks_path` in binary). Design the adapter against file-based config, not the missing CLI.
2. **Hook stdin/stdout schemas undocumented in detail.** Must capture fixtures with `muse hooks run`-equivalent or live PreToolUse/PermissionRequest payloads before claiming `supported`.
3. **Auth / billing.** Users need a Meta API key or OAuth session. Agent-pods need `META_API_KEY` in the launch env. This is a product/ops dependency, not a connector blocker.
4. **Sandbox vs hooks.** Hooks run outside the sandbox (Meta's warning). Good for `ovld` (needs network/filesystem), but Overlord must not register untrusted user hooks as managed.
5. **Subagents.** Parallel children + optional worktree isolation. Same hazard family as Claude subagent delivery escape (`coo:585`). Capability descriptor should list a subagent hazard when shipping.
6. **Observer agents.** Memory/skill/goal observers on by default → extra token spend. Launch/docs should mention toggling `runtime_capabilities`.
7. **No Windows.** Fine for Overlord's current macOS/Linux focus; do not advertise Windows.
8. **Not a substitute for Muse Spark-in-other-harnesses.** Meta also documents pointing OpenCode/Codex/Claude at `https://api.meta.ai`. That is a *model provider* path Overlord already supports indirectly via those adapters. A Muse **connector** is about the Muse harness itself.

## Recommendation

| Decision | Choice |
| --- | --- |
| Fit for Overlord? | **Yes** |
| Priority | **High for discovery / spike; medium for GA ship** — land after a fixture spike, not ahead of unfinished Claude/Codex agent-session work unless product wants Meta coverage now |
| Contract change needed? | **No** for a standard new connector under existing approved capabilities/hook types |
| First implementation ticket | Spike: install adapter skeleton, record native hook fixtures, draft `harness-capabilities.yaml` with honest `unverified`/`not-implemented`, prove unbound-session silence, prove one `observe.*` + one `decide.*` path |

### Suggested follow-up objectives (not executed here)

1. Spike `connectors/adapters/muse/` with conformance manifest, skill template (`<!-- @connector-core -->`), managed hooks path install, MCP settings merge, and doctor checks.
2. Capture native hook fixtures (PermissionRequest allow/deny/defer bytes, PostToolUse write/shell, UserPromptSubmit, unbound-session negative).
3. Add `muse` to `agent-catalog-defaults.ts` with `availableByDefault: false` until doctor + one happy-path launch work; model `muse-spark-1.2`, reasoning options matching `--reasoning-effort`.
4. Add launch branch: `muse` + `--model` + `--reasoning-effort` + `--trust-workspace` + context via `--prompt-file` / prompt text; document `META_API_KEY` for pods.

## References

- https://dev.meta.ai/docs/muse-code
- https://dev.meta.ai/docs/muse-code/extending
- https://dev.meta.ai/docs/muse-code/configuration
- https://dev.meta.ai/docs/muse-code/permissions
- https://dev.meta.ai/docs/muse-code/interactive
- https://dev.meta.ai/docs/muse-code/auth
- Overlord: `connectors/AGENTS.md`, `connectors/HARNESS-MATRIX.md`, `planning/feature-plans/pi-agent-connector.md`
