# Connector Core

Connector Core is the shared source for Overlord workflow instructions that every agent connector extends.

## Table of Contents

- [For Users](#for-users)
  - [What Connector Core provides](#what-connector-core-provides)
- [For Developers](#for-developers)
  - [Core vs adapter responsibilities](#core-vs-adapter-responsibilities)
  - [Files](#files)

## For Users

### What Connector Core provides

Connector Core defines the durable protocol behavior every agent connector must
follow:

- attach before execution work
- treat mission context as authoritative
- update or heartbeat while working
- ask exactly one blocking question and stop
- deliver last with artifacts and change rationales
- use safe stdin/file flags for shell-special payloads
- repair local auth/setup before asking the user to intervene

You do not install Connector Core directly. It is bundled into each agent adapter
that ships a skill/command bundle (Claude, Codex, Cursor, PI, Antigravity) when you
run `ovld agent-setup <agent>`. OpenCode is a control-plane connector with no skill
bundle — see [its README](../adapters/opencode/README.md). See the
[connectors module README](../README.md) for setup instructions.

## For Developers

### Core vs adapter responsibilities

Adapters own harness-specific packaging:

- native plugin manifests
- slash commands, commands, or MCP tool aliases
- hook registration and scripts
- launch prompt wrappers
- model, effort, and context-file flag mapping

When building a Connector Plugin, adapter skill templates include `<!-- @connector-core -->`.
`ovld agent-setup <agent>` interpolates connector core content from
`connectors/core/overlord-mission/` into that marker and copies core reference files
into the installable plugin package. Do not fork the core protocol rules into each adapter.

The same rendering path carries the local MCP shim. `scripts/overlord-mcp.mjs` is the
single source for the stdio MCP bridge that Codex, Cursor, and Antigravity install;
`ovld agent-setup <agent>` substitutes `__OVERLORD_ADAPTER_KEY__` with the adapter key
(`DEFAULT_AGENT` and `serverInfo.name`) and writes the result into the adapter's install
path. There are no adapter-local copies to keep in step. Two constraints hold when
editing it:

- It must stay a standalone runnable `.mjs`. The rendered file is copied into the
  user's home and started directly by the harness, so it may not import anything
  repo-local or require a build step.
- The tool list must stay in parity with the hosted MCP catalog; `backend/mcp.test.ts`
  asserts this against `mcp/tool-catalog.ts`.

Post-tool mutation capture uses the same ownership model. The single
`scripts/capture-change-hook.sh` template is rendered with the adapter key into the existing
Claude, Codex, and Cursor native hook paths. It must remain standalone Bash, scope only from
`OVERLORD_OBJECTIVE_ID`, and pass stdin unchanged to `ovld protocol capture-change`. Adapter
directories contain the native registrations, fixtures, and managed paths, but no callback copy.

`connectors/VERSION` drives the reported `serverInfo.version`; patch it with
`yarn connectors:version:sync`, never by hand.

### Files

- `overlord-mission/SKILL.md` — shared mission lifecycle workflow.
- `overlord-mission/reference/` — shared protocol, context, device, MCP/API, and shell-escaping references.
- `scripts/overlord-mcp.mjs` — shared local MCP shim, rendered per adapter.
- `scripts/capture-change-hook.sh` — shared post-tool mutation callback, rendered into each
  supporting adapter's native managed path.
