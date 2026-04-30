#!/usr/bin/env node

/**
 * Agent launcher commands (run / resume / context).
 * Extracted from the original _agent-launcher-cli.mjs.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { runAttachCommand } from './attach.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'claude');
const REPO_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'claude');

function claudeSourcePluginDir() {
  if (fs.existsSync(PACKAGE_CLAUDE_PLUGIN_DIR)) return PACKAGE_CLAUDE_PLUGIN_DIR;
  if (fs.existsSync(REPO_CLAUDE_PLUGIN_DIR)) return REPO_CLAUDE_PLUGIN_DIR;
  return null;
}

function getInstructionMode(agent) {
  if (agent === 'claude') {
    return claudeSourcePluginDir() ? 'bundle' : 'legacy';
  }

  if (agent === 'codex') {
    const pluginManifest = path.join(
      os.homedir(),
      '.codex',
      'plugins',
      'overlord',
      '.codex-plugin',
      'plugin.json'
    );
    return fs.existsSync(pluginManifest) ? 'bundle' : 'legacy';
  }

  return 'legacy';
}

async function fetchContext(platformUrl, bearerToken, localSecret, organizationId, ticketId, agent) {
  const params = new URLSearchParams({
    context: 'cli',
    agent,
    instructionMode: getInstructionMode(agent)
  });
  const url = `${platformUrl}/api/protocol/context/${ticketId}?${params.toString()}`;
  const response = await fetch(url, {
    headers: buildAuthHeaders(bearerToken, localSecret, organizationId)
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ticket context (${response.status}): ${await response.text()}`
    );
  }

  return response.text();
}

const agentIdentifierMap = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  gemini: 'gemini',
  opencode: 'opencode'
};

const supportedAgents = ['claude', 'codex', 'cursor', 'gemini', 'opencode'];

function parseLauncherArgs(args) {
  const positionals = [];
  const flags = {};

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

  return { positionals, flags };
}

async function runAgent(agent, mode = 'run') {
  if (!agent || !supportedAgents.includes(agent)) {
    console.error(
      `Usage: ovld connect <agent> [--ticket-id <id>] | ovld restart <agent> [--ticket-id <id>]  (agent must be one of: ${supportedAgents.join(', ')})`
    );
    process.exit(1);
  }

  const ticketId = process.env.TICKET_ID;
  if (!ticketId) {
    console.error('Missing required environment variable: TICKET_ID');
    process.exit(1);
  }

  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth();
  const context = await fetchContext(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    ticketId,
    agent
  );

  const childEnv = { ...process.env, AGENT_IDENTIFIER: agentIdentifierMap[agent] };

  try {
    if (agent === 'claude') {
      const pluginDir = claudeSourcePluginDir();
      if (mode === 'resume') {
        const claudeSessionId = process.env.CLAUDE_SESSION_ID?.trim();
        const args = claudeSessionId
          ? ['--resume', claudeSessionId, context]
          : ['--continue', context];
        if (pluginDir) args.unshift('--plugin-dir', pluginDir);
        execFileSync('claude', args, { stdio: 'inherit', env: childEnv });
      } else {
        const args = [
          '--append-system-prompt',
          context,
          'Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.'
        ];
        if (pluginDir) args.unshift('--plugin-dir', pluginDir);
        execFileSync(
          'claude',
          args,
          { stdio: 'inherit', env: childEnv }
        );
      }
    } else if (agent === 'codex') {
      if (mode === 'resume') {
        const codexSessionId = process.env.CODEX_SESSION_ID?.trim();
        const args = codexSessionId
          ? ['resume', codexSessionId, context]
          : ['resume', '--last', context];
        execFileSync('codex', args, { stdio: 'inherit', env: childEnv });
      } else {
        execFileSync('codex', [context], { stdio: 'inherit', env: childEnv });
      }
    } else if (agent === 'cursor') {
      execFileSync('agent', [context], { stdio: 'inherit', env: childEnv });
    } else if (agent === 'opencode') {
      if (mode === 'resume') {
        const openCodeSessionId = process.env.OPENCODE_SESSION_ID?.trim();
        const args = openCodeSessionId
          ? ['--continue', '--session', openCodeSessionId, '--prompt', context]
          : ['--continue', '--prompt', context];
        execFileSync('opencode', args, { stdio: 'inherit', env: childEnv });
      } else {
        execFileSync('opencode', ['--prompt', context], { stdio: 'inherit', env: childEnv });
      }
    } else if (agent === 'gemini') {
      // Write context to a temp file. Passing inline content as a positional arg
      // causes Gemini's @-reference parser to lstat(cwd + content) when it encounters
      // @ symbols in the markdown (e.g. "@@ -10,6 +10,14 @@" in JSON hunk examples),
      // producing an ENAMETOOLONG crash. Using @file keeps the path short.
      const tag = `overlord-${ticketId.slice(-8)}-${Date.now()}`;
      const contextFile = path.join(os.tmpdir(), `${tag}-ctx.md`);
      fs.writeFileSync(contextFile, context, 'utf-8');
      setTimeout(() => { try { fs.unlinkSync(contextFile); } catch { /* already gone */ } }, 30 * 60_000).unref();

      if (mode === 'resume') {
        const geminiSessionId = process.env.GEMINI_SESSION_ID?.trim();
        const resumeTarget = geminiSessionId ?? 'latest';
        execFileSync(
          'gemini',
          ['--resume', resumeTarget, '--include-directories', os.tmpdir(), `@${contextFile}`],
          { stdio: 'inherit', env: childEnv }
        );
      } else {
        execFileSync(
          'gemini',
          ['--include-directories', os.tmpdir(), `@${contextFile}`],
          { stdio: 'inherit', env: childEnv }
        );
      }
    }
  } catch (error) {
    const isResume = mode === 'resume';
    const noSessionHint =
      agent === 'claude'
        ? `No prior Claude session was found. Start one with \`ovld connect claude --ticket-id <ticket-id>\` first.`
        : agent === 'codex'
          ? `No prior Codex session was found. Start one with \`ovld connect codex --ticket-id <ticket-id>\` first.`
          : agent === 'opencode'
            ? `No prior OpenCode session was found. Start one with \`ovld connect opencode --ticket-id <ticket-id>\` first.`
          : '';
    const message = error instanceof Error ? error.message : String(error);

    if (isResume && noSessionHint) {
      console.error(`${message}\n${noSessionHint}`);
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

export async function runLauncherCommand(command, args) {
  const normalizedCommand = command === 'connect' ? 'run' : command === 'restart' ? 'resume' : command;
  const { positionals, flags } = parseLauncherArgs(args);
  const ticketId = typeof flags['ticket-id'] === 'string' ? flags['ticket-id'].trim() : '';

  if (ticketId) {
    process.env.TICKET_ID = ticketId;
  }

  if (normalizedCommand === 'run') {
    // If no ticket-id flag and no TICKET_ID env var, present interactive ticket search
    if (!ticketId && !process.env.TICKET_ID) {
      await runAttachCommand([undefined, positionals[0]]);
      return;
    }
    await runAgent(positionals[0]);
    return;
  }

  if (normalizedCommand === 'resume') {
    await runAgent(positionals[0], 'resume');
    return;
  }

  // Should not happen if called correctly
  console.error(`Unknown launcher command: ${command}`);
  process.exit(1);
}
