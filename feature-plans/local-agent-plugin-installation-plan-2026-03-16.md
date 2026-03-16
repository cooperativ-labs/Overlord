# Engineering Plan: Local Agent Plugin Installation

**Date:** 2026-03-16
**Status:** Planning
**Author:** AI Engineering Agent

---

## Objective

Reduce the amount of reusable Overlord protocol guidance embedded in per-ticket prompts by installing durable local agent configuration when Overlord desktop is installed.

Primary targets:

- Claude Code
- Codex

The same configuration model should later be reusable by the standalone `ovld` CLI.

---

## Current State

The current local flow is prompt-heavy:

- [`lib/overlord/ticket-prompt.ts`](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts) includes the full local Overlord protocol contract in every ticket prompt.
- [`app/api/protocol/context/[ticketId]/route.ts`](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts) returns the same prompt shape for all local launches.
- [`electron/services/agent-launcher.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts) fetches that prompt, injects a temporary Claude settings file for permission notifications, and launches the agent.
- [`packages/overlord-cli/bin/_cli/launcher.mjs`](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs) also forwards the full fetched prompt directly into Claude or Codex.
- [`components/modals/settings/CliPage.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx) already exposes manual installation steps for mid-session agent commands, which proves there is demand for persistent agent-side setup.

That works, but it duplicates global guidance in every run, keeps local-agent behavior opaque, and makes prompt format changes harder to reason about.

---

## External Constraints

Based on current vendor docs:

- Claude Code supports durable personal/project memory in `CLAUDE.md`, persistent hooks in settings files, and reusable skills/commands in `~/.claude/skills/` or `.claude/skills/`.
- Claude docs also reference plugin-scoped skills, but the documented and stable install surface we can control today is still the user/project filesystem under `~/.claude/`.
- Codex supports durable global instructions in `~/.codex/AGENTS.md` and durable user/project config in `~/.codex/config.toml`.
- Codex CLI and IDE extension share the same config layers, which is useful for future CLI reuse.
- Codex does not expose a documented equivalent of Claude’s installable local hook/skill bundle for this use case, so the safest supported path is `AGENTS.md` plus config.

Inference:

- We should treat “plugin” as an Overlord-managed local configuration bundle, not as a requirement to depend on an undocumented vendor-specific packaging mechanism.

---

## Recommendation

Implement a versioned **Overlord local agent bundle** with two installation modes:

1. **Claude Code**
   Install durable Overlord-owned files under `~/.claude/`:
   - one or more Overlord skills containing reusable protocol guidance and slash-style ticket actions
   - a merged settings entry for the Overlord permission notification hook
   - optionally an Overlord-owned memory import if repeated global guidance still belongs outside the per-ticket prompt

2. **Codex**
   Install durable Overlord-owned files under `~/.codex/`:
   - `AGENTS.md` content for reusable Overlord local workflow instructions
   - `config.toml` entries only where they are clearly supported and useful
   - no attempt to emulate undocumented plugin behavior

Then split prompt generation into:

- **Slim local prompt** for agents with the bundle installed
- **Legacy verbose prompt** for agents without it and for generic paste/web flows

Non-destructive install requirement:

- For both Claude and Codex, Overlord must never replace the user's existing config wholesale.
- Installers must merge or append only the Overlord-owned additions needed for local workflow support.
- If a file cannot be merged safely, the installer should leave the original file untouched and surface a repair/manual-step message instead of overwriting it.

---

## Proposed Architecture

## 1. Introduce agent capability-aware prompt generation

Add an explicit capability model instead of assuming every local agent needs the same prompt:

- `legacy_local_prompt`
- `bundle_backed_local_prompt`
- `remote_mcp_prompt`

Suggested implementation points:

- add an agent capability resolver in a new module such as `lib/overlord/agent-capabilities.ts`
- extend the context route to accept `agent` and `instructionMode`
- have Electron and `ovld` pass which agent is being launched and whether a managed bundle is installed

The slim prompt should keep:

- ticket-specific task details
- ticket id
- connector/base URL
- a short reminder to attach first
- any session-specific warnings

The slim prompt should remove reusable content that becomes part of installed agent config:

- the long attach/update/ask/deliver tutorial
- generic Overlord local workflow rules
- repeated slash-command instructions

## 2. Create a shared installer layer

Extract installation logic into a shared module that both Electron and the future CLI can call.

Suggested shape:

- `packages/overlord-cli/src/agent-setup/`
- resource templates stored alongside the CLI package
- Electron imports the same installer instead of owning its own bespoke file writes

Responsibilities:

- detect current install status per agent
- merge Overlord-owned config into user files without clobbering unrelated settings
- append to Markdown-based instruction files instead of replacing them
- write only namespaced/owned files when possible
- create backups before modifying user-managed root config files such as `~/.claude/settings.json` and `~/.codex/config.toml`
- record bundle version and hashes for repair/update detection
- expose `install`, `repair`, and `status` operations

## 3. Make Electron auto-install and repair the bundle

Extend the desktop install/update flow so it does more than install `ovld`.

Suggested changes:

- keep [`electron/services/cli-installer.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/services/cli-installer.ts) focused on CLI wrapper installation
- add a new service such as `electron/services/agent-bundle-installer.ts`
- run installation on first launch after login and again after app updates when the bundle version changes
- if installation fails, surface a clear repair action in Settings instead of silently degrading

Desktop should report status per agent:

- installed
- stale
- partial
- manual action required

## 4. Add future CLI parity now in the design

The eventual `ovld` CLI should use the same resources and merge logic:

- `ovld setup claude`
- `ovld setup codex`
- `ovld setup all`
- `ovld doctor` to validate installed files and prompt mode

Electron should call the same underlying installer, not a separate implementation.

---

## Agent-Specific Plan

## Claude Code

Use the documented filesystem-based surfaces under `~/.claude/`.

Recommended installed assets:

- `~/.claude/skills/overlord-local/SKILL.md`
  Contains reusable local Overlord workflow rules:
  - always attach first
  - post updates during work
  - deliver last
  - publish `user_follow_up` immediately when the human replies
  - use `ovld` or `npx overlord` commands for local protocol communication
- `~/.claude/skills/overlord-ticket-ops/SKILL.md`
  Optional helper for `/connect`, `/load`, `/spawn` equivalents if those should become personal rather than project-local
- merged hook entry in `~/.claude/settings.json`
  Replaces the current temp-file-only permission hook path with a durable Overlord-owned command

Important detail:

- Keep the current temporary hook fallback in [`electron/services/agent-launcher.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts) during rollout so existing launches do not regress while installation adoption is being validated.
- Merge into existing Claude settings arrays and objects in place. Do not rewrite the file to an Overlord-owned baseline.

Open question to settle during implementation:

- whether Claude-specific reusable guidance belongs best in a skill, a memory import, or both

My recommendation:

- put actionable workflow instructions in a skill
- keep only short evergreen setup notes in memory, if needed at all

## Codex

Use the documented durable global surfaces Codex already reads.

Recommended installed assets:

- `~/.codex/AGENTS.md`
  Contains reusable Overlord local workflow rules and ticket command patterns
- `~/.codex/config.toml`
  Only for supported durable config such as MCP settings or future Overlord-owned profiles if they materially help

Important constraint:

- Do not depend on a Codex “plugin” package concept for this ticket. The documented and portable mechanism is global `AGENTS.md` plus config.
- Treat existing `~/.codex/AGENTS.md` and `~/.codex/config.toml` as user-owned files. Overlord should append or merge only its own namespaced additions.

My recommendation:

- move reusable local workflow instructions into `~/.codex/AGENTS.md`
- keep ticket-specific data in the slim prompt
- leave MCP configuration as optional and separate from the local CLI-based ticket protocol path

Rationale:

- the ticket explicitly says Electron local communication should happen through the CLI
- MCP is useful for cloud or direct-tooling cases, but it is not the core local desktop transport

---

## Prompt Strategy

## Slim prompt for bundle-backed local agents

Example contents:

- task metadata and objective
- working directory
- connector URL
- ticket id
- one short directive:
  “Use your installed Overlord local workflow instructions. Start by attaching to this ticket.”
- any launch-mode override such as ask-mode

## Verbose fallback prompt

Keep the current full protocol walkthrough when:

- the bundle is not installed
- the agent is unknown
- the launch context is generic paste/share
- the user explicitly requests the full prompt

This preserves compatibility for:

- non-Claude/non-Codex agents
- older Electron builds
- manual copy/paste workflows

---

## Implementation Phases

## Phase 1: Bundle format and installer foundation

Build:

- shared resource templates for Claude and Codex
- install-status detection
- idempotent JSON/TOML/Markdown merge helpers
- version manifest storage

Deliverable:

- installer can write and verify Overlord-owned files without changing prompt behavior yet

## Phase 2: Electron integration

Build:

- Electron service for auto-install/repair
- settings UI for agent bundle status and repair
- telemetry/logging for install failures

Deliverable:

- desktop installs the bundle or clearly explains what manual step is required

## Phase 3: Prompt split

Build:

- capability-aware prompt generation
- agent-aware context route
- Electron and CLI launcher updates to request slim prompts when the bundle exists

Deliverable:

- Claude and Codex local launches receive shorter prompts

## Phase 4: CLI parity

Build:

- `ovld setup ...`
- `ovld doctor`
- optional non-Electron onboarding path that uses the same installer

Deliverable:

- the same setup works for desktop and standalone CLI users

---

## Files Likely To Change

- [`lib/overlord/ticket-prompt.ts`](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- [`app/api/protocol/context/[ticketId]/route.ts`](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts)
- [`electron/services/agent-launcher.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)
- [`electron/services/cli-installer.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/services/cli-installer.ts)
- [`packages/overlord-cli/bin/_cli/launcher.mjs`](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- [`components/modals/settings/CliPage.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx)
- [`components/modals/settings/AgentsAndMcpPage.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/AgentsAndMcpPage.tsx)

Likely new modules:

- `electron/services/agent-bundle-installer.ts`
- `lib/overlord/agent-capabilities.ts`
- shared installer/resources under `packages/overlord-cli/`

---

## Testing Plan

Add focused tests for:

- prompt selection logic
- Claude settings merge behavior
- Codex config merge behavior
- install status detection
- Electron install failure and repair flow
- launcher behavior when bundle is installed vs absent

Minimum test targets:

- unit tests around prompt generation
- unit tests around installer merge helpers
- one Electron integration test for status/repair wiring

---

## Risks

- overwriting user-managed Claude or Codex config if merges are not carefully namespaced
- assuming undocumented plugin behavior and building on unstable surfaces
- prompt drift if slim prompt and bundle instructions fall out of sync
- partial installs causing confusing hybrid behavior

Mitigations:

- use Overlord-owned sections/files where possible
- keep a verbose fallback path
- version and verify the installed bundle
- add a visible repair/status UI
- prefer additive merges and append-only updates for user-managed config files

---

## Recommended Decision

Proceed with a dual-path design:

- **Claude:** install a durable Overlord bundle under `~/.claude/` and then switch Claude desktop launches to slim prompts once the bundle is verified.
- **Codex:** install durable global `AGENTS.md` and supported config under `~/.codex/`, then switch Codex launches to slim prompts only after verification.
- **Everyone else:** keep the current verbose prompt path until a documented durable setup surface exists.

This gives Overlord a practical path to shorter prompts now without tying the product to undocumented plugin packaging, and it naturally extends to the future standalone CLI.
