#!/usr/bin/env node

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { runLauncherCommand } from './launcher.mjs';

const PROMPT_AGENTS = ['claude', 'codex', 'cursor', 'gemini', 'opencode'];

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
    return 'Usage: ovld prompt "<objective>" [--title "..."] [--acceptance-criteria "..."] [--available-tools "..."] [--execution-target agent|human] [--priority low|medium|high|urgent] [--project-id <id>] [--agent <agent>]';
  }

  return 'Usage: ovld create "<objective>" [--title "..."] [--acceptance-criteria "..."] [--available-tools "..."] [--execution-target agent|human] [--priority low|medium|high|urgent] [--project-id <id>]';
}

function ensureObjective(commandName, objective) {
  if (objective) return;

  console.error(`Error: objective is required.\n`);
  console.error(buildUsage(commandName));
  process.exit(1);
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

async function fetchProjects(platformUrl, agentToken, localSecret) {
  const res = await fetch(`${platformUrl}/api/protocol/projects`, {
    headers: buildAuthHeaders(agentToken, localSecret)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Failed to list projects (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }

  return Array.isArray(data.projects) ? sortProjects(data.projects) : [];
}

async function createTicket(platformUrl, agentToken, localSecret, body) {
  const res = await fetch(`${platformUrl}/api/protocol/tickets`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(agentToken, localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Failed to create ticket (${res.status}): ${data.error ?? JSON.stringify(data)}`);
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

async function runTicketCreationFlow(args, { commandName, launchAgent }) {
  const { flags, positionals } = parseFlags(args);
  const objective = String(flags.objective ?? positionals.join(' ')).trim();
  ensureObjective(commandName, objective);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const projects = await fetchProjects(platformUrl, agentToken, localSecret);

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

  const ticket = await createTicket(platformUrl, agentToken, localSecret, {
    objective,
    title: String(flags.title ?? ''),
    acceptanceCriteria: String(flags['acceptance-criteria'] ?? ''),
    availableTools: String(flags['available-tools'] ?? ''),
    executionTarget: String(flags['execution-target'] ?? 'agent'),
    priority: String(flags.priority ?? 'medium'),
    projectId: selectedProject.id
  });

  if (!launchAgent) {
    console.log(`ticket created with id ${ticket.id}`);
    return;
  }

  const selectedAgent =
    resolveAgent(typeof flags.agent === 'string' ? flags.agent : '') ??
    (await promptForSelection({
      items: PROMPT_AGENTS,
      label: 'Agents',
      prompt: 'Select an agent by number:',
      renderItem: agent => agent
    }));

  process.env.TICKET_ID = ticket.id;
  await runLauncherCommand('run', [selectedAgent, '--ticket-id', ticket.id]);
}

export async function runCreateCommand(args) {
  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`${buildUsage('create')}

Creates a ticket after interactive numbered project selection.

Examples:
  ovld create "Implement login page"
  ovld create "Fix sync bug" --project-id <project-id>
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
  ovld prompt "Implement login page"
  ovld prompt "Investigate flaky tests" --agent codex
`);
    return;
  }

  await runTicketCreationFlow(args, { commandName: 'prompt', launchAgent: true });
}
