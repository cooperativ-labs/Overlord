# Agent Connectors Module

How Overlord plugs into AI coding harnesses (Claude Code, Codex, Cursor,
OpenCode, Antigravity, and others). A connector is what lets an agent speak the
`ovld protocol` and inherit mission context inside its native harness.

## Table of Contents

- [For Users](#for-users)
  - [Setting up connectors](#setting-up-connectors)
  - [Connector bundles](#connector-bundles)
  - [Extension point](#extension-point)
- [For Developers](#for-developers)
  - [Contract Component](#contract-component)
  - [The four layers](#the-four-layers)
  - [Adapter capability matrix](#adapter-capability-matrix)
  - [Generated files](#generated-files)
  - [Documentation](#documentation)

## For Users

### Setting up connectors

Install or refresh a connector with:

```bash
ovld agent-setup <agent>    # claude | codex | cursor | pi | antigravity | opencode | all
ovld doctor                 # verify managed files and permissions
```

Each adapter README documents harness-specific install steps, slash commands,
and namespaced component names. Re-run `ovld agent-setup` safely whenever the
connector contract version changes.

### Connector bundles

- [Claude Code](adapters/claude/README.md): installable Claude plugin bundle with a Claude overlay for the shared core, slash commands, hooks, adapter manifest, prompt wrapper notes, and connector conformance manifest.
- [Codex](adapters/codex/README.md): Codex plugin with hooks, MCP bridge, and permission warmup.
- [Cursor](adapters/cursor/README.md): Cursor plugin with slash commands, hooks, rules, and MCP bridge.
- [PI](adapters/pi/README.md): PI Agent skill and extension with follow-up capture and native-session resume.
- [Antigravity](adapters/antigravity/README.md): Antigravity plugin exposing the local mission workflow to Antigravity CLI/IDE sessions.
- [OpenCode](adapters/opencode/README.md): control-plane connector (Shape C) driven by `ovld agent-session sidecar` — no hook scripts.

### Extension point

A custom agent connector is a sanctioned extension point: a new adapter plus a
`conformance-manifest.yaml` validated by `ovld contract check`. See the
[Conformance Requirements](../CONTRACT.md) and the example manifest at
[`../contract/examples/connector-claude-conformance-manifest.yaml`](../contract/examples/connector-claude-conformance-manifest.yaml).

## For Developers

### Contract Component

Maps to the **Connector Layer** (`connector`) in [`CONTRACT.md`](../CONTRACT.md), which owns:

- Connector core workflow instructions
- Per-agent plugin/adapter files and their managed-file manifests
- Hook scripts and their event contracts (`UserPromptSubmit`, `PermissionRequest`, `Stop`)
- `ovld agent-setup <agent>` / `ovld agent-setup all` and `ovld doctor` behavior
- Connector capability declarations (the approved capability flag set)

It does **not** own protocol command implementations (→ [CLI module](../cli/README.md))
or the harness extension catalog (→ Extension System, see [Database module](../database/README.md)).

### The four layers

- **Connector Core** — primary instructions in Markdown; the base every plugin extends. The shared source lives in [`core/`](core/).
- **Connector Plugins** — customizable extensions of the core, per harness.
- **Plugin Adapters** — package plugins into a harness via its native plugin/connector manager (Claude, Codex, Cursor).
- **Prompt Wrappers** — instructions + key data wrapping the user's prompt at LLM submission time.

### Adapter capability matrix

> **Agent-session interaction capabilities are not documented here.** What a harness can
> observe, decide, and inject — and whether a gap is a hard limit, unbuilt work, or simply
> unknown — lives in the generated, fixture-backed [harness capability
> matrix](HARNESS-MATRIX.md) and each adapter's `CAPABILITIES.md`. Prose maintained by hand
> alongside code drifts, and a matrix that is 60% accurate is worse than none because it is
> trusted. Run `ovld agent-session capabilities <agent>` for the same answer in a terminal.

The table below is about **packaging**, not interaction: which files each adapter ships and,
where a mechanism is absent, whether the gap is a decision or simply unported work — so a
contributor adding an adapter can tell signal from neglect. Source of truth for the
"ships" columns is each adapter's `conformance-manifest.yaml`.

| Adapter       | Commands      | Hooks                                                 | Local MCP shim | MCP config        | Rules    | Native resume |
| ------------- | ------------- | ----------------------------------------------------- | -------------- | ----------------- | -------- | ------------- |
| `claude`      | `commands/`   | `hooks/hooks.json` (5 types)                          | —              | —                 | —        | —             |
| `codex`       | —             | `.codex-plugin/hooks.json` + `scripts/*.sh` (2 types) | rendered       | `.mcp.json`       | —        | yes           |
| `cursor`      | `commands/`   | `hooks/*.sh` (4 types)                                | rendered       | `mcp.json`        | `rules/` | —             |
| `antigravity` | `skills/*.md` | `hooks.json` + `scripts/*.sh` (2 types)               | rendered       | `mcp_config.json` | —        | —             |
| `pi`          | —             | `extensions/overlord.ts` (input/tool/session events)  | —              | —                 | —        | yes           |
| `opencode`    | —             | none — control plane, see below                       | —              | —                 | —        | —             |

Intentional omissions:

- **`opencode` ships no hooks, and never will.** It is a control-plane harness (Shape C): it
  runs a local HTTP server and publishes an event stream, so integration means subscribing
  rather than being invoked. Overlord drives it with `ovld agent-session sidecar`, started
  alongside the harness. The sidecar implements event reconciliation, concurrent permission
  observation, and `prompt_async` instruction delivery, but the bundled agent catalog does not
  yet start it automatically. A supervised execution target must supply that launch integration.
- **`claude` ships no local MCP shim.** The Claude plugin reaches Overlord's hosted
  MCP server, so a local stdio bridge would duplicate it.
- **`pi` ships no shim, hooks directory, or commands.** PI integrates through one TypeScript
  extension. It has no native permission dialog; its optional `tool_call` decision interceptor
  is fail-open and requires explicit workspace and project opt-in.
- **`antigravity` passes no model or effort flag.** Antigravity selects the model
  internally; see [05 — Connectors and Agent Plugins](docs/05-connectors-and-agent-plugins.md#antigravity-connector).
- **`cursor` passes no effort/thinking flag.** Deferred, not declined — recorded in
  the Cursor requirements as "no thinking/effort flag required initially".

Unconfirmed gaps — read these as unported rather than declined, and file feature
work as its own mission rather than folding it into a docs change:

- `codex` ships no `commands/` while `claude` and `cursor` do, and `antigravity`
  achieves the same surface through `skills/*.md`. No harness constraint is recorded.
- `antigravity` registers no post-tool mutation or Stop hook; whether its harness exposes
  equivalent events is not documented here.

### Generated files

The local MCP shim and post-tool capture callback are **generated**, not committed per
adapter. `ovld agent-setup` renders their core sources with the adapter key substituted:

- [`core/scripts/overlord-mcp.mjs`](core/scripts/overlord-mcp.mjs) becomes the local MCP
  shim for Codex, Cursor, and Antigravity.
- [`core/scripts/capture-change-hook.sh`](core/scripts/capture-change-hook.sh) becomes
  Claude's and Codex's `scripts/post-tool-use-hook.sh` and Cursor's
  `hooks/overlord-post-tool-use.sh`.

Edit the core source; there are no adapter copies. Installed paths and native hook
registrations remain harness-specific.

### Documentation

- [Connector Core](core/README.md): shared workflow instructions and protocol references consumed by connector plugins.
- [05 — Connectors and Agent Plugins](docs/05-connectors-and-agent-plugins.md): connector core, plugins, adapters, hooks, setup, doctor, launch mapping.
- [Agent and Harness Configuration Architecture](docs/agent-harness-configuration-architecture.md): ownership boundaries for agent catalogs, user harnesses, execution-target launch settings, objective launch overrides.
- [Test Plan](docs/testing.md): structural + behavioral test plan for connectors — manifest/capability conformance, managed-files integrity, hook-script protocol-only boundary, setup/doctor, and the new-connector admission gate. Part of the root [TEST_PLAN.md](../TEST_PLAN.md).
