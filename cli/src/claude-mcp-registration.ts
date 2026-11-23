import { findSecretInArgv, looksLikeUserToken } from './argv-secrets.js';
import { compareSemver, parseSemver as parseClaudeVersion } from './semver.js';

/** `2.1.327 (Claude Code)` → `2.1.327`; null for anything else. */
export { parseClaudeVersion };

/**
 * Token-safe MCP server registration for Claude Code.
 *
 * `claude mcp add` and `claude mcp add-json <name> '<json>'` take the server definition —
 * including any `env` or `headers` credential — on argv, where every local user can read it.
 * Claude Code 2.1.327 added `claude mcp add-json <name> -`, which reads the JSON from stdin.
 * Registration uses that form whenever the installed Claude Code supports it. On an older
 * Claude Code, or inside a Claude Code session where the stdin form is unavailable, a
 * definition that carries no credential falls back to the argv form; one that carries a
 * credential is not registered at all, and the caller gets a warning saying how to fix it.
 *
 * `ovld agent-setup claude` does not register an MCP server today: the Claude connector is a
 * plugin whose hooks call `ovld` with credentials in the environment. This is the only path
 * any future Claude MCP registration (for example coo:1323's `mcp_tool` hooks) may use.
 */

export const CLAUDE_MCP_ADD_JSON_STDIN_MIN_VERSION = '2.1.327';

export type ClaudeMcpScope = 'user' | 'project' | 'local';

export type ClaudeMcpServerConfig =
  | {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export type ClaudeCliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

/** Runs the Claude CLI with `args`, writing `input` to its stdin when given. */
export type ClaudeCliRunner = (args: string[], options?: { input?: string }) => ClaudeCliResult;

export type ClaudeMcpRegistrationMethod = 'add-json-stdin' | 'add-json-argv';

export type ClaudeMcpRegistrationResult = {
  registered: boolean;
  method: ClaudeMcpRegistrationMethod | null;
  claudeVersion: string | null;
  warnings: string[];
};

export function supportsMcpAddJsonStdin(version: string | null): boolean {
  return version !== null && compareSemver(version, CLAUDE_MCP_ADD_JSON_STDIN_MIN_VERSION) >= 0;
}

/** Claude Code sets `CLAUDECODE=1` for processes it starts; the stdin form is unavailable there. */
export function isInsideClaudeCodeSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDECODE === '1';
}

export function detectClaudeVersion(run: ClaudeCliRunner): string | null {
  const result = run(['--version']);
  if (result.error || result.status !== 0) return null;
  return parseClaudeVersion(`${result.stdout}`);
}

/** True when the definition holds any value that must not reach argv. */
export function mcpConfigCarriesSecrets(config: ClaudeMcpServerConfig): boolean {
  // Any env var or header is presumed sensitive: `Authorization`, `X-Api-Key` and friends are
  // the reason a definition has headers at all, and env is where stdio servers take their
  // credentials.
  const keyed = 'command' in config ? (config.env ?? {}) : (config.headers ?? {});
  if (Object.keys(keyed).length > 0) return true;
  const plain = 'command' in config ? [config.command, ...(config.args ?? [])] : [config.url];
  return plain.some(value => looksLikeUserToken(value) || /[?&][^=]*(token|key)=/i.test(value));
}

function scopeArgs(scope: ClaudeMcpScope): string[] {
  return ['--scope', scope];
}

function output(result: ClaudeCliResult): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/**
 * Register (or replace) MCP server `name` with Claude Code without ever putting a credential
 * on argv. Returns warnings instead of throwing so setup can report and continue.
 */
export function registerClaudeMcpServer({
  name,
  config,
  scope = 'user',
  run,
  env = process.env,
  claudeVersion
}: {
  name: string;
  config: ClaudeMcpServerConfig;
  scope?: ClaudeMcpScope;
  run: ClaudeCliRunner;
  env?: NodeJS.ProcessEnv;
  /** Skip detection when the caller already knows the version (null = unknown). */
  claudeVersion?: string | null;
}): ClaudeMcpRegistrationResult {
  const version = claudeVersion === undefined ? detectClaudeVersion(run) : claudeVersion;
  const json = JSON.stringify(config);
  const warnings: string[] = [];
  const result = (
    registered: boolean,
    method: ClaudeMcpRegistrationMethod | null
  ): ClaudeMcpRegistrationResult => ({ registered, method, claudeVersion: version, warnings });

  // Every invocation goes through here, so no branch can put a credential on argv.
  const guardedRun = (args: string[], input?: string): ClaudeCliResult | null => {
    if (findSecretInArgv(args, { env }) !== -1) {
      warnings.push(
        `Did not register the "${name}" MCP server: its definition would have put a credential ` +
          'on the claude command line.'
      );
      return null;
    }
    return run(args, input === undefined ? undefined : { input });
  };

  // `add-json` refuses to overwrite; remove first so re-running setup refreshes the definition.
  const addWithReplace = (args: string[], input?: string): ClaudeCliResult | null => {
    const first = guardedRun(args, input);
    if (!first || first.status === 0) return first;
    if (!/already exists/i.test(output(first))) return first;
    guardedRun(['mcp', 'remove', name, ...scopeArgs(scope)]);
    return guardedRun(args, input);
  };

  const stdinAvailable = supportsMcpAddJsonStdin(version) && !isInsideClaudeCodeSession(env);
  if (stdinAvailable) {
    const added = addWithReplace(['mcp', 'add-json', name, '-', ...scopeArgs(scope)], `${json}\n`);
    if (!added) return result(false, null);
    if (added.status === 0) return result(true, 'add-json-stdin');
    warnings.push(
      `\`claude mcp add-json ${name} -\` failed: ${output(added).trim() || `exit ${added.status}`}.`
    );
  }

  if (mcpConfigCarriesSecrets(config)) {
    const reason = isInsideClaudeCodeSession(env)
      ? 'this command is running inside a Claude Code session, where `claude mcp add-json <name> -` is unavailable'
      : version === null
        ? 'the Claude Code version could not be determined'
        : supportsMcpAddJsonStdin(version)
          ? 'reading the definition from stdin failed'
          : `Claude Code ${version} cannot read an MCP definition from stdin`;
    warnings.push(
      `Did not register the "${name}" MCP server: ${reason}, and its definition carries a ` +
        `credential that Overlord will not pass on the command line. Upgrade Claude Code to ` +
        `${CLAUDE_MCP_ADD_JSON_STDIN_MIN_VERSION} or later and re-run setup from a regular terminal.`
    );
    return result(false, null);
  }

  const added = addWithReplace(['mcp', 'add-json', name, json, ...scopeArgs(scope)]);
  if (!added) return result(false, null);
  if (added.error && (added.error as NodeJS.ErrnoException).code === 'ENOENT') {
    warnings.push(`Claude CLI not found on PATH; did not register the "${name}" MCP server.`);
    return result(false, null);
  }
  if (added.status !== 0) {
    warnings.push(
      `Could not register the "${name}" MCP server with Claude Code: ` +
        `${output(added).trim() || `exit ${added.status}`}.`
    );
    return result(false, null);
  }
  return result(true, 'add-json-argv');
}
