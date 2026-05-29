#!/usr/bin/env node

/**
 * Agent launcher commands (run / resume / context).
 * Extracted from the original _agent-launcher-cli.mjs.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { runAttachCommand } from './attach.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'claude');
const REPO_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'claude');

function resolveLaunchScratchDir(workingDirectory, { explicit = false } = {}) {
  const trimmed = typeof workingDirectory === 'string' ? workingDirectory.trim() : '';
  const candidate = trimmed || process.cwd();
  const useProjectScratch =
    explicit || fs.existsSync(path.join(candidate, '.overlord', 'project.json'));
  if (!useProjectScratch) {
    return os.tmpdir();
  }
  const scratchDir = path.join(candidate, '.overlord', 'tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  return scratchDir;
}

function withLaunchTempEnv(baseEnv, scratchDir) {
  return {
    ...baseEnv,
    TMPDIR: scratchDir,
    TMP: scratchDir,
    TEMP: scratchDir,
    OVERLORD_TMPDIR: scratchDir
  };
}

function claudeSourcePluginDir() {
  if (fs.existsSync(PACKAGE_CLAUDE_PLUGIN_DIR)) return PACKAGE_CLAUDE_PLUGIN_DIR;
  if (fs.existsSync(REPO_CLAUDE_PLUGIN_DIR)) return REPO_CLAUDE_PLUGIN_DIR;
  return null;
}

function antigravityBundleInstalled() {
  return fs.existsSync(
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'plugins', 'plugin.json')
  );
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

  if (agent === 'antigravity') {
    return antigravityBundleInstalled() ? 'bundle' : 'legacy';
  }

  return 'legacy';
}

function buildAgyLaunchArgv({ contextFile, scratchDir, mode, sessionId, extraArgs }) {
  const argv = [...extraArgs, '--add-dir', scratchDir];
  if (mode === 'resume') {
    const agySessionId = sessionId?.trim();
    if (agySessionId) {
      argv.push('--conversation', agySessionId);
    } else {
      argv.push('--continue');
    }
  }
  argv.push('--prompt-interactive', `@${contextFile}`);
  return argv;
}

async function fetchContext(platformUrl, bearerToken, localSecret, organizationId, ticketId, agent, options = {}) {
  const params = new URLSearchParams({
    context: 'cli',
    agent,
    instructionMode: getInstructionMode(agent)
  });
  if (options.launchMode === 'ask') params.set('mode', 'ask');
  if (options.sessionId) params.set('sessionId', options.sessionId);
  if (options.workspace) params.set('workspace', options.workspace);
  if (options.feedPostId) {
    params.set('feedPostId', options.feedPostId);
    if (typeof options.initialQuestion === 'string') {
      params.set('initialQuestion', options.initialQuestion);
    }
  }
  const url = `${platformUrl}/api/protocol/context/${ticketId}?${params.toString()}`;
  const response = await fetch(url, {
    headers: buildAuthHeaders(bearerToken, localSecret, organizationId)
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ticket context (${response.status}): ${await response.text()}`
    );
  }

  const context = await response.text();
  const workingDirectory = response.headers.get('X-Working-Directory') ?? '';
  const humanTicketId = response.headers.get('X-Ticket-Id') ?? '';
  return { context, workingDirectory, humanTicketId };
}

const agentIdentifierMap = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
  opencode: 'opencode',
  pi: 'pi'
};

const supportedAgents = ['claude', 'codex', 'cursor', 'antigravity', 'opencode', 'pi'];

// Re-exported under clearer names for the direct-launch dispatcher in index.mjs.
export { supportedAgents as BUILTIN_LAUNCH_AGENTS, agentIdentifierMap };

/** @internal Test-only overrides for launcher subprocess calls. */
export const launcherTestHooks = {
  execFileSync: null,
  shell: null,
  platform: null
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveLauncherShell() {
  const platform = launcherTestHooks.platform ?? process.platform;
  if (platform === 'win32') {
    return null;
  }
  return launcherTestHooks.shell ?? process.env.SHELL ?? 'sh';
}

/**
 * Run an agent binary, optionally routed through a user-defined pre-command
 * (e.g. `ollama` to run claude-code through Ollama). On POSIX shells, execute
 * the wrapper through the user's interactive login shell so aliases, functions,
 * and PATH customizations are available:
 *   preCommand="agent-pod"  →  $SHELL -ilc 'agent-pod codex <args...>'
 *
 * The shell must be interactive (`-i`), not just a login shell (`-l`): zsh only
 * sources ~/.zshrc — and bash only sources ~/.bashrc — for interactive shells.
 * Wrappers like agent-pod are commonly installed as a shell alias in ~/.zshrc
 * (its documented default), so a plain `-lc` login shell never sees them and
 * fails with `command not found`.
 */
function execAgentBinary(binary, args, opts, preCommand) {
  const exec = launcherTestHooks.execFileSync ?? execFileSync;
  const pre = typeof preCommand === 'string' ? preCommand.trim() : '';
  if (pre) {
    const shell = resolveLauncherShell();
    if (shell) {
      const command = [pre, shellQuote(binary), ...args.map(arg => shellQuote(arg))].join(' ');
      exec(shell, ['-ilc', command], opts);
      return;
    }
    const preTokens = pre.split(/\s+/).filter(Boolean);
    exec(preTokens[0], [...preTokens.slice(1), binary, ...args], opts);
    return;
  }
  exec(binary, args, opts);
}

function toTomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildExtraArgs(agent, options = {}) {
  const args = [];
  const extraFlags = Array.isArray(options.flags)
    ? options.flags.map(flag => String(flag).trim()).filter(Boolean)
    : [];

  if (options.model && agent !== 'antigravity') {
    args.push('--model', options.model);
  }

  if (options.thinking) {
    if (agent === 'claude') {
      args.push('--effort', options.thinking);
    } else if (agent === 'codex') {
      args.push('-c', `model_reasoning_effort=${toTomlString(options.thinking)}`);
    } else if (agent === 'antigravity') {
      // Antigravity manages thinking levels internally — no launch flag.
    } else if (agent === 'pi') {
      args.push('--thinking', options.thinking);
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
  const [organizationPart, _ticketSequencePart, ...rest] = String(ticketId ?? '')
    .trim()
    .split(':');
  if (rest.length > 0) return null;
  return parseOrganizationId(organizationPart);
}

function resolveLaunchOrganizationId(ticketId, optionsOrganizationId, authOrganizationId) {
  return (
    organizationIdFromTicketId(ticketId) ??
    parseOrganizationId(optionsOrganizationId) ??
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
  if (options.preCommand) {
    nestedParts.push('--pre-command', shellQuote(options.preCommand));
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
  --pre-command <command>           Shell command to run before the agent binary (e.g. ollama, agent-pod)
  --ssh-command <command>           Launch remotely over SSH by running ovld on the target host
  --remote-working-directory <path> Change to this path on the remote host before launch
  --server-multiplexer <none|tmux>  Wrap remote launches in tmux
  --tmux-command <template>         Remote tmux template; use {script} as the placeholder
  --feed-post-id <uuid>             Include a feed post in the context (desktop feed discuss)
  --initial-question <text>         First user question for feed discuss (paired with --feed-post-id)

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

  const scratchDir = resolveLaunchScratchDir(options.workingDirectory, {
    explicit: Boolean(options.workingDirectory)
  });

  const launchOrganizationId = resolveLaunchOrganizationId(
    ticketId,
    options.organizationId,
    null
  );
  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth({
    organizationIdHint: launchOrganizationId
  });
  const resolvedLaunchOrganizationId = resolveLaunchOrganizationId(
    ticketId,
    options.organizationId,
    organizationId
  );
  const launchSessionId = crypto.randomUUID();
  const isRemote = Boolean(options.sshCommand?.trim());

  if (isRemote) {
    const remoteCommand = buildRemoteLaunchCommand(agent, {
      ...options,
      organizationId: resolvedLaunchOrganizationId
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

  const { context, workingDirectory: apiWorkingDirectory, humanTicketId } = await fetchContext(
    platformUrl,
    bearerToken,
    localSecret,
    resolvedLaunchOrganizationId,
    ticketId,
    agent,
    {
      launchMode: options.launchMode,
      sessionId: launchSessionId,
      workspace: isRemote ? 'ssh' : undefined,
      feedPostId: options.feedPostId,
      initialQuestion: options.initialQuestion
    }
  );

  if (humanTicketId) {
    process.env.TICKET_ID = humanTicketId;
  }

  if (!options.workingDirectory && apiWorkingDirectory) {
    try {
      process.chdir(apiWorkingDirectory);
    } catch {
      // Best-effort; the agent will run in the current directory.
    }
  }

  const childEnv = withLaunchTempEnv({
    ...process.env,
    AGENT_IDENTIFIER: agentIdentifierMap[agent],
    OVERLORD_LAUNCH_SESSION_ID: launchSessionId,
    OVERLORD_MODEL_IDENTIFIER: options.model ?? '',
    MODEL_IDENTIFIER: options.model ?? '',
    ...(resolvedLaunchOrganizationId
      ? { OVERLORD_ORGANIZATION_ID: String(resolvedLaunchOrganizationId) }
      : {})
  }, scratchDir);
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
        execAgentBinary('claude', args, { stdio: 'inherit', env: childEnv }, options.preCommand);
      } else {
        const args = [
          '--append-system-prompt',
          context,
          ...extraArgs,
          'Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.'
        ];
        if (pluginDir) args.unshift('--plugin-dir', pluginDir);
        execAgentBinary('claude', args, { stdio: 'inherit', env: childEnv }, options.preCommand);
      }
    } else if (agent === 'codex') {
      if (mode === 'resume') {
        const codexSessionId = process.env.CODEX_SESSION_ID?.trim();
        const args = codexSessionId
          ? ['resume', codexSessionId, context]
          : ['resume', '--last', context];
        args.splice(1, 0, ...extraArgs);
        execAgentBinary('codex', args, { stdio: 'inherit', env: childEnv }, options.preCommand);
      } else {
        execAgentBinary(
          'codex',
          [...extraArgs, context],
          { stdio: 'inherit', env: childEnv },
          options.preCommand
        );
      }
    } else if (agent === 'cursor') {
      execAgentBinary(
        'agent',
        [...extraArgs, context],
        { stdio: 'inherit', env: childEnv },
        options.preCommand
      );
    } else if (agent === 'opencode') {
      if (mode === 'resume') {
        const openCodeSessionId = process.env.OPENCODE_SESSION_ID?.trim();
        const args = openCodeSessionId
          ? ['--continue', '--session', openCodeSessionId, '--prompt', context]
          : ['--continue', '--prompt', context];
        args.unshift(...extraArgs);
        execAgentBinary('opencode', args, { stdio: 'inherit', env: childEnv }, options.preCommand);
      } else {
        execAgentBinary(
          'opencode',
          [...extraArgs, '--prompt', context],
          { stdio: 'inherit', env: childEnv },
          options.preCommand
        );
      }
    } else if (agent === 'pi') {
      if (mode === 'resume') {
        const piSessionId = process.env.PI_SESSION_ID?.trim();
        const args = piSessionId
          ? ['--session', piSessionId, context]
          : ['--continue', context];
        args.unshift(...extraArgs);
        execAgentBinary('pi', args, { stdio: 'inherit', env: childEnv }, options.preCommand);
      } else {
        execAgentBinary(
          'pi',
          [...extraArgs, context],
          { stdio: 'inherit', env: childEnv },
          options.preCommand
        );
      }
    } else if (agent === 'antigravity') {
      const tag = `overlord-${ticketId.slice(-8)}-${Date.now()}`;
      const contextFile = path.join(scratchDir, `${tag}-ctx.md`);
      fs.writeFileSync(contextFile, context, 'utf-8');
      setTimeout(() => { try { fs.unlinkSync(contextFile); } catch { /* already gone */ } }, 30 * 60_000).unref();

      const agySessionId =
        process.env.AGY_SESSION_ID?.trim() ?? process.env.GEMINI_SESSION_ID?.trim();
      execAgentBinary(
        'agy',
        buildAgyLaunchArgv({
          contextFile,
          scratchDir,
          mode,
          sessionId: agySessionId,
          extraArgs
        }),
        { stdio: 'inherit', env: childEnv },
        options.preCommand
      );
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
            : agent === 'pi'
              ? `No prior Pi session was found. Start one with \`ovld launch pi --ticket-id <ticket_id>\` first.`
              : agent === 'antigravity'
                ? `No prior Antigravity session was found. Start one with \`ovld launch antigravity --ticket-id <ticket_id>\` first.`
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

/**
 * Launch a user-defined custom agent. The resolved launch command (with all
 * `{{token}}` placeholders already substituted) is passed via --command; we
 * fetch the ticket context and run `<command> <context>` in the shell.
 */
async function runCustomAgent(args) {
  const { flags } = parseLauncherArgs(args);
  const command = typeof flags.command === 'string' ? flags.command.trim() : '';
  const ticketId = typeof flags['ticket-id'] === 'string' ? flags['ticket-id'].trim() : '';
  if (!command) {
    console.error('Missing required option: --command "<resolved launch command>"');
    process.exit(1);
  }
  if (ticketId) {
    process.env.TICKET_ID = ticketId;
  }
  const resolvedTicketId = process.env.TICKET_ID;
  if (!resolvedTicketId) {
    console.error('Missing required environment variable: TICKET_ID');
    process.exit(1);
  }

  if (typeof flags['working-directory'] === 'string' && flags['working-directory'].trim()) {
    process.chdir(flags['working-directory'].trim());
  }

  const scratchDir = resolveLaunchScratchDir(flags['working-directory'], {
    explicit: typeof flags['working-directory'] === 'string' && flags['working-directory'].trim().length > 0
  });

  const launchOrganizationId = resolveLaunchOrganizationId(
    resolvedTicketId,
    flags['organization-id'],
    null
  );
  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth({
    organizationIdHint: launchOrganizationId
  });
  const resolvedLaunchOrganizationId = resolveLaunchOrganizationId(
    resolvedTicketId,
    flags['organization-id'],
    organizationId
  );
  const launchSessionId = crypto.randomUUID();
  const feedPostId = typeof flags['feed-post-id'] === 'string' ? flags['feed-post-id'].trim() : '';
  const initialQuestion = typeof flags['initial-question'] === 'string' ? flags['initial-question'].trim() : '';
  // Custom agents have no Overlord plugin/bundle; use the generic "claude" context.
  const { context } = await fetchContext(
    platformUrl,
    bearerToken,
    localSecret,
    resolvedLaunchOrganizationId,
    resolvedTicketId,
    'claude',
    {
      sessionId: launchSessionId,
      ...(feedPostId ? { feedPostId, initialQuestion } : {})
    }
  );

  const childEnv = withLaunchTempEnv({
    ...process.env,
    AGENT_IDENTIFIER: 'custom',
    OVERLORD_LAUNCH_SESSION_ID: launchSessionId,
    ...(resolvedLaunchOrganizationId
      ? { OVERLORD_ORGANIZATION_ID: String(resolvedLaunchOrganizationId) }
      : {})
  }, scratchDir);

  try {
    execFileSync('sh', ['-lc', `${command} ${shellQuote(context)}`], {
      stdio: 'inherit',
      env: childEnv
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function runLauncherCommand(command, args) {
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printLauncherHelp();
    return;
  }

  if (command === 'launch-custom') {
    await runCustomAgent(args);
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
    preCommand: typeof flags['pre-command'] === 'string' ? flags['pre-command'].trim() : '',
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
    tmuxCommand: typeof flags['tmux-command'] === 'string' ? flags['tmux-command'].trim() : '',
    feedPostId: typeof flags['feed-post-id'] === 'string' ? flags['feed-post-id'].trim() : '',
    initialQuestion: typeof flags['initial-question'] === 'string' ? flags['initial-question'].trim() : ''
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
