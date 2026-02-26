#!/usr/bin/env node

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';

/**
 * Parse simple CLI flags: --key value or --key=value
 * @param {string[]} args
 * @param {string[]} knownFlags
 * @returns {Record<string, string | boolean>}
 */
function parseFlags(args, knownFlags) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        result[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // If the next arg is not a flag, treat it as the value
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          result[key] = args[i + 1];
          i++;
        } else {
          result[key] = true;
        }
      }
    }
  }
  return result;
}

async function apiPost(url, token, localSecret, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(token, localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`API error (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  }

  return data;
}

export async function ticketsCreate(args) {
  const flags = parseFlags(args, [
    'title', 'objective', 'acceptance-criteria', 'available-tools',
    'execution-target', 'priority', 'project-id'
  ]);

  if (!flags.objective && !flags.title) {
    console.error('Error: --objective (or --title) is required.\n');
    console.error('Usage: ovld tickets create --objective "..." [--title "..."] [--acceptance-criteria "..."] [--execution-target agent|human] [--project-id <id>]');
    process.exit(1);
  }

  const { platformUrl, agentToken, localSecret } = resolveAuth();

  const body = {
    objective: String(flags.objective ?? flags.title ?? ''),
    title: String(flags.title ?? ''),
    acceptanceCriteria: String(flags['acceptance-criteria'] ?? ''),
    availableTools: String(flags['available-tools'] ?? ''),
    executionTarget: String(flags['execution-target'] ?? 'agent'),
    priority: String(flags.priority ?? 'medium'),
    ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : {})
  };

  const data = await apiPost(`${platformUrl}/api/protocol/tickets`, agentToken, localSecret, body);

  console.log(`Created ticket: ${data.ticket.reference} (${data.ticket.id})`);
  console.log(`  Title: ${data.ticket.title}`);
  console.log(`  Status: ${data.ticket.status}`);
  console.log(`  Execution target: ${data.ticket.executionTarget}`);
}

export async function ticketsList(args) {
  const flags = parseFlags(args, ['status', 'include-completed']);

  const { platformUrl, agentToken, localSecret } = resolveAuth();

  const body = {
    includeCompleted: flags['include-completed'] !== false,
    ...(flags.status ? { statuses: [String(flags.status)] } : {})
  };

  const data = await apiPost(
    `${platformUrl}/api/protocol/list-tickets`,
    agentToken,
    localSecret,
    body
  );

  if (!data.tickets?.length) {
    console.log('No tickets found.');
    return;
  }

  for (const t of data.tickets) {
    const ref = t.id?.slice(-8).toUpperCase() ?? '?';
    const title = t.title || t.objective?.slice(0, 60) || '(no title)';
    console.log(`  [${ref}] [${t.status ?? '?'}] ${title}`);
    console.log(`         ${t.id}`);
  }

  console.log(`\n${data.count ?? data.tickets.length} ticket(s)`);
}

export async function runTicketsCommand(subcommand, args) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld tickets <subcommand>

Subcommands:
  create   Create a new ticket
  list     List tickets

Examples:
  ovld tickets create --objective "Implement login page" --execution-target agent
  ovld tickets list
  ovld tickets list --status draft
`);
    return;
  }

  if (subcommand === 'create') {
    await ticketsCreate(args);
    return;
  }

  if (subcommand === 'list') {
    await ticketsList(args);
    return;
  }

  console.error(`Unknown tickets subcommand: ${subcommand}\n`);
  console.log('Run: ovld tickets help');
  process.exit(1);
}
