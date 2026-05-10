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
const TICKET_ID_REGEX = /^(\d+):\d+$/;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function toTomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildExtraArgs(agent, options = {}) {
  const args = [];
  const extraFlags = Array.isArray(options.flags)
    ? options.flags.map(flag => String(flag).trim()).filter(Boolean)
    : [];

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.thinking) {
    if (agent === 'claude') {
      args.push('--effort', options.thinking);
    } else if (agent === 'codex') {
      args.push('-c', `model_reasoning_effort=${toTomlString(options.thinking)}`);
    } else if (agent === 'gemini') {
      args.push('--thinking-level', options.thinking);
    }
  }

  return [...args, ...extraFlags];
}

function parseOrganizationId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function organizationIdFromTicketId(ticketId) {
  const match = String(ticketId ?? '').trim().match(TICKET_ID_REGEX);
  return match ? parseOrganizationId(match[1]) : null;
}

function resolveLaunchOrganizationId(ticketId, optionsOrganizationId, authOrganizationId) {
  return (
    parseOrganizationId(optionsOrganizationId) ??
    organizationIdFromTicketId(ticketId) ??
    parseOrganizationId(authOrganizationId)
  );
}

function buildRemoteLaunchCommand(agent, options) {
  const organizationId = parseOrganizationId(options.organizationId);
  const envParts = [];
  for (const [key, value] of Object.entries({
    OVERLORD_URL: process.env.OVERLORD_URL,
    OVERLORD_ACCESS_TOKEN: process.env.OVERLORD_ACCESS_TOKEN,
    OVERLORD_ORGANIZATION_ID: organizationId ?? process.env.OVERLORD_ORGANIZATION_ID,
    OVERLORD_LOCAL_SECRET: process.env.OVERLORD_LOCAL_SECRET,
    TICKET_ID: process.env.TICKET_ID,
    AGENT_IDENTIFIER: agentIdentifierMap[agent],
    OVERLORD_MODEL_IDENTIFIER: options.model ?? '',
    MODEL_IDENTIFIER: options.model ?? ''
  })) {
    if (typeof value === 'string') {
      envParts.push(`export ${key}=${shellQuote(value)}`);
    }
  }

  const nestedParts = ['ovld', 'launch', agent, '--ticket-id', shellQuote(process.env.TICKET_ID ?? '')];
  if (organizationId) {
    nestedParts.push('--organization-id', String(organizationId));
  }
  if (options.launchMode === 'ask') {
    nestedParts.push('--launch-mode', 'ask');
  }
  if (options.model) {
    nestedParts.push('--model', shellQuote(options.model));
  }
  if (options.thinking) {
    nestedParts.push('--thinking', shellQuote(options.thinking));
  }
  for (const flag of options.flags ?? []) {
    nestedParts.push('--flag', shellQuote(flag));
  }

  const remoteCwd = typeof options.remoteWorkingDirectory === 'string'
    ? options.remoteWorkingDirectory.trim()
    : '';
  const remotePrelude = [
    '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
    '[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"',
    '[ -f "$HOME/.profile" ] && . "$HOME/.profile"',
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"',
    ...envParts,
    remoteCwd ? `cd ${shellQuote(remoteCwd)}` : null,
    nestedParts.join(' ')
  ].filter(Boolean);

  const innerCommand = remotePrelude.join('; ');
  const remoteCommand =
    options.serverMultiplexer === 'tmux'
      ? buildTmuxWrappedCommand(innerCommand, options.tmuxCommand)
      : innerCommand;

  return `${options.sshCommand.trim()} ${shellQuote(remoteCommand)}`;
}

function buildTmuxWrappedCommand(innerCommand, tmuxCommand) {
  const template = typeof tmuxCommand === 'string' && tmuxCommand.trim().includes('{script}')
    ? tmuxCommand.trim()
    : 'tmux new-session bash {script}';
  const scriptCommand = `bash -lc ${shellQuote(innerCommand)}`;
  return template.replaceAll('{script}', shellQuote(scriptCommand));
}

function printLauncherHelp() {
  console.log(`Usage:
  ovld launch <agent> --ticket-id <ticket_id> [options]
  ovld connect <agent> --ticket-id <ticket_id> [options]   # alias for ovld launch
  ovld restart <agent> --ticket-id <ticket_id> [options]

Options:
  --ticket-id <ticket_id>           Ticket to launch or resume (e.g. 1:899). Also accepts UUID.
  --organization-id <id>            Organization scope for UUID ticket ids; inferred from ticket_id when possible.
  --working-directory <path>        Change to a local working directory before launch
  --launch-mode <run|ask>           Ask mode adjusts the fetched prompt context
  --model <identifier>              Preferred model identifier
  --thinking <level>                Agent reasoning/effort level
  --flag <value>                    Extra agent flag (repeatable)
  --ssh-command <command>           Launch remotely over SSH by running ovld on the target host
  --remote-working-directory <path> Change to this path on the remote host before launch
  --server-multiplexer <none|tmux>  Wrap remote launches in tmux
  --tmux-command <template>         Remote tmux template; use {script} as the placeholder

Notes:
  - ovld launch is the primary user-facing launcher.
  - ovld connect remains available as a compatibility alias.
  - ovld restart keeps using the native resume flow when the target agent supports it.`);
}

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

function parseRepeatedFlags(args) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--flag' && i + 1 < args.length) {
      result.push(args[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith('--flag=')) {
      result.push(arg.slice('--flag='.length));
    }
  }
  return result;
}

async function runAgent(agent, mode = 'run', options = {}) {
  if (!agent || !supportedAgents.includes(agent)) {
    printLauncherHelp();
    console.error(`\nAgent must be one of: ${supportedAgents.join(', ')}`);
    process.exit(1);
  }

  const ticketId = process.env.TICKET_ID;
  if (!ticketId) {
    console.error('Missing required environment variable: TICKET_ID');
    process.exit(1);
  }

  if (options.workingDirectory) {
    process.chdir(options.workingDirectory);
  }

  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth();
  const launchOrganizationId = resolveLaunchOrganizationId(
    ticketId,
    options.organizationId,
    organizationId
  );
  if (options.sshCommand?.trim()) {
    const remoteCommand = buildRemoteLaunchCommand(agent, {
      ...options,
      organizationId: launchOrganizationId
    });
    try {
      execFileSync('sh', ['-lc', remoteCommand], { stdio: 'inherit', env: process.env });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  }

  const context = await fetchContext(
    platformUrl,
    bearerToken,
    localSecret,
    launchOrganizationId,
    ticketId,
    agent
  );

  const childEnv = {
    ...process.env,
    AGENT_IDENTIFIER: agentIdentifierMap[agent],
    ...(launchOrganizationId ? { OVERLORD_ORGANIZATION_ID: String(launchOrganizationId) } : {})
  };
  const extraArgs = buildExtraArgs(agent, options);

  try {
    if (agent === 'claude') {
      const pluginDir = claudeSourcePluginDir();
      if (mode === 'resume') {
        const claudeSessionId = process.env.CLAUDE_SESSION_ID?.trim();
        const args = claudeSessionId
          ? ['--resume', claudeSessionId, context]
          : ['--continue', context];
        args.unshift(...extraArgs);
        if (pluginDir) args.unshift('--plugin-dir', pluginDir);
        execFileSync('claude', args, { stdio: 'inherit', env: childEnv });
      } else {
        const args = [
          '--append-system-prompt',
          context,
          ...extraArgs,
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
        args.splice(1, 0, ...extraArgs);
        execFileSync('codex', args, { stdio: 'inherit', env: childEnv });
      } else {
        execFileSync('codex', [...extraArgs, context], { stdio: 'inherit', env: childEnv });
      }
    } else if (agent === 'cursor') {
      execFileSync('agent', [...extraArgs, context], { stdio: 'inherit', env: childEnv });
    } else if (agent === 'opencode') {
      if (mode === 'resume') {
        const openCodeSessionId = process.env.OPENCODE_SESSION_ID?.trim();
        const args = openCodeSessionId
          ? ['--continue', '--session', openCodeSessionId, '--prompt', context]
          : ['--continue', '--prompt', context];
        args.unshift(...extraArgs);
        execFileSync('opencode', args, { stdio: 'inherit', env: childEnv });
      } else {
        execFileSync('opencode', [...extraArgs, '--prompt', context], {
          stdio: 'inherit',
          env: childEnv
        });
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
          [...extraArgs, '--resume', resumeTarget, '--include-directories', os.tmpdir(), `@${contextFile}`],
          { stdio: 'inherit', env: childEnv }
        );
      } else {
        execFileSync(
          'gemini',
          [...extraArgs, '--include-directories', os.tmpdir(), `@${contextFile}`],
          { stdio: 'inherit', env: childEnv }
        );
      }
    }
  } catch (error) {
    const isResume = mode === 'resume';
    const noSessionHint =
      agent === 'claude'
        ? `No prior Claude session was found. Start one with \`ovld launch claude --ticket-id <ticket_id>\` first.`
        : agent === 'codex'
          ? `No prior Codex session was found. Start one with \`ovld launch codex --ticket-id <ticket_id>\` first.`
          : agent === 'opencode'
            ? `No prior OpenCode session was found. Start one with \`ovld launch opencode --ticket-id <ticket_id>\` first.`
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
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printLauncherHelp();
    return;
  }

  const normalizedCommand =
    command === 'launch' || command === 'connect'
      ? 'run'
      : command === 'restart'
        ? 'resume'
        : command;
  const { positionals, flags } = parseLauncherArgs(args);
  const repeatedFlags = parseRepeatedFlags(args);
  const ticketId = typeof flags['ticket-id'] === 'string' ? flags['ticket-id'].trim() : '';

  if (ticketId) {
    process.env.TICKET_ID = ticketId;
  }

  const launchOptions = {
    workingDirectory:
      typeof flags['working-directory'] === 'string' ? flags['working-directory'].trim() : '',
    launchMode: flags['launch-mode'] === 'ask' ? 'ask' : 'run',
    model: typeof flags.model === 'string' ? flags.model.trim() : '',
    thinking: typeof flags.thinking === 'string' ? flags.thinking.trim() : '',
    flags: repeatedFlags,
    organizationId:
      typeof flags['organization-id'] === 'string' ? flags['organization-id'].trim() : '',
    sshCommand: typeof flags['ssh-command'] === 'string' ? flags['ssh-command'].trim() : '',
    remoteWorkingDirectory:
      typeof flags['remote-working-directory'] === 'string'
        ? flags['remote-working-directory'].trim()
        : '',
    serverMultiplexer:
      flags['server-multiplexer'] === 'tmux' ? 'tmux' : 'none',
    tmuxCommand: typeof flags['tmux-command'] === 'string' ? flags['tmux-command'].trim() : ''
  };

  if (normalizedCommand === 'run') {
    // If no ticket-id flag and no TICKET_ID env var, present interactive ticket search
    if (!ticketId && !process.env.TICKET_ID) {
      await runAttachCommand([undefined, positionals[0]]);
      return;
    }
    await runAgent(positionals[0], 'run', launchOptions);
    return;
  }

  if (normalizedCommand === 'resume') {
    await runAgent(positionals[0], 'resume', launchOptions);
    return;
  }

  // Should not happen if called correctly
  console.error(`Unknown launcher command: ${command}`);
  process.exit(1);
}
