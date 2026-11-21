/**
 * Check the installed Antigravity plugin shape without installing into the user's home.
 *
 * Renders the adapter's managed files into a scratch plugin root, then:
 * 1. checks `plugin.json` and `mcp_config.json` against the documented plugin schema
 *    (https://antigravity.google/docs/build-plugins/) — always, with no agy needed; and
 * 2. runs `agy plugin validate --strict --json` on the rendered plugin when an `agy` that
 *    supports those flags is on PATH (or named by OVERLORD_AGY_BIN). Without agy the
 *    step is skipped; an agy too old for `--strict` runs plain `validate` and says so.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { resolveManagedFileContents } from '../cli/src/connector-core-render.ts';

if (process.argv.length > 2) {
  throw new Error('Usage: node --import tsx scripts/check-antigravity-plugin.mts');
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repo, 'connectors/adapters/antigravity');
const coreRoot = path.join(repo, 'connectors/core/overlord-mission');
const manifest = parseYaml(readFileSync(path.join(sourceDir, 'conformance-manifest.yaml'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'overlord-antigravity-plugin-'));
const plugin = path.join(scratch, 'overlord');

/** Top-level `plugin.json` properties the published schema allows (`additionalProperties: false`). */
const PLUGIN_JSON_PROPERTIES = new Set([
  '$schema',
  'name',
  'displayName',
  'description',
  'version',
  'disabled',
  'logo',
  'suggestedPrompts',
  'skills',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions'
]);
const MCP_SERVER_PROPERTIES = new Set([
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'serverUrl',
  'headers',
  'oauth',
  'variables',
  'disabled',
  'enabledTools',
  'disabledTools',
  'timeoutSeconds',
  'tools',
  'type'
]);
/** Hook events from https://antigravity.google/docs/hooks. Only the two tool events take a matcher. */
const HOOK_EVENTS = new Set([
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'PreInvocation',
  'PostInvocation',
  'Stop'
]);
const MATCHER_HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const HOOK_HANDLER_PROPERTIES = new Set(['type', 'command', 'timeout']);
const LOGO_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function schemaProblems(): string[] {
  const problems: string[] = [];
  const pluginJson = JSON.parse(readFileSync(path.join(plugin, 'plugin.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(pluginJson)) {
    if (!PLUGIN_JSON_PROPERTIES.has(key)) problems.push(`plugin.json: unknown field "${key}"`);
  }
  if (pluginJson.$schema !== 'https://antigravity.google/schemas/v1/plugin.json') {
    problems.push('plugin.json: $schema must be https://antigravity.google/schemas/v1/plugin.json');
  }
  if (typeof pluginJson.name !== 'string' || !NAME_PATTERN.test(pluginJson.name)) {
    problems.push('plugin.json: name must be lowercase kebab-case');
  }
  for (const key of ['displayName', 'description', 'version']) {
    if (typeof pluginJson[key] !== 'string' || !(pluginJson[key] as string).trim()) {
      problems.push(`plugin.json: ${key} must be a non-empty string`);
    }
  }
  const displayName = String(pluginJson.displayName ?? '');
  if (
    /\b(plugin|mcp)\s*$/i.test(displayName) ||
    /^(antigravity|gemini|claude|cursor)\b/i.test(displayName)
  ) {
    problems.push(
      'plugin.json: displayName must not end in "Plugin"/"MCP" or start with a host name'
    );
  }
  const prompts = pluginJson.suggestedPrompts;
  if (
    prompts !== undefined &&
    (!Array.isArray(prompts) ||
      prompts.length > 3 ||
      prompts.some(prompt => typeof prompt !== 'string' || !/\S/.test(prompt)))
  ) {
    problems.push('plugin.json: suggestedPrompts must be at most 3 non-blank strings');
  }
  const logo = pluginJson.logo;
  if (typeof logo !== 'string' || !logo.trim()) {
    problems.push('plugin.json: logo must name a bundled image');
  } else if (
    path.isAbsolute(logo) ||
    logo.includes('\\') ||
    logo.split('/').includes('..') ||
    !LOGO_EXTENSIONS.has(path.extname(logo).toLowerCase())
  ) {
    problems.push(`plugin.json: logo "${logo}" must be a relative .svg/.png/.jpg/.jpeg/.webp path`);
  } else if (!existsSync(path.join(plugin, logo))) {
    problems.push(`plugin.json: logo "${logo}" is not a managed file`);
  }

  const mcpConfig = JSON.parse(readFileSync(path.join(plugin, 'mcp_config.json'), 'utf8')) as {
    mcpServers?: Record<string, Record<string, unknown>>;
  };
  for (const [server, config] of Object.entries(mcpConfig.mcpServers ?? {})) {
    for (const key of Object.keys(config)) {
      if (!MCP_SERVER_PROPERTIES.has(key)) {
        problems.push(`mcp_config.json: server "${server}" has unknown field "${key}"`);
      }
    }
    for (const arg of (config.args as unknown[] | undefined) ?? []) {
      if (typeof arg === 'string' && arg.startsWith('./') && !existsSync(path.join(plugin, arg))) {
        problems.push(`mcp_config.json: server "${server}" references missing file ${arg}`);
      }
    }
  }
  problems.push(...hooksProblems());
  return problems;
}

/**
 * `hooks.json` against the documented shape: named groups with an optional `enabled` flag, one key
 * per event, a matcher list only for the tool events, and `command` handlers whose script is a
 * relative, executable, managed file (plugin hooks run with the plugin folder as cwd).
 */
function hooksProblems(): string[] {
  const problems: string[] = [];
  const hooks = JSON.parse(readFileSync(path.join(plugin, 'hooks.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const checkHandler = (where: string, handler: unknown): void => {
    if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
      problems.push(`hooks.json: ${where} must be a handler object`);
      return;
    }
    const record = handler as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!HOOK_HANDLER_PROPERTIES.has(key)) {
        problems.push(`hooks.json: ${where} has unknown field "${key}"`);
      }
    }
    if (record.type !== undefined && record.type !== 'command') {
      problems.push(`hooks.json: ${where} type must be "command"`);
    }
    if (
      record.timeout !== undefined &&
      (!Number.isInteger(record.timeout) || (record.timeout as number) <= 0)
    ) {
      problems.push(`hooks.json: ${where} timeout must be a positive integer (seconds)`);
    }
    const command = record.command;
    if (typeof command !== 'string' || !command.trim()) {
      problems.push(`hooks.json: ${where} command must be a non-empty string`);
      return;
    }
    if (/\$\{?PLUGIN_ROOT\b/.test(command)) {
      problems.push(`hooks.json: ${where} must use a relative path, not PLUGIN_ROOT`);
    }
    const script = command.trim().split(/\s+/)[0] ?? '';
    if (script.startsWith('./')) {
      const target = path.join(plugin, script);
      if (!existsSync(target)) {
        problems.push(`hooks.json: ${where} references missing file ${script}`);
      } else if ((statSync(target).mode & 0o111) === 0) {
        problems.push(`hooks.json: ${where} script ${script} is not executable`);
      }
    }
  };
  for (const [group, value] of Object.entries(hooks)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`hooks.json: group "${group}" must be an object`);
      continue;
    }
    for (const [event, entries] of Object.entries(value as Record<string, unknown>)) {
      if (event === 'enabled') {
        if (typeof entries !== 'boolean') {
          problems.push(`hooks.json: group "${group}" enabled must be a boolean`);
        }
        continue;
      }
      if (!HOOK_EVENTS.has(event)) {
        problems.push(`hooks.json: group "${group}" has unknown event "${event}"`);
        continue;
      }
      if (!Array.isArray(entries)) {
        problems.push(`hooks.json: ${group}.${event} must be an array`);
        continue;
      }
      entries.forEach((entry, index) => {
        const where = `${group}.${event}[${index}]`;
        if (!MATCHER_HOOK_EVENTS.has(event)) {
          checkHandler(where, entry);
          return;
        }
        const record = (entry ?? {}) as Record<string, unknown>;
        if (typeof record.matcher !== 'string') {
          problems.push(`hooks.json: ${where} matcher must be a string`);
        } else {
          try {
            new RegExp(record.matcher);
          } catch {
            problems.push(`hooks.json: ${where} matcher is not a valid regular expression`);
          }
        }
        if (!Array.isArray(record.hooks) || record.hooks.length === 0) {
          problems.push(`hooks.json: ${where} hooks must be a non-empty array`);
          return;
        }
        record.hooks.forEach((handler, handlerIndex) =>
          checkHandler(`${where}.hooks[${handlerIndex}]`, handler)
        );
      });
    }
  }
  return problems;
}

function resolveAgy(): string | null {
  const candidate = process.env.OVERLORD_AGY_BIN || 'agy';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return probe.error ? null : candidate;
}

function runAgyValidate(agy: string): number {
  // agy before the --strict/--json validator treats any flag as the plugin path, so ask
  // the help text rather than guessing from a version number.
  const help = spawnSync(agy, ['plugin', 'validate', '--help'], {
    encoding: 'utf8',
    timeout: 30_000
  });
  const supportsStrict = `${help.stdout ?? ''}${help.stderr ?? ''}`.includes('--strict');
  const args = supportsStrict
    ? ['plugin', 'validate', '--strict', '--json', plugin]
    : ['plugin', 'validate', plugin];
  const result = spawnSync(agy, args, {
    cwd: scratch,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 120_000
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (!supportsStrict) {
    process.stdout.write(
      'agy plugin validate: this agy has no --strict/--json; ran the basic validator. ' +
        'Run `agy update` for the strict check.\n'
    );
  }
  return result.status ?? 1;
}

try {
  for (const relativePath of manifest.connector.managedFiles as string[]) {
    const target = path.resolve(plugin, relativePath);
    if (!target.startsWith(`${plugin}${path.sep}`))
      throw new Error(`Invalid managed path: ${relativePath}`);
    const contents = resolveManagedFileContents({
      sourceDir,
      relativePath,
      adapterKey: 'antigravity',
      coreRoot
    });
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    if (relativePath.endsWith('.sh')) chmodSync(target, 0o755);
  }

  const problems = schemaProblems();
  for (const problem of problems) process.stderr.write(`antigravity plugin: ${problem}\n`);
  if (problems.length > 0) {
    process.exitCode = 1;
  } else {
    process.stdout.write('antigravity plugin: manifest matches the documented plugin schema.\n');
    const agy = resolveAgy();
    if (!agy) {
      process.stdout.write('agy plugin validate: skipped (agy not on PATH).\n');
    } else {
      process.exitCode = runAgyValidate(agy);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
