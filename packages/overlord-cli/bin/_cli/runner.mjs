#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OVLD_ENTRY = process.argv[1];
const DEVICE_FILE = path.join(os.homedir(), '.ovld', 'device.json');
const DEFAULT_TMUX_COMMAND = 'tmux new-session bash {script}';

/** @internal Test-only overrides for protocol/launch subprocess calls. */
export const runnerTestHooks = {
  execFileSync: null,
  spawn: null,
  platform: null
};

function printRunnerHelp(primaryCommand = 'ovld') {
  console.log(`Usage:
  ${primaryCommand} runner once [options]
  ${primaryCommand} runner start [options]
  ${primaryCommand} runner status [options]

Options:
  --device-fingerprint <fp>  Override runner device identity
  --poll-interval-ms <ms>    Poll interval for start mode (default 3000)
  --project-id <uuid>        Only claim requests for one project
  --organization-id <id>     Only poll one organization (also OVERLORD_ORGANIZATION_ID).
                             Default: poll every organization you belong to.

The runner claims durable execution requests and launches them with \`${primaryCommand} launch\`.
By default it drains queued requests from all of your organizations, so a single
runner serves every org without needing one instance per org.
`);
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
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
  return flags;
}

export function readOrCreateDeviceFingerprint(flags) {
  const explicit =
    typeof flags['device-fingerprint'] === 'string'
      ? flags['device-fingerprint'].trim()
      : process.env.OVERLORD_DEVICE_FINGERPRINT?.trim();
  if (explicit) return explicit;

  try {
    const raw = fs.readFileSync(DEVICE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.deviceFingerprint === 'string' && parsed.deviceFingerprint.trim()) {
      return parsed.deviceFingerprint.trim();
    }
  } catch {
    // Create below.
  }

  const deviceFingerprint = crypto.randomUUID();
  fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
  fs.writeFileSync(DEVICE_FILE, `${JSON.stringify({ deviceFingerprint }, null, 2)}\n`, 'utf8');
  return deviceFingerprint;
}

function runOvld(args, env = {}) {
  const exec = runnerTestHooks.execFileSync ?? execFileSync;
  return exec(process.execPath, [OVLD_ENTRY, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

function protocolJson(subcommand, args, env) {
  const stdout = runOvld(['protocol', subcommand, ...args], env);
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function claimExecution(flags, deviceFingerprint, organizationId) {
  const args = [
    '--device-fingerprint',
    deviceFingerprint,
    '--device-hostname',
    os.hostname(),
    '--device-platform',
    process.platform
  ];
  // An explicit organization id scopes this claim to one org. The CLI turns it
  // into the `x-organization-id` header, which OAuth-authenticated protocol
  // requests require and the server validates against the user's membership.
  if (organizationId) {
    args.push('--organization-id', String(organizationId));
  }
  if (typeof flags['project-id'] === 'string') {
    args.push('--project-id', flags['project-id']);
  }
  return protocolJson('claim-execution', args, { OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint });
}

function listOrganizationIds(deviceFingerprint) {
  const data = protocolJson('list-organizations', [], {
    OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint
  });
  const organizations = Array.isArray(data.organizations) ? data.organizations : [];
  return organizations
    .map(organization => organization?.id)
    .filter(id => Number.isInteger(id) && id > 0)
    .map(id => String(id));
}

function resolvePinnedOrganizationId(flags) {
  const fromFlag =
    typeof flags['organization-id'] === 'string' ? flags['organization-id'].trim() : '';
  if (fromFlag) return fromFlag;
  const fromEnv = process.env.OVERLORD_ORGANIZATION_ID?.trim();
  return fromEnv || '';
}

// Re-discover the user's organizations periodically so a runner picks up newly
// joined orgs without a restart, without hitting the API on every poll.
const ORGANIZATION_REFRESH_MS = 60_000;

/**
 * Resolves which organizations a poll pass should claim from.
 *
 * - When the user pins an org (`--organization-id` flag or
 *   `OVERLORD_ORGANIZATION_ID`), only that org is polled.
 * - Otherwise the runner discovers every org the authenticated user belongs to
 *   and polls each one. If discovery fails or returns nothing, it falls back to
 *   the credential default (an empty scope id) so behavior never regresses.
 */
export function createOrganizationScope(flags, deviceFingerprint) {
  const pinned = resolvePinnedOrganizationId(flags);
  if (pinned) {
    return { pinned: true, resolve: () => [pinned] };
  }

  let cache = [];
  let fetchedAt = 0;
  return {
    pinned: false,
    resolve() {
      const now = Date.now();
      if (cache.length === 0 || now - fetchedAt >= ORGANIZATION_REFRESH_MS) {
        try {
          const ids = listOrganizationIds(deviceFingerprint);
          fetchedAt = now;
          // Keep the last known good list on a transient empty result.
          if (ids.length > 0) cache = ids;
        } catch (error) {
          process.stderr.write(
            `[runner] could not list organizations (${
              error instanceof Error ? error.message : error
            }); using the default organization\n`
          );
        }
      }
      // Empty string = "no override", i.e. the org stored in credentials.
      return cache.length > 0 ? cache : [''];
    }
  };
}

function completeLaunch(requestId, deviceFingerprint) {
  protocolJson(
    'complete-execution-launch',
    ['--request-id', requestId, '--device-fingerprint', deviceFingerprint],
    { OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint }
  );
}

function failLaunch(requestId, deviceFingerprint, error) {
  protocolJson(
    'fail-execution-launch',
    ['--request-id', requestId, '--device-fingerprint', deviceFingerprint, '--error', error],
    { OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint }
  );
}

export function buildLaunchArgs(launch) {
  const args = ['launch', launch.agent, '--ticket-id', launch.ticketId];
  if (launch.workingDirectory) args.push('--working-directory', launch.workingDirectory);
  if (launch.launchMode === 'ask') args.push('--launch-mode', 'ask');
  if (launch.model) args.push('--model', launch.model);
  if (launch.thinking) args.push('--thinking', launch.thinking);
  for (const flag of launch.flags ?? []) args.push('--flag', flag);
  if (launch.sshCommand) args.push('--ssh-command', launch.sshCommand);
  if (launch.remoteWorkingDirectory) {
    args.push('--remote-working-directory', launch.remoteWorkingDirectory);
  }
  if (launch.serverMultiplexer === 'tmux') args.push('--server-multiplexer', 'tmux');
  if (launch.tmuxCommand) args.push('--tmux-command', launch.tmuxCommand);
  if (launch.feedPostId) args.push('--feed-post-id', launch.feedPostId);
  if (launch.initialQuestion) args.push('--initial-question', launch.initialQuestion);
  return args;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeRunnerTerminalProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    terminalApp: typeof value.terminalApp === 'string' ? value.terminalApp : 'default',
    terminalLaunchMode:
      typeof value.terminalLaunchMode === 'string' ? value.terminalLaunchMode : 'tab',
    terminalCustomHotkey:
      typeof value.terminalCustomHotkey === 'string' ? value.terminalCustomHotkey : '',
    customTerminalApp:
      typeof value.customTerminalApp === 'string' ? value.customTerminalApp : '',
    terminalTmuxHostApp:
      typeof value.terminalTmuxHostApp === 'string' ? value.terminalTmuxHostApp : 'terminal',
    customTerminalTmuxHostApp:
      typeof value.customTerminalTmuxHostApp === 'string'
        ? value.customTerminalTmuxHostApp
        : '',
    terminalTmuxCommand:
      typeof value.terminalTmuxCommand === 'string' && value.terminalTmuxCommand.trim()
        ? value.terminalTmuxCommand
        : DEFAULT_TMUX_COMMAND
  };
}

function buildRunnerLaunchShellCommand(args, deviceFingerprint) {
  return [
    `export OVERLORD_DEVICE_FINGERPRINT=${shellQuote(deviceFingerprint)}`,
    `exec ${shellQuote(process.execPath)} ${[OVLD_ENTRY, ...args].map(shellQuote).join(' ')}`
  ].join('\n');
}

function writeRunnerLaunchScript(launchCommand) {
  const dir = path.join(os.tmpdir(), 'ovld-runner');
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(
    dir,
    `launch-${process.pid}-${Date.now()}-${crypto.randomUUID()}.sh`
  );
  fs.writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -e\n${launchCommand}\n`, {
    mode: 0o700
  });
  return scriptPath;
}

function buildTmuxCommand(template, scriptPath) {
  const resolvedTemplate =
    typeof template === 'string' && template.trim().includes('{script}')
      ? template.trim()
      : DEFAULT_TMUX_COMMAND;
  return resolvedTemplate.replaceAll('{script}', shellQuote(scriptPath));
}

function terminalAppName(profile) {
  if (profile.terminalApp === 'custom') return profile.customTerminalApp.trim();
  const appMap = {
    default: 'Terminal',
    terminal: 'Terminal',
    iterm: 'iTerm',
    warp: 'Warp',
    ghostty: 'Ghostty',
    alacritty: 'Alacritty',
    kitty: 'Kitty',
    hyper: 'Hyper'
  };
  return appMap[profile.terminalApp] ?? '';
}

export function buildRunnerTerminalOpenCommand(
  profileValue,
  launchCommand,
  platform = process.platform
) {
  const profile = normalizeRunnerTerminalProfile(profileValue);
  if (!profile) return null;

  const command =
    profile.terminalApp === 'tmux'
      ? buildTmuxCommand(profile.terminalTmuxCommand, writeRunnerLaunchScript(launchCommand))
      : launchCommand;

  if (profile.terminalApp === 'tmux' && platform !== 'darwin') {
    return command;
  }

  if (platform !== 'darwin') return null;

  const appName =
    profile.terminalApp === 'tmux'
      ? terminalAppName({
          ...profile,
          terminalApp: profile.terminalTmuxHostApp,
          customTerminalApp: profile.customTerminalTmuxHostApp
        })
      : terminalAppName(profile);
  if (!appName) return null;

  if (appName === 'iTerm') {
    return [
      'osascript',
      '-e',
      shellQuote('tell application "iTerm"'),
      '-e',
      shellQuote(`create window with default profile command ${appleScriptString(command)}`),
      '-e',
      shellQuote('activate'),
      '-e',
      shellQuote('end tell')
    ].join(' ');
  }

  return [
    'osascript',
    '-e',
    shellQuote(
      `tell application ${appleScriptString(appName)} to do script ${appleScriptString(command)}`
    ),
    '-e',
    shellQuote(`tell application ${appleScriptString(appName)} to activate`)
  ].join(' ');
}

function spawnLaunchProcess(args, claim, deviceFingerprint) {
  const spawnImpl = runnerTestHooks.spawn ?? spawn;
  const launchCommand = buildRunnerLaunchShellCommand(args, deviceFingerprint);
  const terminalCommand = buildRunnerTerminalOpenCommand(
    claim.launch?.runnerTerminalProfile,
    launchCommand,
    runnerTestHooks.platform ?? process.platform
  );

  // Phase 4: thread the execution request id to the launched process so the
  // agent's `ovld protocol attach` can mark this exact request `launched`.
  // Attach falls back to matching by objective when this is absent, so this is
  // a precision aid, not a correctness requirement.
  const launchEnv = {
    ...process.env,
    OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint,
    ...(claim.request?.id ? { OVERLORD_EXECUTION_REQUEST_ID: claim.request.id } : {})
  };

  if (!terminalCommand) {
    return {
      child: spawnImpl(process.execPath, [OVLD_ENTRY, ...args], {
        stdio: 'inherit',
        env: launchEnv
      }),
      completeOnClose: false
    };
  }

  return {
    child: spawnImpl('sh', ['-lc', terminalCommand], {
      stdio: 'inherit',
      env: launchEnv
    }),
    completeOnClose: true
  };
}

export async function launchClaimedRequest(claim, deviceFingerprint) {
  const requestId = claim.request?.id;
  if (!requestId || !claim.launch?.agent || !claim.launch?.ticketId) return false;

  const args = buildLaunchArgs(claim.launch);
  process.stderr.write(
    `[runner] launching ${claim.launch.agent} for ${claim.launch.ticketId} (${requestId})\n`
  );

  await new Promise((resolve, reject) => {
    const { child, completeOnClose } = spawnLaunchProcess(args, claim, deviceFingerprint);

    child.once('spawn', () => {
      if (completeOnClose) return;
      try {
        completeLaunch(requestId, deviceFingerprint);
      } catch (error) {
        process.stderr.write(`[runner] failed to mark request launched: ${error}\n`);
      }
    });

    child.once('error', error => {
      try {
        failLaunch(requestId, deviceFingerprint, error.message);
      } catch {
        // Preserve the original launch error.
      }
      reject(error);
    });

    child.once('close', code => {
      if (completeOnClose && (!code || code === 0)) {
        try {
          completeLaunch(requestId, deviceFingerprint);
        } catch (error) {
          process.stderr.write(`[runner] failed to mark request launched: ${error}\n`);
        }
      } else if (completeOnClose && code) {
        try {
          failLaunch(requestId, deviceFingerprint, `terminal launcher exited with code ${code}`);
        } catch {
          // Preserve the launcher exit below.
        }
      }
      if (code && code !== 0) {
        process.stderr.write(`[runner] launch process exited with code ${code}\n`);
      }
      resolve();
    });
  });

  return true;
}

export async function runOnce(flags, deviceFingerprint, organizationScope) {
  const scope = organizationScope ?? createOrganizationScope(flags, deviceFingerprint);
  const organizationIds = scope.resolve();

  let launchedAny = false;
  for (const organizationId of organizationIds) {
    let claim;
    try {
      claim = claimExecution(flags, deviceFingerprint, organizationId);
    } catch (error) {
      // A single organization failing (transient API/auth error) must not stop
      // the runner from servicing the others.
      process.stderr.write(
        `[runner] claim failed for organization ${organizationId || 'default'}: ${
          error instanceof Error ? error.message : error
        }\n`
      );
      continue;
    }
    if (!claim.request) continue;
    await launchClaimedRequest(claim, deviceFingerprint);
    launchedAny = true;
  }

  if (!launchedAny) {
    process.stderr.write('[runner] no queued execution requests\n');
  }
  return launchedAny;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runRunnerCommand(subcommand, args, primaryCommand = 'ovld') {
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printRunnerHelp(primaryCommand);
    return;
  }

  const flags = parseFlags(args);
  const deviceFingerprint = readOrCreateDeviceFingerprint(flags);

  if (subcommand === 'status') {
    const data = protocolJson(
      'get-device',
      [
        '--device-fingerprint',
        deviceFingerprint,
        '--device-hostname',
        os.hostname(),
        '--device-platform',
        process.platform
      ],
      { OVERLORD_DEVICE_FINGERPRINT: deviceFingerprint }
    );
    console.log(JSON.stringify({ ok: true, device: data.device }, null, 2));
    return;
  }

  if (subcommand === 'once') {
    await runOnce(flags, deviceFingerprint);
    return;
  }

  if (subcommand === 'start') {
    const pollIntervalMs =
      typeof flags['poll-interval-ms'] === 'string'
        ? Math.max(1000, Number.parseInt(flags['poll-interval-ms'], 10) || 3000)
        : 3000;
    // Build the organization scope once so its discovery cache persists across
    // polls instead of refetching the org list every iteration.
    const organizationScope = createOrganizationScope(flags, deviceFingerprint);
    process.stderr.write(`[runner] started with device ${deviceFingerprint}\n`);
    process.stderr.write(
      organizationScope.pinned
        ? `[runner] polling a single organization\n`
        : `[runner] polling every organization you belong to\n`
    );
    for (;;) {
      try {
        const launched = await runOnce(flags, deviceFingerprint, organizationScope);
        if (!launched) await sleep(pollIntervalMs);
      } catch (error) {
        process.stderr.write(`[runner] ${error instanceof Error ? error.message : error}\n`);
        await sleep(pollIntervalMs);
      }
    }
  }

  console.error(`Unknown runner command: ${subcommand}\n`);
  printRunnerHelp(primaryCommand);
  process.exit(1);
}
