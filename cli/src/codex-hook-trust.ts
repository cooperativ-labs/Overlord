import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

import { compareSemver, parseSemver } from './semver.js';

/**
 * Codex hook trust for the Overlord plugin.
 *
 * Codex runs a plugin hook only after the user approves it (`/hooks` in the TUI). The
 * approval is stored in `~/.codex/config.toml` under `[hooks.state."<plugin>:<file>:<event>:<group>:<handler>"]`.
 * From Codex 0.164 the approval also pins a fingerprint of the whole installed plugin
 * bundle (`trusted_content_hash`), so any change to the plugin — including the version bump
 * that every connector release makes — returns the hooks to "modified" until the user
 * approves them again. Untrusted hooks are skipped; `codex exec` skips them silently.
 *
 * This module reproduces the fingerprint so `ovld doctor` and `ovld agent-setup codex` can say
 * when Overlord's hooks will not run. It never writes trust: approving hooks is the user's call.
 *
 * Verified against codex-rs/hooks/src/engine/plugin_fingerprint.rs and plugin_trust.rs at
 * rust-v0.171.0, and against live approvals written by codex-cli 0.170.0.
 */

/** First Codex release verified to gate hooks on persisted trust. */
export const CODEX_HOOK_TRUST_MIN_VERSION = '0.147.0';

export type CodexHookTrustStatus = 'trusted' | 'modified' | 'untrusted' | 'disabled';

export type CodexHookTrustEntry = {
  key: string;
  event: string;
  status: CodexHookTrustStatus;
};

export type CodexHookTrustReport = {
  /** False when the check was skipped (no hooks manifest, or Codex predates hook trust). */
  checked: boolean;
  pluginRoot: string | null;
  contentHash: string | null;
  hooks: CodexHookTrustEntry[];
  problems: string[];
};

const EXCLUDED_NAMES = new Set(['__pycache__', '.venv']);

function isExcluded(name: string): boolean {
  return EXCLUDED_NAMES.has(name) || name.endsWith('.pyc') || name.endsWith('.egg-info');
}

function u64le(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

/** Port of Codex `plugin_content_hash`: a length-prefixed, sorted walk of the plugin bundle. */
export function codexPluginContentHash(root: string): string {
  if (!lstatSync(root).isDirectory()) throw new Error('plugin root is not a directory');
  const hash = createHash('sha256');
  hash.update('codex-plugin-bundle-v1');
  const pending: string[] = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const relative = current === root ? '' : path.relative(root, current);
    if (relative && isExcluded(path.basename(relative))) continue;
    const name = Buffer.from(relative, 'utf8');
    hash.update(u64le(name.length));
    hash.update(name);
    const stat = lstatSync(current);
    if (stat.isDirectory()) {
      hash.update('directory');
      const entries = readdirSync(current).sort((a, b) =>
        Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
      );
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        pending.push(path.join(current, entries[index] as string));
      }
    } else if (stat.isFile()) {
      hash.update('file');
      hash.update(u64le(stat.size));
      hash.update(readFileSync(current));
    } else {
      throw new Error(`unsupported plugin entry type: ${current}`);
    }
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Path of Codex's pre-content-pin approval baseline for one plugin (`.hook-trust/<id>`). */
export function codexLegacyTrustPath(configFile: string, pluginId: string): string {
  const identity = createHash('sha256');
  for (const part of [Buffer.from(configFile, 'utf8'), Buffer.from(pluginId, 'utf8')]) {
    identity.update(u64le(part.length));
    identity.update(part);
  }
  return path.join(path.dirname(configFile), '.hook-trust', identity.digest('hex'));
}

/** `UserPromptSubmit` → `user_prompt_submit`, the event label Codex uses in hook keys. */
export function codexHookEventLabel(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Hook-state keys Codex derives for every handler in a plugin hooks manifest. */
export function codexPluginHookKeys({
  pluginId,
  manifestRelativePath,
  manifest
}: {
  pluginId: string;
  manifestRelativePath: string;
  manifest: unknown;
}): Array<{ key: string; event: string }> {
  const hooks =
    manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).hooks
      : undefined;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const keys: Array<{ key: string; event: string }> = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      const handlers =
        group && typeof group === 'object' ? (group as Record<string, unknown>).hooks : undefined;
      if (!Array.isArray(handlers)) return;
      handlers.forEach((_handler, handlerIndex) => {
        keys.push({
          event,
          key: `${pluginId}:${manifestRelativePath}:${codexHookEventLabel(event)}:${groupIndex}:${handlerIndex}`
        });
      });
    });
  }
  return keys;
}

type HookState = { trustedHash?: string; trustedContentHash?: string; enabled?: boolean };

function readHookStates(configFile: string): Map<string, HookState> {
  const states = new Map<string, HookState>();
  if (!existsSync(configFile)) return states;
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  } catch {
    return states;
  }
  const hooks = parsed.hooks as Record<string, unknown> | undefined;
  const state = hooks?.state as Record<string, unknown> | undefined;
  if (!state || typeof state !== 'object') return states;
  for (const [key, value] of Object.entries(state)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    states.set(key, {
      trustedHash: typeof record.trusted_hash === 'string' ? record.trusted_hash : undefined,
      trustedContentHash:
        typeof record.trusted_content_hash === 'string' ? record.trusted_content_hash : undefined,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined
    });
  }
  return states;
}

/** `codex-cli 0.170.0` → `0.170.0`; null when Codex is missing or prints something else. */
export function detectCodexVersion(binary = 'codex'): string | null {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.error || result.status !== 0) return null;
  return parseSemver(`${result.stdout ?? ''}`);
}

/**
 * Report whether Codex will run the Overlord plugin's hooks. The declaration half of Codex's
 * approval (`trusted_hash`) is not recomputed here; the bundle fingerprint is, which is what
 * changes on every connector update.
 */
export function inspectCodexHookTrust({
  codexHome,
  installPath,
  pluginId,
  marketplaceName,
  codexVersion
}: {
  codexHome: string;
  installPath: string;
  pluginId: string;
  marketplaceName: string;
  codexVersion: string | null;
}): CodexHookTrustReport {
  const skipped: CodexHookTrustReport = {
    checked: false,
    pluginRoot: null,
    contentHash: null,
    hooks: [],
    problems: []
  };
  if (!codexVersion || compareSemver(codexVersion, CODEX_HOOK_TRUST_MIN_VERSION) < 0) {
    return skipped;
  }
  const manifestRelativePath = '.codex-plugin/hooks.json';
  const manifestFile = path.join(installPath, manifestRelativePath);
  if (!existsSync(manifestFile)) return skipped;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch {
    return skipped;
  }
  const keys = codexPluginHookKeys({ pluginId, manifestRelativePath, manifest });
  if (keys.length === 0) return skipped;

  // Codex fingerprints the copy it installed into its plugin cache, keyed by plugin version.
  let pluginRoot = installPath;
  try {
    const pluginJson = JSON.parse(
      readFileSync(path.join(installPath, '.codex-plugin', 'plugin.json'), 'utf8')
    ) as Record<string, unknown>;
    const pluginName = pluginId.split('@')[0] as string;
    const cached = path.join(
      codexHome,
      'plugins',
      'cache',
      marketplaceName,
      pluginName,
      String(pluginJson.version ?? '')
    );
    if (pluginJson.version && existsSync(cached)) pluginRoot = cached;
  } catch {
    // Fall back to the install path; it is the source Codex copies into its cache.
  }

  let contentHash: string;
  try {
    contentHash = codexPluginContentHash(pluginRoot);
  } catch (error) {
    return {
      ...skipped,
      checked: true,
      pluginRoot,
      problems: [
        `Could not fingerprint the Codex plugin at ${pluginRoot}: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }

  const configFile = path.join(codexHome, 'config.toml');
  const states = readHookStates(configFile);
  const legacyPath = codexLegacyTrustPath(configFile, pluginId);
  const legacyBaseline = existsSync(legacyPath) ? readFileSync(legacyPath, 'utf8').trim() : null;

  const hooks: CodexHookTrustEntry[] = keys.map(({ key, event }) => {
    const state = states.get(key);
    if (state?.enabled === false) return { key, event, status: 'disabled' };
    if (!state?.trustedHash) return { key, event, status: 'untrusted' };
    const pinned = state.trustedContentHash ?? legacyBaseline;
    if (pinned && pinned !== contentHash) return { key, event, status: 'modified' };
    return { key, event, status: 'trusted' };
  });

  const describe = (status: CodexHookTrustStatus) =>
    [...new Set(hooks.filter(hook => hook.status === status).map(hook => hook.event))].join(', ');
  const problems: string[] = [];
  const modified = describe('modified');
  const untrusted = describe('untrusted');
  const disabled = describe('disabled');
  if (modified) {
    problems.push(
      `Codex will skip the Overlord ${modified} hook(s): the plugin changed since you approved them. ` +
        'Open Codex, run `/hooks`, and approve the Overlord hooks again.'
    );
  }
  if (untrusted) {
    problems.push(
      `Codex will skip the Overlord ${untrusted} hook(s) until you approve them. ` +
        'Open Codex, run `/hooks`, and approve the Overlord hooks.'
    );
  }
  if (disabled) {
    problems.push(`The Overlord ${disabled} hook(s) are turned off in Codex \`/hooks\`.`);
  }
  return { checked: true, pluginRoot, contentHash, hooks, problems };
}
