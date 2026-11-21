import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findHarnessDescriptor } from './agent-session/catalog.generated.js';
import { spawnSyncWithoutSecrets } from './argv-secrets.js';

/**
 * Health of the Overlord Claude Code hooks (`ovld agent-setup claude` and `ovld doctor`).
 *
 * The Claude plugin registers `mcp_tool` hooks that call the plugin-bundled local server
 * `overlord-hooks` (the rendered connector shim in `--hooks` mode). Claude Code has no
 * automatic fallback from a failed `mcp_tool` hook, so when that server is missing or not
 * connected, follow-up capture, file-change capture, the Stop delivery reminder and the
 * remote permission decision are all off. This check finds that state and names both the fix
 * and the supported fallback: the `ovld protocol` CLI, which stays fully supported.
 */

export const CLAUDE_MARKETPLACE_NAME = 'overlord-local';
export const CLAUDE_PLUGIN_KEY = `overlord@${CLAUDE_MARKETPLACE_NAME}`;
/** Plugin-scoped name Claude Code gives the plugin's `.mcp.json` server `overlord-hooks`. */
export const CLAUDE_HOOKS_SERVER = 'plugin:overlord:overlord-hooks';

/** What still works, and how, while the hooks server is unavailable. */
export const CLAUDE_HOOKS_CLI_FALLBACK =
  'Until this is fixed, Overlord follow-up capture, file-change capture, the Stop delivery ' +
  'reminder and remote permission decisions are off in Claude Code. The `ovld protocol` CLI ' +
  'still works: attach, update, ask and deliver with `ovld protocol ...`, and declare changed ' +
  'files with `--paths` on `update` or `deliver`.';

export type ClaudeCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

/** Run the Claude CLI with fixed argv. Injected by tests; never receives payload text. */
export type ClaudeCommandRunner = (args: string[]) => ClaudeCommandResult;

export type ClaudeHookHealth = {
  version: string | null;
  /** Errors: the hooks cannot run. */
  problems: string[];
  /** Not fatal, but worth reporting. */
  warnings: string[];
};

function descriptorVersions(): { minimum: string | null; verified: string | null } {
  const harness = findHarnessDescriptor('claude')?.harness;
  const floor = /^>=\s*(\d+\.\d+\.\d+)$/.exec(harness?.versionRange?.trim() ?? '');
  const verified = /^(\d+\.\d+\.\d+)$/.exec(harness?.verifiedVersion?.trim() ?? '');
  return { minimum: floor?.[1] ?? null, verified: verified?.[1] ?? null };
}

/** Minimum Claude Code version, from the adapter descriptor's `versionRange` floor. */
export function claudeMinimumVersion(): string | null {
  return descriptorVersions().minimum;
}

/** Compare two `MAJOR.MINOR.PATCH` strings. */
export function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function parseClaudeVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match ? (match[1] as string) : null;
}

export function defaultClaudeRunner({
  binary = 'claude',
  configDir
}: {
  binary?: string;
  configDir?: string;
} = {}): ClaudeCommandRunner {
  return args => {
    const result = spawnSyncWithoutSecrets(binary, args, {
      encoding: 'utf8',
      timeout: 60_000,
      env: configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env
    });
    return {
      status: result.status,
      stdout: `${result.stdout ?? ''}`,
      stderr: `${result.stderr ?? ''}`,
      ...(result.error ? { error: result.error } : {})
    };
  };
}

/** Whether `settings.json` in this Claude config dir enables the Overlord plugin. */
export function isClaudePluginEnabled(configDir: string): boolean {
  const settingsPath = path.join(configDir, 'settings.json');
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      enabledPlugins?: Record<string, unknown>;
    };
    return settings.enabledPlugins?.[CLAUDE_PLUGIN_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Read the hooks server's state from `claude mcp get`. Claude prints a `Status:` line such as
 * `✔ Connected`, `✘ Failed to connect` or `⏸ Pending approval`.
 */
export function parseClaudeMcpStatus(output: string): 'connected' | 'not-connected' | 'missing' {
  if (/no mcp server (?:named|found)|not found/i.test(output)) return 'missing';
  const status = /status:\s*(.*)$/im.exec(output)?.[1] ?? '';
  if (/\bconnected\b/i.test(status) && !/fail|not connected|disconnected/i.test(status)) {
    return 'connected';
  }
  return status ? 'not-connected' : 'missing';
}

export function inspectClaudeHookHealth({
  configDir,
  run,
  checkServer = true
}: {
  configDir: string;
  run: ClaudeCommandRunner;
  /** Health-check the hooks server. It starts the server once, so it costs about a second. */
  checkServer?: boolean;
}): ClaudeHookHealth {
  const problems: string[] = [];
  const warnings: string[] = [];
  const { minimum, verified } = descriptorVersions();

  const versionResult = run(['--version']);
  const version =
    versionResult.error || versionResult.status !== 0
      ? null
      : parseClaudeVersion(versionResult.stdout);
  if (!version) {
    warnings.push('Could not read the Claude Code version from `claude --version`.');
  } else if (minimum && compareSemver(version, minimum) < 0) {
    problems.push(
      `Claude Code ${version} is older than ${minimum}, the minimum the Overlord plugin needs ` +
        `for its mcp_tool hooks. Update Claude Code (\`claude update\`), then re-run ` +
        `\`ovld agent-setup claude\`. ${CLAUDE_HOOKS_CLI_FALLBACK}`
    );
  } else if (verified && compareSemver(version, verified) > 0) {
    warnings.push(
      `Claude Code ${version} is newer than ${verified}, the last version the Overlord hooks ` +
        'were verified against. If hooks stop recording activity, run `ovld doctor` and use ' +
        'the `ovld protocol` CLI until the connector is re-verified.'
    );
  }

  if (!isClaudePluginEnabled(configDir)) {
    problems.push(
      `The Overlord Claude plugin (${CLAUDE_PLUGIN_KEY}) is not installed and enabled in ` +
        `${configDir}. Re-run \`ovld agent-setup claude\`, or enable it with ` +
        `\`claude plugin enable ${CLAUDE_PLUGIN_KEY}\`. ${CLAUDE_HOOKS_CLI_FALLBACK}`
    );
    return { version, problems, warnings };
  }

  if (checkServer) {
    const get = run(['mcp', 'get', CLAUDE_HOOKS_SERVER]);
    const state = get.error ? 'missing' : parseClaudeMcpStatus(`${get.stdout}\n${get.stderr}`);
    if (state !== 'connected') {
      problems.push(
        `The Overlord hooks MCP server (${CLAUDE_HOOKS_SERVER}) is ` +
          `${state === 'missing' ? 'not registered' : 'not connected'}. Re-run ` +
          '`ovld agent-setup claude`, make sure `node` is on PATH, and enable the server in ' +
          `Claude Code's \`/mcp\` menu if it is disabled. ${CLAUDE_HOOKS_CLI_FALLBACK}`
      );
    }
  }

  return { version, problems, warnings };
}
