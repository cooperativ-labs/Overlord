#!/usr/bin/env node

import { runAttachCommand } from './attach.mjs';
import { runAuthCommand } from './auth.mjs';
import { checkForCliUpdate, printCliUpdateNotice, runCliUpdateCommand } from './cli-update.mjs';
import { runLauncherCommand } from './launcher.mjs';
import { runProtocolCommand } from './protocol.mjs';
import { runDoctorCommand, runSetupCommand } from './setup.mjs';
import { runTicketCommand } from './ticket.mjs';
import { runTicketsCommand } from './tickets.mjs';
import { runVersionCommand } from './version.mjs';

const MIN_NODE_MAJOR = 20;

function assertSupportedNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    throw new Error(
      `Overlord CLI requires Node.js ${MIN_NODE_MAJOR} or newer. Found ${process.version}.\n` +
      `Update Node before running \`ovld\`. If you installed the desktop wrapper, you can also point it at a newer runtime with \`OVLD_NODE_BIN=/path/to/node\`.`
    );
  }
}

function printHelp(primaryCommand) {
  console.log(`Overlord CLI

Primary command: ${primaryCommand}

Usage:
  ${primaryCommand} attach [ticketId] [agent]  Search tickets and launch an agent (interactive)
  ${primaryCommand} create "<objective>"       Create a ticket with numbered project selection; supports --agent/--model/--delegate
  ${primaryCommand} prompt "<objective>"       Create a ticket, then launch an agent on it
  ${primaryCommand} auth <subcommand>          Login, logout, repair, or check auth status
  ${primaryCommand} tickets <subcommand>       Create or list tickets
  ${primaryCommand} ticket <subcommand>        Work with a single ticket
  ${primaryCommand} protocol <subcommand>      Agent workflow commands
  ${primaryCommand} launch <agent>             Launch an agent on a ticket
  ${primaryCommand} connect <agent>            Launch an agent on a ticket (legacy alias)
  ${primaryCommand} restart <agent>            Resume an agent session
  ${primaryCommand} setup [agent|all]          Install Overlord agent connector (interactive if no args)
  ${primaryCommand} update                    Install the latest CLI version from npm
  ${primaryCommand} doctor                     Validate installed agent connectors and check for CLI updates
  ${primaryCommand} version                    Show the installed CLI version
  ${primaryCommand} help                       Show this help message

Agents:
  Use ${primaryCommand} protocol help for ticket lifecycle commands.
  Key protocol commands: auth-status, discover-project, create, prompt, attach, connect, load-context.

Auth:
  ${primaryCommand} auth login               Authorize CLI via browser
  ${primaryCommand} auth status              Show login status
  ${primaryCommand} auth repair              Repair shared Desktop/CLI credentials
  ${primaryCommand} auth logout              Remove stored credentials

Tickets:
  ${primaryCommand} create "..." [--agent <agent>] [--model <identifier>] [--delegate <agent>] [options]
  ${primaryCommand} prompt "..." [options]
  ${primaryCommand} tickets create "..." [options]
  ${primaryCommand} tickets list [--status <status>]

Ticket:
  ${primaryCommand} ticket context <ticketId>

Run a subcommand with --help for more detail.
`);
}

export async function runCli({ primaryCommand }) {
  assertSupportedNodeVersion();
  const [command, ...rest] = process.argv.slice(2);
  const shouldCheckForUpdate =
    Boolean(process.stdout.isTTY || process.stderr.isTTY) &&
    command !== 'doctor' &&
    command !== 'update';
  const latestCliVersion = shouldCheckForUpdate ? await checkForCliUpdate() : null;

  if (latestCliVersion && command !== 'doctor' && command !== 'update') {
    printCliUpdateNotice(latestCliVersion);
  }

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

  if (command === 'update') {
    if (rest[0] === '--help' || rest[0] === '-h' || rest[0] === 'help') {
      console.log(`Usage:
  ${primaryCommand} update   Install the latest CLI version from npm`);
      return;
    }
    await runCliUpdateCommand();
    return;
  }

  if (command === 'doctor') {
    await runDoctorCommand({ latestCliVersion });
    return;
  }

  if (command === 'version') {
    runVersionCommand();
    return;
  }

  // Launcher commands (`connect`, `run`, and `resume` kept as legacy aliases)
  if (
    command === 'launch' ||
    command === 'connect' ||
    command === 'restart' ||
    command === 'run' ||
    command === 'resume'
  ) {
    await runLauncherCommand(command, rest);
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp(primaryCommand);
  process.exit(1);
}
