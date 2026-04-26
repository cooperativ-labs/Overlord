#!/usr/bin/env node

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { runCreateCommand } from './new-ticket.mjs';

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

async function apiPost(url, token, localSecret, organizationId, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(token, localSecret, organizationId),
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
  await runCreateCommand(args);
}

export async function ticketsList(args) {
  const flags = parseFlags(args, ['status', 'include-completed']);

  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth();

  const body = {
    includeCompleted: flags['include-completed'] !== false,
    ...(flags.status ? { statuses: [String(flags.status)] } : {})
  };

  const data = await apiPost(
    `${platformUrl}/api/protocol/search-tickets`,
    bearerToken,
    localSecret,
    organizationId,
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
  ovld tickets create "Implement login page"
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
