# User-Controlled Agents, Models & Custom Harnesses

Ticket 1:1153. Give users control over which agents/harnesses & models appear in
their model selector, let them define custom agents via launch-command templates,
and let them specify a **pre-command** that runs before the agent binary (e.g.
`ollama` to run claude-code through Ollama). The Admin page configures *defaults*
but no longer hard-gates what users can see.

## Current architecture (before)

- `agent_models` table: admin toggles `is_offered`. `filterOfferedAgentModels`
  drops everything not offered, so admin offering is a hard gate for everyone.
- `user_agent_configs` table: per-user, per-agent JSONB `config`
  (`{ flags, defaultModel, defaultThinking, lastChosenModel, permissions }`).
  Validated by `agentConfigSchema` (`lib/schemas/agent-config.ts`).
- `AgentModelSelector` renders three columns: Agent (from fixed `AGENT_TYPES`),
  Model (from offered `agent_models`), Thinking (from the model's options).
- Launch path: `ovld launch <agent> --model --thinking --flag ...`.
  - `lib/overlord/launch-commands.ts` builds the `ovld launch` command string.
  - `packages/overlord-cli/bin/_cli/launcher.mjs` turns that into the real
    `claude/codex/agent/...` invocation (`buildExtraArgs`).
  - Desktop `apps/desktop/electron/services/agent-launcher.ts` builds the PTY
    command (`buildAgentCommand` / `buildModelThinkingFlags`).

## Design

Everything new is stored inside the existing `config` JSONB — **no migration**.

### Schema additions (`agentConfigSchema`)

- `preCommand?: string` — tokens prepended before the agent binary (e.g. `ollama`).
- `hidden?: boolean` — user hides this built-in agent from their selector.
- `hiddenModels?: string[]` — offered model_ids the user has hidden for this agent.

A reserved row (`agent_type = '__custom__'`) stores the custom-agent list under
a new top-level field on the same schema:

- `customAgents?: CustomAgent[]`

```ts
type CustomAgentOption = { value: string; label: string };
type CustomAgentPlaceholder = {
  token: string;            // e.g. "model" / "effort" — matched as {{token}}
  label: string;            // column header in the selector
  role: 'model' | 'thinking' | 'other';
  options: CustomAgentOption[];
};
type CustomAgent = {
  id: string;               // slug, unique per user
  name: string;             // display name
  commandTemplate: string;  // e.g. "ollama claude {{model}} --effort {{effort}}"
  placeholders: CustomAgentPlaceholder[];
};
```

Substitution: each `{{token}}` is replaced by the chosen option's `value`; unset
tokens collapse to empty and surrounding whitespace is normalized. The agent's
context prompt is appended as the final argument (same as built-in agents).

### Visibility (admin = default, not gate)

- `filterOfferedAgentModels` keeps using `is_offered` as the **catalog default**.
- The selector additionally subtracts the user's `hidden`/`hiddenModels`.
- A new `CliPage` "Available agents & models" section lists every offered agent
  and model with checkboxes; unchecking writes to `hidden`/`hiddenModels`.
- Default (no prefs) = everything offered is visible — no behavior change for
  users who never open the new settings.

### Custom agents in the selector

- `AgentModelSelection.agent` widened to `LaunchAgentType | string`; a custom
  selection uses `agent = customAgent.id` and is detected via the loaded custom
  list. A `Bot` (robot) icon represents custom agents (same icon as the run
  button).
- The custom agent's `role:'model'` placeholder feeds the Model column; the
  `role:'thinking'` placeholder feeds the Thinking column.

### Pre-command wiring (full stack)

1. `CliPage`: input under "Local agent configuration" mirroring the flags UI.
2. `launch-commands.ts`: emit `--pre-command <value>` on `ovld launch`.
3. `launcher.mjs`: parse `--pre-command`; when set, run the agent through it
   (`<preCommand> <agentBinary> ...args`).
4. Desktop `agent-launcher.ts`: prepend the pre-command to the built PTY command.

### Custom-agent launch

- `lib/helpers/custom-agent.ts`: `resolveCustomAgentCommand(template, values)`.
- CLI: `ovld launch-custom --command "<resolved>"` runs the resolved command with
  the fetched context appended. (Canonical, testable path.)
- Desktop PTY execution for custom agents (the Run button) is now wired via a
  generic PTY path. The Run button resolves the custom agent's command template
  in `AgentSplitButton`, queues it through `requestTicketObjectiveExecutionAction`
  with a `customCommand` (stored in `execution_requests.launch_params`), and the
  device claims it (`claim-execution`) and launches via the
  `terminal:launch-agent` IPC. `prepareAgentLaunch` / `buildAgentCommand`
  short-circuit to `<resolvedCommand> <contextRef>` (the same shape as the CLI
  path), fetching context with the generic `claude` instruction set and setting
  `AGENT_IDENTIFIER=custom`. The launch chain carries `customCommand` end-to-end:
  `AgentSplitButton` → `requestTicketObjectiveExecutionAction` →
  `createExecutionRequest` → `claim-execution` route →
  `use-execution-request-launcher` → `terminal.ts` IPC → `agent-launcher.ts`.

## Files touched

- `lib/schemas/agent-config.ts` — schema + types.
- `lib/actions/agent-config.ts` — preCommand, visibility, custom-agent actions.
- `lib/helpers/agent-model-preference.ts` — widen agent type.
- `lib/helpers/custom-agent.ts` — new template resolver.
- `apps/web/components/features/AgentModelSelector.tsx` — visibility + custom agents.
- `apps/web/components/modals/settings/CliPage.tsx` — pre-command, visibility,
  custom-agent form (robot icon).
- `lib/overlord/launch-commands.ts`, `packages/overlord-cli/bin/_cli/launcher.mjs`,
  `apps/desktop/electron/services/agent-launcher.ts` — pre-command.
- Admin panel copy: clarify offering = default, not a hard gate.
</content>
</invoke>
