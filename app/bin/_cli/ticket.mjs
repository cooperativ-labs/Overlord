#!/usr/bin/env node

import { resolveAuth } from './credentials.mjs';

export async function ticketContext(ticketId) {
  if (!ticketId) {
    // Fall back to TICKET_ID env var
    ticketId = process.env.TICKET_ID;
  }

  if (!ticketId) {
    console.error('Error: ticket ID is required.\n');
    console.error('Usage: ovld ticket context <ticketId>');
    console.error('       TICKET_ID=<id> ovld ticket context');
    process.exit(1);
  }

  const { platformUrl, agentToken } = resolveAuth();

  const url = `${platformUrl}/api/protocol/context/${ticketId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ticket context (${res.status}): ${await res.text()}`);
  }

  const text = await res.text();
  process.stdout.write(text);
}

export async function runTicketCommand(subcommand, args) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld ticket <subcommand>

Subcommands:
  context <ticketId>   Print ticket context (objective, acceptance criteria, tools)

Examples:
  ovld ticket context abc-123
  TICKET_ID=abc-123 ovld ticket context
`);
    return;
  }

  if (subcommand === 'context') {
    await ticketContext(args[0]);
    return;
  }

  console.error(`Unknown ticket subcommand: ${subcommand}\n`);
  console.log('Run: ovld ticket help');
  process.exit(1);
}
