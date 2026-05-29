#!/usr/bin/env node

/**
 * Direct agent launch: `ovld <agent> "<prompt>" [overlord flags] [-- passthrough]`.
 *
 * Creates a ticket from the prompt (project inferred from the working directory),
 * then launches the chosen agent on it — giving power users all of Overlord's
 * tracking without ever opening the desktop/web UI. Launch is limited to agents
 * with an installed connector (built-ins) or one of the user's custom agents.
 *
 * This is a thin composition over existing pieces:
 *   - `/api/protocol/prompt` creates + auto-titles the ticket and resolves the
 *     project from the working directory.
 *   - `runLauncherCommand('run' | 'launch-custom', …)` launches the agent locally.
 */

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import {
  BUILTIN_LAUNCH_AGENTS,
  agentIdentifierMap,
  runLauncherCommand
} from './launcher.mjs';
import { isAgentConnectorInstalled } from './setup.mjs';

/** Overlord flags that take a value (everything else after `--key` is a boolean). */
const VALUE_FLAGS = new Set([
  'project-id',
  'priority',
  'title',
  'acceptance-criteria',
  'available-tools',
  'working-directory',
  'model',
  'thinking',
  'delegate',
  'pre-command',
  'launch-mode',
  'organization-id',
  'ssh-command',
  'remote-working-directory',
  'server-multiplexer',
  'tmux-command',
  'feed-post-id',
  'initial-question'
]);

const BOOLEAN_FLAGS = new Set(['personal', 'for-human', 'allow-uninstalled']);

/** Launch flags forwarded verbatim to `ovld launch`/`launch-custom`. */
const FORWARDED_VALUE_FLAGS = [
  'pre-command',
  'launch-mode',
  'organization-id',
  'ssh-command',
  'remote-working-directory',
  'server-multiplexer',
  'tmux-command',
  'feed-post-id',
  'initial-question'
];

export function isBuiltinLaunchAgent(name) {
  return BUILTIN_LAUNCH_AGENTS.includes(String(name ?? '').trim().toLowerCase());
}

/**
 * Substitute `{{token}}` placeholders in a custom-agent command template.
 * Mirrors `resolveCustomAgentCommand` in lib/helpers/custom-agent.ts (kept in
 * sync by hand because the published CLI cannot import the app's TypeScript).
 */
export function resolveTemplate(template, values) {
  const substituted = String(template).replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_match, token) => {
      const value = values[token];
      return typeof value === 'string' ? value.trim() : '';
    }
  );
  return substituted.replace(/\s+/g, ' ').trim();
}

/** Default placeholder values for a custom agent given a model/thinking choice. */
export function buildCustomAgentValues(agent, model, thinking) {
  const values = {};
  for (const placeholder of agent.placeholders ?? []) {
    if (placeholder.role === 'model' && model) {
      values[placeholder.token] = model;
    } else if (placeholder.role === 'thinking' && thinking) {
      values[placeholder.token] = thinking;
    } else if (Array.isArray(placeholder.options) && placeholder.options.length > 0) {
      values[placeholder.token] = placeholder.options[0].value;
    }
  }
  return values;
}

/**
 * Parse direct-launch args into the objective, recognized Overlord flags, the
 * repeatable `--flag` values, and everything after a standalone `--`.
 */
export function parseDirectLaunchArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const sepIdx = args.indexOf('--');
  const head = sepIdx === -1 ? args : args.slice(0, sepIdx);
  const passthrough = sepIdx === -1 ? [] : args.slice(sepIdx + 1);

  const flags = {};
  const repeatedFlags = [];
  const positionals = [];

  for (let i = 0; i < head.length; i++) {
    const arg = head[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const key = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
    const inlineValue = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);

    if (key === 'flag') {
      const value = inlineValue !== undefined ? inlineValue : head[++i];
      if (value !== undefined) repeatedFlags.push(value);
      continue;
    }

    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] =
        inlineValue === undefined ? true : /^(1|true|yes|)$/i.test(inlineValue);
      continue;
    }

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    // Value-taking flag (known or unknown): consume the next token unless it
    // looks like another flag.
    if (i + 1 < head.length && !head[i + 1].startsWith('--')) {
      flags[key] = head[++i];
    } else {
      flags[key] = true;
    }
  }

  return {
    objective: positionals.join(' ').trim(),
    flags,
    repeatedFlags,
    passthrough
  };
}

function resolveForHuman(flags) {
  const raw = flags['for-human'];
  if (raw === undefined) return false;
  if (raw === true) return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '' || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchUserAgents({ platformUrl, bearerToken, localSecret, organizationId }) {
  const res = await fetch(`${platformUrl}/api/protocol/agents`, {
    headers: buildAuthHeaders(bearerToken, localSecret, organizationId)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Failed to list agents (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }
  return {
    builtins: Array.isArray(data.builtins) ? data.builtins : [],
    customAgents: Array.isArray(data.customAgents) ? data.customAgents : []
  };
}

async function createPromptTicket(
  { platformUrl, bearerToken, localSecret, organizationId },
  body
) {
  const res = await fetch(`${platformUrl}/api/protocol/prompt`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(bearerToken, localSecret, organizationId),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error ?? JSON.stringify(data);
    throw new Error(`Failed to create ticket (${res.status}): ${detail}`);
  }
  return data;
}

function printDirectLaunchHelp(agent = '<agent>') {
  console.log(`Usage:
  ovld ${agent} "<prompt>" [overlord flags] [-- <agent passthrough flags>]

Creates a ticket from the prompt (project inferred from the current directory),
then launches the agent on it and runs the normal ticket lifecycle.

Overlord flags:
  --model <identifier>          Preferred model (sets the ticket delegate and is forwarded to the agent)
  --thinking <level>            Agent reasoning/effort level
  --flag <value>                Extra agent flag (repeatable)
  --pre-command <command>       Shell command to run before the agent binary (e.g. ollama, agent-pod)
  --project-id <uuid>           Target project (skips working-directory resolution)
  --personal                    Create the ticket in your personal project
  --for-human                   Create a human-review ticket
  --priority <low|medium|high|urgent>
  --title "<title>"             Override the auto-generated title
  --working-directory <path>    Directory used for project resolution and launch
  --allow-uninstalled           Launch a built-in agent even if its connector isn't installed
  --launch-mode <run|ask>       Ask mode adjusts the fetched prompt context
  --ssh-command / --remote-working-directory / --server-multiplexer / --tmux-command

Agent passthrough:
  Anything after a standalone \`--\` is forwarded verbatim to the agent binary.

Examples:
  ovld claude "refactor the auth middleware" --model opus --thinking high
  ovld codex "investigate the memory leak" -- --search --full-auto
  ovld cursor "tidy the dashboard styles" --project-id <uuid> --for-human
  echo "summarize today's diffs" | ovld claude`);
}

/**
 * Entry point for `ovld <agent> …`. `agent` is argv[0]; `rawArgs` is the rest.
 */
export async function runDirectLaunch(agent, rawArgs = []) {
  if (rawArgs[0] === '--help' || rawArgs[0] === '-h' || rawArgs[0] === 'help') {
    printDirectLaunchHelp(agent);
    return;
  }

  const normalizedAgent = String(agent ?? '').trim().toLowerCase();
  const { objective: parsedObjective, flags, repeatedFlags, passthrough } =
    parseDirectLaunchArgs(rawArgs);

  let objective = parsedObjective;
  if (!objective && !process.stdin.isTTY) {
    objective = (await readStdin()).trim();
  }

  const builtin = isBuiltinLaunchAgent(normalizedAgent);
  const auth = await resolveAuth();

  // Classify + gate the agent before we create a ticket.
  let customAgent = null;
  if (builtin) {
    if (!flags['allow-uninstalled'] && !isAgentConnectorInstalled(normalizedAgent)) {
      console.error(
        `The ${normalizedAgent} connector is not installed. Run \`ovld setup ${normalizedAgent}\` first, ` +
          `or pass --allow-uninstalled to launch anyway.`
      );
      process.exit(1);
    }
  } else {
    const { customAgents } = await fetchUserAgents(auth);
    customAgent =
      customAgents.find(candidate => candidate.id === agent) ??
      customAgents.find(candidate => candidate.id === normalizedAgent) ??
      customAgents.find(candidate => candidate.name === agent) ??
      null;
    if (!customAgent) {
      console.error(`Unknown agent: "${agent}".`);
      console.error(`Built-in agents: ${BUILTIN_LAUNCH_AGENTS.join(', ')}`);
      console.error(
        customAgents.length
          ? `Your custom agents: ${customAgents.map(a => a.id).join(', ')}`
          : 'You have no custom agents. Create one in Overlord settings to launch it by id.'
      );
      process.exit(1);
    }
  }

  if (!objective) {
    console.error('An objective is required. Provide it as a quoted argument or pipe it via stdin.');
    printDirectLaunchHelp(agent);
    process.exit(1);
  }

  const personal = Boolean(flags.personal);
  const explicitProject =
    typeof flags['project-id'] === 'string' && flags['project-id'].trim().length > 0;
  const explicitWorkingDirectory =
    typeof flags['working-directory'] === 'string' && flags['working-directory'].trim().length > 0
      ? flags['working-directory'].trim()
      : '';
  // Send cwd so the server can resolve the project, unless the caller pinned a
  // project or asked for a personal ticket.
  const workingDirectory =
    explicitWorkingDirectory || (!explicitProject && !personal ? process.cwd() : '');

  const model = typeof flags.model === 'string' ? flags.model.trim() : '';
  const thinking = typeof flags.thinking === 'string' ? flags.thinking.trim() : '';
  const agentIdentifier = builtin ? agentIdentifierMap[normalizedAgent] : 'custom';
  const delegate =
    (typeof flags.delegate === 'string' && flags.delegate.trim()) || model || agentIdentifier;

  const body = {
    objectives: [{ objective }],
    agentIdentifier,
    connectionMethod: 'cli',
    metadata: { launchedVia: 'ovld-direct', ...(model ? { model } : {}) },
    delegate,
    ...(flags.title ? { title: String(flags.title) } : {}),
    ...(flags.priority ? { priority: String(flags.priority) } : {}),
    ...(explicitProject ? { projectId: String(flags['project-id']).trim() } : {}),
    ...(personal ? { personal: true } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(flags['acceptance-criteria']
      ? { acceptanceCriteria: String(flags['acceptance-criteria']) }
      : {}),
    ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
    ...(resolveForHuman(flags) ? { forHuman: true } : {})
  };

  const result = await createPromptTicket(auth, body);
  const ticketId = result.ticket?.ticket_id ?? result.ticket?.id;
  if (!ticketId) {
    console.error('Ticket creation did not return a ticket id.');
    process.exit(1);
  }

  console.log(`Created ticket ${ticketId} — launching ${agent}…`);
  process.env.TICKET_ID = String(ticketId);

  const baseLaunchArgs = ['--ticket-id', String(ticketId)];
  if (workingDirectory) baseLaunchArgs.push('--working-directory', workingDirectory);
  for (const name of FORWARDED_VALUE_FLAGS) {
    const value = flags[name];
    if (typeof value === 'string' && value.trim()) {
      baseLaunchArgs.push(`--${name}`, value.trim());
    }
  }

  if (builtin) {
    const launchArgs = [normalizedAgent, ...baseLaunchArgs];
    if (model) launchArgs.push('--model', model);
    if (thinking) launchArgs.push('--thinking', thinking);
    for (const flag of repeatedFlags) launchArgs.push('--flag', flag);
    // Forward `--` passthrough as individual agent flags (same channel as --flag).
    for (const token of passthrough) launchArgs.push('--flag', token);
    await runLauncherCommand('run', launchArgs);
    return;
  }

  // Custom agent: resolve the template locally, then append any --flag/passthrough
  // tokens to the resolved command (launch-custom runs `<command> <context>`).
  const values = buildCustomAgentValues(customAgent, model, thinking);
  const extraTokens = [...repeatedFlags, ...passthrough].filter(Boolean);
  const resolvedCommand = [resolveTemplate(customAgent.commandTemplate, values), ...extraTokens]
    .join(' ')
    .trim();
  await runLauncherCommand('launch-custom', ['--command', resolvedCommand, ...baseLaunchArgs]);
}
