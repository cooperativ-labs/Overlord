#!/usr/bin/env node

import { runAttachCommand } from './attach.mjs';
import { runAuthCommand } from './auth.mjs';
import { runLauncherCommand } from './launcher.mjs';
import { runProtocolCommand } from './protocol.mjs';
import { runDoctorCommand, runSetupCommand } from './setup.mjs';
import { runTicketCommand } from './ticket.mjs';
import { runTicketsCommand } from './tickets.mjs';
import { runVersionCommand } from './version.mjs';

function printHelp(primaryCommand) {
  console.log(`Overlord CLI

Primary command: ${primaryCommand}

Usage:
  ${primaryCommand} attach [ticketId] [agent]  Search tickets and launch an agent (interactive)
  ${primaryCommand} create "<objective>"       Create a ticket with numbered project selection
  ${primaryCommand} prompt "<objective>"       Create a ticket, then launch an agent on it
  ${primaryCommand} auth <subcommand>          Login, logout, or check auth status
  ${primaryCommand} tickets <subcommand>       Create or list tickets
  ${primaryCommand} ticket <subcommand>        Work with a single ticket
  ${primaryCommand} protocol <subcommand>      Agent workflow commands
  ${primaryCommand} connect <agent>            Launch an agent on a ticket
  ${primaryCommand} restart <agent>            Resume an agent session
  ${primaryCommand} context                    Print ticket context (requires TICKET_ID)
  ${primaryCommand} setup <agent|all>          Install Overlord agent connector
  ${primaryCommand} doctor                     Validate installed agent connectors and check for CLI updates
  ${primaryCommand} version                    Show the installed CLI version
  ${primaryCommand} help                       Show this help message

Agents:
  Use ${primaryCommand} protocol help for ticket lifecycle commands.

Auth:
  ${primaryCommand} auth login               Authorize CLI via browser
  ${primaryCommand} auth status              Show login status
  ${primaryCommand} auth logout              Remove stored credentials

Tickets:
  ${primaryCommand} create "..." [options]
  ${primaryCommand} prompt "..." [options]
  ${primaryCommand} tickets create "..." [options]
  ${primaryCommand} tickets list [--status <status>]

Ticket:
  ${primaryCommand} ticket context <ticketId>

Run a subcommand with --help for more detail.
`);
}

export async function runCli({ primaryCommand }) {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp(primaryCommand);
    return;
  }

  // Attach command (interactive ticket search + agent launcher)
  if (command === 'attach') {
    await runAttachCommand(rest);
    return;
  }

  if (command === 'create') {
    const { runCreateCommand } = await import('./new-ticket.mjs');
    await runCreateCommand(rest);
    return;
  }

  if (command === 'prompt') {
    const { runPromptCommand } = await import('./new-ticket.mjs');
    await runPromptCommand(rest);
    return;
  }

  // Auth group
  if (command === 'auth') {
    await runAuthCommand(rest[0], rest.slice(1));
    return;
  }

  // Tickets (plural) group
  if (command === 'tickets') {
    await runTicketsCommand(rest[0], rest.slice(1));
    return;
  }

  // Ticket (singular) group
  if (command === 'ticket') {
    await runTicketCommand(rest[0], rest.slice(1));
    return;
  }

  // Protocol group
  if (command === 'protocol') {
    await runProtocolCommand(rest[0], rest.slice(1));
    return;
  }

  if (command === 'setup') {
    await runSetupCommand(rest);
    return;
  }

  if (command === 'doctor') {
    await runDoctorCommand();
    return;
  }

  if (command === 'version') {
    runVersionCommand();
    return;
  }

  // Launcher commands (`run` / `resume` kept as legacy aliases)
  if (
    command === 'connect' ||
    command === 'restart' ||
    command === 'run' ||
    command === 'resume' ||
    command === 'context'
  ) {
    await runLauncherCommand(command, rest);
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp(primaryCommand);
  process.exit(1);
}
