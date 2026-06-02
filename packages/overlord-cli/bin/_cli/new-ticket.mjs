#!/usr/bin/env node

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';

import { buildAuthHeaders, resolveAuth, resolveOrganizations } from './credentials.mjs';
import { runLauncherCommand } from './launcher.mjs';

const PROMPT_AGENT_IDENTIFIERS = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
  opencode: 'opencode'
};
const PROMPT_AGENTS = Object.keys(PROMPT_AGENT_IDENTIFIERS);

function parseFlags(args) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      continue;
    }

    const key = arg.slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[i + 1];
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
}

function buildUsage(commandName) {
  if (commandName === 'prompt') {
    return 'Usage: ovld prompt --objectives-json \'[{"objective":"..."}]\' [--objectives-file <path>] [--title "..."] [--acceptance-criteria "..."] [--available-tools "..."] [--for-human] [--priority low|medium|high|urgent] [--project-id <id>] [--agent <agent>] [--model <identifier>] [--delegate <agent>]';
  }

  return 'Usage: ovld create --objectives-json \'[{"objective":"..."}]\' [--objectives-file <path>] [--title "..."] [--acceptance-criteria "..."] [--available-tools "..."] [--for-human] [--priority low|medium|high|urgent] [--project-id <id>] [--agent <agent>] [--model <identifier>] [--delegate <agent>]';
}

function resolveForHumanFlag(flags) {
  if (flags['for-human'] !== undefined) {
    const raw = flags['for-human'];
    if (raw === true) return true;
    const normalized = String(raw).trim().toLowerCase();
    return normalized === '' || normalized === 'true' || normalized === '1';
  }

  if (flags['execution-target'] !== undefined) {
    return String(flags['execution-target']).trim().toLowerCase() === 'human';
  }

  return false;
}

function ensureObjective(commandName, objective) {
  if (objective) return;

  console.error(`Error: objective is required.\n`);
  console.error(buildUsage(commandName));
  process.exit(1);
}

function parseJsonFlag(flagName, rawValue) {
  try {
    return JSON.parse(String(rawValue));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${flagName} must be valid JSON: ${detail}`);
  }
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `${label}: could not read or parse "${filePath}": ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function readTextFromStdin(label) {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  } catch (err) {
    throw new Error(
      `${label}: could not read stdin: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonFileOrStdin(filePath, label) {
  if (filePath !== '-') return readJsonFile(filePath, label);
  try {
    return JSON.parse(await readTextFromStdin(label));
  } catch (err) {
    throw new Error(
      `${label}: could not parse stdin: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function resolveObjectiveInput(flags) {
  if (flags['objectives-json'] && flags['objectives-file']) {
    throw new Error('Use either --objectives-json or --objectives-file, not both');
  }

  if (flags['objectives-json']) {
    const objectives = parseJsonFlag('--objectives-json', flags['objectives-json']);
    if (!Array.isArray(objectives) || objectives.length === 0) {
      throw new Error('--objectives-json must be a non-empty JSON array');
    }
    return { objectives };
  }

  if (flags['objectives-file']) {
    const objectives = await readJsonFileOrStdin(
      String(flags['objectives-file']),
      '--objectives-file'
    );
    if (!Array.isArray(objectives) || objectives.length === 0) {
      throw new Error('--objectives-file must contain a non-empty JSON array');
    }
    return { objectives };
  }

  throw new Error('Provide --objectives-json or --objectives-file');
}

export function parseNumberedSelection(rawValue, count) {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const selected = Number.parseInt(trimmed, 10);
  if (selected < 1 || selected > count) return null;

  return selected - 1;
}

export function sortProjects(projects) {
  return [...projects].sort((left, right) => {
    const byOrganization = String(left.organizationName ?? '').localeCompare(
      String(right.organizationName ?? '')
    );
    if (byOrganization !== 0) return byOrganization;

    const byName = String(left.name ?? '').localeCompare(String(right.name ?? ''));
    if (byName !== 0) return byName;

    return String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
}

function projectLabel(project) {
  const organizationName = String(project.organizationName ?? '').trim();
  return organizationName ? `${project.name} - ${organizationName}` : project.name;
}

async function promptForSelection({ items, label, prompt, renderItem }) {
  if (!items.length) {
    throw new Error(`No ${label.toLowerCase()} available.`);
  }

  const rl = readline.createInterface({ input, output });
  const question = promptText =>
    new Promise((resolve, reject) => {
      const handleError = error => {
        rl.off('error', handleError);
        reject(error);
      };

      rl.once('error', handleError);
      rl.question(promptText, answer => {
        rl.off('error', handleError);
        resolve(answer);
      });
    });

  try {
    while (true) {
      output.write(`\n${label}\n`);
      items.forEach((item, index) => {
        output.write(`  ${index + 1}. ${renderItem(item, index)}\n`);
      });

      const answer = await question(`\n${prompt} `);
      const selectedIndex = parseNumberedSelection(answer, items.length);
      if (selectedIndex !== null) {
        return items[selectedIndex];
      }

      output.write(`Enter a number between 1 and ${items.length}.\n`);
    }
  } finally {
    rl.close();
  }
}

async function fetchProjects(platformUrl, bearerToken, localSecret, organizationId) {
  const res = await fetch(`${platformUrl}/api/protocol/projects`, {
    headers: buildAuthHeaders(bearerToken, localSecret, organizationId)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Failed to list projects (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }

  return Array.isArray(data.projects) ? data.projects : [];
}

/**
 * Lists projects across every organization the identity belongs to.
 *
 * The CLI is organization-agnostic: instead of listing only a single default
 * org's projects, it resolves the membership list and fans out the per-org
 * projects query, then merges and de-duplicates by project id. Each project
 * carries its own `organizationId`, so the caller scopes follow-up writes (ticket
 * creation, resource registration) to the chosen project's org — no default org.
 *
 * @param {{ platformUrl: string, bearerToken: string, localSecret?: string }} auth
 */
export async function fetchProjectsAcrossOrganizations(auth) {
  const { platformUrl, bearerToken, localSecret } = auth;
  const organizations = await resolveOrganizations(auth);

  // No memberships resolved (or a backend that scopes by membership anyway): fall
  // back to a single unscoped query so the command still works.
  if (!organizations.length) {
    return sortProjects(await fetchProjects(platformUrl, bearerToken, localSecret, null));
  }

  const results = await Promise.allSettled(
    organizations.map(org => fetchProjects(platformUrl, bearerToken, localSecret, org.id))
  );
  const failures = results
    .map((result, index) => ({ result, organization: organizations[index] }))
    .filter(({ result }) => result.status === 'rejected');
  if (failures.length > 0) {
    const detail = failures
      .map(({ result, organization }) => {
        const reason = result.status === 'rejected' ? result.reason : null;
        const message = reason instanceof Error ? reason.message : String(reason);
        return `${organization.name || `organization ${organization.id}`} (${organization.id}): ${message}`;
      })
      .join('; ');
    throw new Error(`Project listing returned partial failures: ${detail}`);
  }

  const perOrg = results.map(result => (result.status === 'fulfilled' ? result.value : []));

  const byId = new Map();
  for (const project of perOrg.flat()) {
    if (project && project.id && !byId.has(project.id)) {
      byId.set(project.id, project);
    }
  }

  return sortProjects([...byId.values()]);
}

async function createTicket(platformUrl, bearerToken, localSecret, organizationId, body) {
  const res = await fetch(`${platformUrl}/api/protocol/tickets`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(bearerToken, localSecret, organizationId),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Failed to create ticket (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }

  return data.ticket;
}

function resolveProject(projects, projectId) {
  if (!projectId) return null;

  const project = projects.find(candidate => candidate.id === projectId);
  if (!project) {
    throw new Error(`Unknown project ID: ${projectId}`);
  }

  return project;
}

function resolveAgent(agent) {
  if (!agent) return null;

  const normalizedAgent = agent.trim().toLowerCase();
  if (!PROMPT_AGENTS.includes(normalizedAgent)) {
    throw new Error(`Unknown agent: "${agent}". Must be one of: ${PROMPT_AGENTS.join(', ')}`);
  }

  return normalizedAgent;
}

export function resolvePromptAgentIdentifier(agent) {
  return PROMPT_AGENT_IDENTIFIERS[agent] ?? agent;
}

export function resolveTicketCreationModelIdentifier(flags = {}) {
  const explicitModel = typeof flags.model === 'string' ? flags.model.trim() : '';
  if (explicitModel) return explicitModel;

  const envModel =
    process.env.OVERLORD_MODEL_IDENTIFIER?.trim() ||
    process.env.MODEL_IDENTIFIER?.trim() ||
    process.env.AGENT_MODEL?.trim();
  return envModel || null;
}

export function resolveTicketCreationDelegate(flags = {}, selectedAgent = null, modelIdentifier = '') {
  const explicitDelegate = typeof flags.delegate === 'string' ? flags.delegate.trim() : '';
  if (explicitDelegate) return explicitDelegate;

  const resolvedModel = typeof modelIdentifier === 'string' ? modelIdentifier.trim() : '';
  if (resolvedModel) return resolvedModel;

  const explicitAgent = typeof flags.agent === 'string' ? flags.agent.trim() : '';
  if (explicitAgent) return resolvePromptAgentIdentifier(explicitAgent.toLowerCase()) ?? explicitAgent;

  if (selectedAgent) return resolvePromptAgentIdentifier(selectedAgent);

  const envAgent = process.env.AGENT_IDENTIFIER?.trim();
  return envAgent || null;
}

async function runTicketCreationFlow(args, { commandName, launchAgent }) {
  const { flags } = parseFlags(args);
  const objectiveInput = await resolveObjectiveInput(flags);

  const auth = await resolveAuth();
  const { platformUrl, bearerToken, localSecret } = auth;
  const projects = await fetchProjectsAcrossOrganizations(auth);

  if (!projects.length) {
    throw new Error('No projects available. Create a project first.');
  }

  const selectedProject =
    resolveProject(projects, typeof flags['project-id'] === 'string' ? flags['project-id'] : '') ??
    (await promptForSelection({
      items: projects,
      label: 'Projects',
      prompt: 'Select a project by number:',
      renderItem: project => projectLabel(project)
    }));

  // The ticket is created in the organization that owns the chosen project,
  // never a stored default org.
  const organizationId = selectedProject.organizationId ?? null;

  const selectedAgent = launchAgent
    ? (resolveAgent(typeof flags.agent === 'string' ? flags.agent : '') ??
      (await promptForSelection({
        items: PROMPT_AGENTS,
        label: 'Agents',
        prompt: 'Select an agent by number:',
        renderItem: agent => agent
      })))
    : null;

  const modelIdentifier = resolveTicketCreationModelIdentifier(flags);
  const ticketDelegate = resolveTicketCreationDelegate(flags, selectedAgent, modelIdentifier);

  const ticket = await createTicket(platformUrl, bearerToken, localSecret, organizationId, {
    ...objectiveInput,
    title: String(flags.title ?? ''),
    acceptanceCriteria: String(flags['acceptance-criteria'] ?? ''),
    availableTools: String(flags['available-tools'] ?? ''),
    forHuman: resolveForHumanFlag(flags),
    priority: String(flags.priority ?? 'medium'),
    projectId: selectedProject.id,
    ...(ticketDelegate ? { delegate: ticketDelegate } : {})
  });

  if (!launchAgent) {
    console.log(`ticket created with id ${ticket.id}`);
    return;
  }

  process.env.TICKET_ID = ticket.id;
  await runLauncherCommand('run', [selectedAgent, '--ticket-id', ticket.id]);
}

export async function runCreateCommand(args) {
  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`${buildUsage('create')}

Creates a ticket after interactive numbered project selection.

Examples:
  ovld create --objectives-json '[{"objective":"Implement login page"}]'
  ovld create --objectives-json '[{"objective":"Fix sync bug"}]' --project-id <project-id>
`);
    return;
  }

  await runTicketCreationFlow(args, { commandName: 'create', launchAgent: false });
}

export async function runPromptCommand(args) {
  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`${buildUsage('prompt')}

Creates a ticket after interactive numbered project selection, then lets you pick an agent by number and launches it on the new ticket.

Examples:
  ovld prompt --objectives-json '[{"objective":"Implement login page"}]'
  ovld prompt --objectives-json '[{"objective":"Investigate flaky tests"}]' --agent codex --model gpt-5.4
`);
    return;
  }

  await runTicketCreationFlow(args, { commandName: 'prompt', launchAgent: true });
}
