---
name: mobile-app
description: Keep mobile features aligned with the web app. Use when changing shared product behavior, data loading, or UI in apps/mobile that has a web counterpart in apps/web.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# Mobile / web parity

Mobile and web are separate UIs over the same product. When web behavior changes, mobile should follow in the same change or via an explicit follow-up ticket.

Use this skill when working in `apps/mobile` on a feature that exists (or will exist) on web. For mobile-only concerns (Expo Router, native tabs, platform APIs), use the relevant Expo skills instead.

## Feature index

| Feature | Status | Section |
| --- | --- | --- |
| Agent model chooser | Documented | [Agent model chooser](#agent-model-chooser) |
| *(add future features here)* | — | — |

When you add parity guidance for a new feature, add a row to this table and a new `##` section below.

## General rules

1. **Web is the reference for product behavior** — filtering, defaults, validation, and data precedence should match web unless mobile has a documented platform exception.
2. **Share logic, not UI** — prefer shared helpers in `lib/` or mirrored helper modules (`apps/mobile/lib/*` ↔ `apps/web/components/features/*` or `apps/web/lib/*`) over duplicating rules in components.
3. **Same data sources** — use the same Supabase tables, schemas (`lib/schemas/*`), and parsers as web.
4. **Document gaps** — if mobile intentionally lags web, note the gap in the feature section and in the ticket/PR.
5. **Update both surfaces** — web-only changes to shared behavior should trigger a mobile update (or a tracked follow-up).

## Adding a new feature section

Copy this template when documenting the next feature:

```markdown
## Feature name

**Use when:** …

### Canonical references

| Surface | Path |
| --- | --- |
| Mobile | `apps/mobile/...` |
| Web | `apps/web/...` |
| Shared | `lib/...` |

**Rule:** …

### Behavior

…

### Anti-patterns

- …

### Verification

1. …
```

---

## Agent model chooser

**Use when:** Changing agent/model/thinking UI or preference loading in `apps/mobile`.

### Canonical references

| Surface | Path |
| --- | --- |
| Mobile chooser | `apps/mobile/components/AgentModelChooser.tsx` |
| Web selector | `apps/web/components/features/AgentModelSelector.tsx` |
| Mobile helpers | `apps/mobile/lib/agent-models.ts` |
| Web store / helpers | `apps/web/components/features/agent-model-selector/agent-model-store.ts` |
| Config schema | `lib/schemas/agent-config.ts` |
| Visibility settings (web) | `apps/web/components/modals/settings/cli/AgentVisibilitySection.tsx` |

**Rule:** The mobile `AgentModelChooser` must mirror the web `AgentModelSelector` for what options appear and how they are filtered. When web behavior changes, update mobile helpers and the chooser in the same change (or file a follow-up ticket).

### Visibility (`user_agent_configs`)

Users hide agents and models in web settings (`AgentVisibilitySection`). Those preferences live in `user_agent_configs.config`:

- `hidden: true` — hide a built-in agent from the selector
- `hiddenModels: string[]` — hide specific offered `model_id`s for an agent

Mobile must apply the same filters:

- **Agents:** `getVisibleBuiltInAgents` — show agents where `!config.hidden`, except the currently selected agent always stays visible (so a hidden agent does not trap the user).
- **Models:** `getVisibleModelsForAgent` — offered models minus `config.hiddenModels` for that agent.

Do not render the full `AGENT_OPTIONS` list without passing through visibility helpers.

### Models column

Match web logic:

1. **Antigravity** — no model list; show “Antigravity chooses models in its own UI.”
2. **Default model** — `model: null` option always available for built-in agents (except antigravity).
3. **Cursor Auto** — when `agent === 'cursor'`, include the `auto` pseudo-model (not from `agent_models` table).
4. **Offered models** — from `agent_models` where `is_offered`, grouped by `agent_type`, then filtered by `hiddenModels`.

### Thinking / effort column

Use `supportsBuiltInThinkingSelection(agent, antigravityManagesModels)`:

- Hidden for antigravity and **cursor** (cursor uses Auto / explicit models only).
- Shown for other built-in agents when the selected model has `thinking_options`.
- Label: `getAgentThinkingLabel` — “Effort” for codex, “Thinking” otherwise.

Only render the thinking section when `thinkingEnabled && thinkingOptions.length > 0`.

### Launch footer

`AgentLaunchFooter` in the chooser reads pre-command and flags from the **selected execution target** (`execution-targets-context`), matching how web ties launch config to the active target. Do not introduce a second global flags store.

### Custom agents (parity checklist)

Web also lists **custom agents** from `user_agent_configs` row `__custom__` (`CUSTOM_AGENTS_CONFIG_KEY`) and supports `customAgentId` on `AgentModelSelection`. Mobile types and chooser UI should be extended to match when custom agents are required on mobile; until then, document any gap in the ticket.

### Data loading

- Models: `agent_models` table, normalized with `normalizeAgentModels` (`is_offered` only).
- Configs: `user_agent_configs`, parsed with `parseAgentUserConfig` / `normalizeUserAgentConfigs` (full schema, not just defaults).
- Default selection: `resolveAgentModelSelection(configs, launchPreference)` — same precedence as web.

### Anti-patterns

- Showing every built-in agent regardless of `hidden`.
- Listing all offered models without subtracting `hiddenModels`.
- Using `agent !== 'codex'` for thinking visibility (web excludes **cursor**, not codex).
- Duplicating filter logic inline in the component — add or reuse helpers in `agent-models.ts`.

### Verification

1. On web settings, hide an agent and a model for another agent.
2. Open mobile ticket create or detail chooser — hidden agent/model must not appear (selected hidden agent still visible if already selected).
3. Cursor agent shows Default + Auto + offered models; thinking column hidden.
4. Codex shows “Effort” label when thinking options exist.

<!-- version: 1.1.0 -->
