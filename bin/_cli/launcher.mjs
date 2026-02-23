#!/usr/bin/env node

/**
 * Agent launcher commands (run / resume / context).
 * Extracted from the original _agent-launcher-cli.mjs.
 */

import { execFileSync } from 'node:child_process';
import { resolveAuth } from './credentials.mjs';

async function fetchContext(platformUrl, agentToken, ticketId) {
  const url = `${platformUrl}/api/protocol/context/${ticketId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ticket context (${response.status}): ${await response.text()}`
    );
  }

  return response.text();
}

async function runAgent(agent, mode = 'run') {
  if (!agent || !['claude', 'codex'].includes(agent)) {
    console.error(
      `Usage: ovld run <agent> | ovld resume <agent>  (agent must be "claude" or "codex")`
    );
    process.exit(1);
  }

  const ticketId = process.env.TICKET_ID;
  if (!ticketId) {
    console.error('Missing required environment variable: TICKET_ID');
    process.exit(1);
  }

  const { platformUrl, agentToken } = resolveAuth();
  const context = await fetchContext(platformUrl, agentToken, ticketId);

  try {
    if (agent === 'claude') {
      if (mode === 'resume') {
        const claudeSessionId = process.env.CLAUDE_SESSION_ID?.trim();
        const args = claudeSessionId
          ? ['--resume', claudeSessionId, context]
          : ['--continue', context];
        execFileSync('claude', args, { stdio: 'inherit', env: process.env });
      } else {
        execFileSync(
          'claude',
          [
            '--append-system-prompt',
            context,
            'Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.'
          ],
          { stdio: 'inherit', env: process.env }
        );
      }
    } else {
      if (mode === 'resume') {
        const codexSessionId = process.env.CODEX_SESSION_ID?.trim();
        const args = codexSessionId
          ? ['resume', codexSessionId, context]
          : ['resume', '--last', context];
        execFileSync('codex', args, { stdio: 'inherit', env: process.env });
      } else {
        execFileSync('codex', [context], { stdio: 'inherit', env: process.env });
      }
    }
  } catch (error) {
    const isResume = mode === 'resume';
    const noSessionHint =
      agent === 'claude'
        ? `No prior Claude session was found. Start one with \`ovld run claude\` first.`
        : `No prior Codex session was found. Start one with \`ovld run codex\` first.`;
    const message = error instanceof Error ? error.message : String(error);

    if (isResume) {
      console.error(`${message}\n${noSessionHint}`);
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

async function printContext() {
  const ticketId = process.env.TICKET_ID;
  if (!ticketId) {
    console.error('Missing required environment variable: TICKET_ID\n');
    console.error('Usage: TICKET_ID=<id> ovld context');
    console.error('       ovld ticket context <id>  (recommended)');
    process.exit(1);
  }

  const { platformUrl, agentToken } = resolveAuth();
  const context = await fetchContext(platformUrl, agentToken, ticketId);
  process.stdout.write(context);
}

export async function runLauncherCommand(command, args) {
  if (command === 'run') {
    await runAgent(args[0]);
    return;
  }

  if (command === 'resume') {
    await runAgent(args[0], 'resume');
    return;
  }

  if (command === 'context') {
    await printContext();
    return;
  }

  // Should not happen if called correctly
  console.error(`Unknown launcher command: ${command}`);
  process.exit(1);
}
