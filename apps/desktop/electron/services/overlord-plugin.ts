import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readTextFile, writeTextFile } from './agent-bundle/merge-helpers';

export type OverlordPluginStatusKind =
  | 'installed'
  | 'stale'
  | 'partial'
  | 'not_installed'
  | 'error';

export type OverlordPluginStatus = {
  status: OverlordPluginStatusKind;
  version: string | null;
  installedVersion: string | null;
  details: string;
  currentContentHash: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
};

export type OverlordPluginInstallResult = {
  ok: boolean;
  installedFiles: string[];
  error?: string;
};

export type OverlordPluginUninstallResult = {
  ok: boolean;
  removedFiles: string[];
  error?: string;
};

type PluginManifest = {
  version: string;
  contentHash: string;
  installedAt: string;
  files: string[];
};

type MarketplaceShape = {
  name?: string;
  interface?: {
    displayName?: string;
  };
  plugins?: Array<{
    name?: string;
    source?: {
      source?: string;
      path?: string;
    };
    policy?: {
      installation?: string;
      authentication?: string;
    };
    category?: string;
  }>;
};

const STATE_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_PATH = path.join(STATE_DIR, 'overlord-plugin-manifest.json');
const TARGET_PLUGIN_DIR = path.join(os.homedir(), '.codex', 'plugins', 'overlord');
const TARGET_PLUGIN_MANIFEST = path.join(TARGET_PLUGIN_DIR, '.codex-plugin', 'plugin.json');
const TARGET_PLUGIN_HOOKS = path.join(TARGET_PLUGIN_DIR, '.codex-plugin', 'hooks.json');
const TARGET_PLUGIN_MCP = path.join(TARGET_PLUGIN_DIR, '.mcp.json');
const TARGET_PLUGIN_SCRIPT = path.join(TARGET_PLUGIN_DIR, 'scripts', 'overlord-mcp.mjs');
const TARGET_PLUGIN_USER_PROMPT_HOOK = path.join(
  TARGET_PLUGIN_DIR,
  'scripts',
  'user-prompt-submit-hook.sh'
);
const TARGET_PLUGIN_PERMISSION_HOOK = path.join(TARGET_PLUGIN_DIR, 'scripts', 'permission-hook.sh');
const TARGET_MARKETPLACE = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json');
const TARGET_CODEX_RULES = path.join(os.homedir(), '.codex', 'rules', 'default.rules');
const LEGACY_CODEX_AGENTS = path.join(os.homedir(), '.codex', 'AGENTS.md');
const LEGACY_BUNDLE_MANIFEST = path.join(STATE_DIR, 'bundle-manifest.json');
const CODEX_RULES_START = '# overlord:permissions:start';
const CODEX_RULES_END = '# overlord:permissions:end';
const MD_MARKER_START = '<!-- overlord:managed:start -->';
const MD_MARKER_END = '<!-- overlord:managed:end -->';

function sourcePluginDir() {
  const appPath = app.getAppPath();
  const bundledPath = path.join(appPath, 'plugins', 'overlord');

  if (!app.isPackaged) {
    return bundledPath;
  }

  const unpackedPath = path.join(
    appPath.replace('app.asar', 'app.asar.unpacked'),
    'plugins',
    'overlord'
  );
  return fs.existsSync(unpackedPath) ? unpackedPath : bundledPath;
}

function sourcePluginManifest() {
  return path.join(sourcePluginDir(), '.codex-plugin', 'plugin.json');
}

function sourcePluginFiles(dir = sourcePluginDir()): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourcePluginFiles(resolved);
    }
    return [resolved];
  });
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function pluginVersion(filePath: string): string | null {
  const parsed = readJsonFile<{ version?: string }>(filePath);
  return typeof parsed?.version === 'string' ? parsed.version : null;
}

function contentHashForSource(): string {
  const hash = crypto.createHash('sha256');

  for (const filePath of sourcePluginFiles().sort()) {
    hash.update(path.relative(sourcePluginDir(), filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 16);
}

function readManifest(): PluginManifest | null {
  return readJsonFile<PluginManifest>(MANIFEST_PATH);
}

function writeManifest(manifest: PluginManifest) {
  writeJsonFile(MANIFEST_PATH, manifest);
}

function pluginMarketplaceEntryPresent(): boolean {
  const marketplace = readJsonFile<MarketplaceShape>(TARGET_MARKETPLACE);
  return Boolean(
    marketplace?.plugins?.some(
      plugin => plugin.name === 'overlord' && plugin.source?.source === 'local'
    )
  );
}

function managedFiles(): string[] {
  return [
    TARGET_PLUGIN_MANIFEST,
    TARGET_PLUGIN_HOOKS,
    TARGET_PLUGIN_MCP,
    TARGET_PLUGIN_SCRIPT,
    TARGET_PLUGIN_USER_PROMPT_HOOK,
    TARGET_PLUGIN_PERMISSION_HOOK,
    TARGET_MARKETPLACE,
    TARGET_CODEX_RULES
  ];
}

function installCodexHookCommand(): void {
  const hooks = readJsonFile<{
    hooks?: {
      PermissionRequest?: Array<{
        hooks?: Array<{
          type?: string;
          command?: string;
        }>;
      }>;
      UserPromptSubmit?: Array<{
        hooks?: Array<{
          type?: string;
          command?: string;
        }>;
      }>;
    };
  }>(TARGET_PLUGIN_HOOKS);
  if (!hooks || typeof hooks !== 'object') {
    throw new Error(`Codex hook manifest missing or invalid at ${TARGET_PLUGIN_HOOKS}`);
  }

  const permissionGroups = hooks.hooks?.PermissionRequest;
  if (!Array.isArray(permissionGroups)) {
    throw new Error(`Codex PermissionRequest hook missing in ${TARGET_PLUGIN_HOOKS}`);
  }
  for (const group of permissionGroups) {
    for (const hook of group.hooks ?? []) {
      if (hook.type === 'command') {
        hook.command = TARGET_PLUGIN_PERMISSION_HOOK;
      }
    }
  }

  const userPromptGroups = hooks.hooks?.UserPromptSubmit;
  if (!Array.isArray(userPromptGroups)) {
    throw new Error(`Codex UserPromptSubmit hook missing in ${TARGET_PLUGIN_HOOKS}`);
  }
  for (const group of userPromptGroups) {
    for (const hook of group.hooks ?? []) {
      if (hook.type === 'command') {
        hook.command = TARGET_PLUGIN_USER_PROMPT_HOOK;
      }
    }
  }

  writeJsonFile(TARGET_PLUGIN_HOOKS, hooks);
}

function mergeCodexRules(existingContent: string): string {
  const managedBlock = [
    CODEX_RULES_START,
    'prefix_rule(',
    '  pattern = ["npx", "overlord", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["ovld", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["curl", "-sS", "-X", "POST"],',
    '  decision = "allow",',
    '  justification = "Allow curl protocol POST commands without prompts.",',
    ')',
    CODEX_RULES_END
  ].join('\n');

  const startIndex = existingContent.indexOf(CODEX_RULES_START);
  const endIndex = existingContent.indexOf(CODEX_RULES_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd();
    const after = existingContent.slice(endIndex + CODEX_RULES_END.length).trimStart();

    if (!before && !after) return `${managedBlock}\n`;
    if (!before) return `${managedBlock}\n\n${after}`;
    if (!after) return `${before}\n\n${managedBlock}\n`;
    return `${before}\n\n${managedBlock}\n\n${after}`;
  }

  const trimmed = existingContent.trimEnd();
  if (!trimmed) return `${managedBlock}\n`;
  return `${trimmed}\n\n${managedBlock}\n`;
}

function removeManagedCodexRules(existingContent: string): string {
  const startIndex = existingContent.indexOf(CODEX_RULES_START);
  const endIndex = existingContent.indexOf(CODEX_RULES_END);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return existingContent;
  }

  const before = existingContent.slice(0, startIndex).trimEnd();
  const after = existingContent.slice(endIndex + CODEX_RULES_END.length).trimStart();
  if (!before && !after) return '';
  if (!before) return `${after}\n`;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}\n`;
}

function removeLegacyCodexBundle(): void {
  if (fs.existsSync(LEGACY_CODEX_AGENTS)) {
    const existing = readTextFile(LEGACY_CODEX_AGENTS);
    const startIndex = existing.indexOf(MD_MARKER_START);
    const endIndex = existing.indexOf(MD_MARKER_END);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      const before = existing.slice(0, startIndex).trimEnd();
      const after = existing.slice(endIndex + MD_MARKER_END.length).trimStart();
      const cleaned =
        !before && !after
          ? ''
          : !before
            ? `${after}\n`
            : !after
              ? `${before}\n`
              : `${before}\n\n${after}\n`;

      if (cleaned.trim().length > 0) {
        writeTextFile(LEGACY_CODEX_AGENTS, cleaned);
      } else {
        fs.rmSync(LEGACY_CODEX_AGENTS, { force: true });
      }
    }
  }

  const manifest = readJsonFile<Record<string, unknown>>(LEGACY_BUNDLE_MANIFEST);
  if (!manifest || typeof manifest !== 'object' || !('codex' in manifest)) {
    return;
  }

  delete manifest.codex;
  if (Object.keys(manifest).length === 0) {
    fs.rmSync(LEGACY_BUNDLE_MANIFEST, { force: true });
    return;
  }
  writeJsonFile(LEGACY_BUNDLE_MANIFEST, manifest);
}

function upsertMarketplaceEntry() {
  const current = readJsonFile<MarketplaceShape>(TARGET_MARKETPLACE) ?? {
    name: 'overlord-local',
    interface: { displayName: 'Overlord Local Plugins' },
    plugins: []
  };

  const nextPlugins = Array.isArray(current.plugins) ? [...current.plugins] : [];
  const entry = {
    name: 'overlord',
    source: {
      source: 'local',
      path: './.codex/plugins/overlord'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  };

  const existingIndex = nextPlugins.findIndex(plugin => plugin.name === 'overlord');
  if (existingIndex === -1) {
    nextPlugins.push(entry);
  } else {
    nextPlugins[existingIndex] = entry;
  }

  writeJsonFile(TARGET_MARKETPLACE, {
    name: current.name ?? 'overlord-local',
    interface: {
      displayName: current.interface?.displayName ?? 'Overlord Local Plugins'
    },
    plugins: nextPlugins
  });
}

function removeMarketplaceEntry() {
  const current = readJsonFile<MarketplaceShape>(TARGET_MARKETPLACE);
  if (!current) return;

  const nextPlugins = (current.plugins ?? []).filter(plugin => plugin.name !== 'overlord');
  writeJsonFile(TARGET_MARKETPLACE, {
    name: current.name ?? 'overlord-local',
    interface: current.interface ?? { displayName: 'Overlord Local Plugins' },
    plugins: nextPlugins
  });
}

export function getOverlordPluginStatus(): OverlordPluginStatus {
  const manifest = readManifest();
  const currentHash = contentHashForSource();
  const sourceVersion = pluginVersion(sourcePluginManifest());
  const files = managedFiles();
  const existingManagedFiles = files.filter(filePath => fs.existsSync(filePath));
  const missingManagedFiles = files.filter(filePath => !fs.existsSync(filePath));
  const managedFilesInstalled = files.every(filePath => fs.existsSync(filePath));
  const marketplaceInstalled = pluginMarketplaceEntryPresent();

  if (!manifest) {
    if (!managedFilesInstalled && !marketplaceInstalled) {
      return {
        status: 'not_installed',
        version: sourceVersion,
        installedVersion: null,
        details: 'Plugin not installed.',
        currentContentHash: currentHash,
        managedFiles: files,
        existingManagedFiles,
        missingManagedFiles
      };
    }

    return {
      status: 'partial',
      version: sourceVersion,
      installedVersion: pluginVersion(TARGET_PLUGIN_MANIFEST),
      details: 'Plugin files exist but no install manifest was found. Repair to re-register it.',
      currentContentHash: currentHash,
      managedFiles: files,
      existingManagedFiles,
      missingManagedFiles
    };
  }

  if (!managedFilesInstalled || !marketplaceInstalled) {
    return {
      status: 'partial',
      version: sourceVersion,
      installedVersion: manifest.version,
      details: 'Some managed plugin files are missing. Repair to reinstall them.',
      currentContentHash: currentHash,
      managedFiles: files,
      existingManagedFiles,
      missingManagedFiles
    };
  }

  if (manifest.version !== sourceVersion || manifest.contentHash !== currentHash) {
    return {
      status: 'stale',
      version: sourceVersion,
      installedVersion: manifest.version,
      details: 'A newer bundled plugin build is available. Update to refresh the installed copy.',
      currentContentHash: currentHash,
      managedFiles: files,
      existingManagedFiles,
      missingManagedFiles
    };
  }

  return {
    status: 'installed',
    version: sourceVersion,
    installedVersion: manifest.version,
    details: 'Home-local Overlord plugin is installed at ~/.codex/plugins and up to date.',
    currentContentHash: currentHash,
    managedFiles: files,
    existingManagedFiles,
    missingManagedFiles
  };
}

export function installOverlordPlugin(): OverlordPluginInstallResult {
  try {
    const sourceDir = sourcePluginDir();
    if (!fs.existsSync(sourceDir)) {
      return { ok: false, installedFiles: [], error: `Plugin source not found at ${sourceDir}.` };
    }

    fs.mkdirSync(path.dirname(TARGET_PLUGIN_DIR), { recursive: true });
    fs.rmSync(TARGET_PLUGIN_DIR, { recursive: true, force: true });
    fs.cpSync(sourceDir, TARGET_PLUGIN_DIR, { recursive: true });
    installCodexHookCommand();
    writeTextFile(TARGET_CODEX_RULES, mergeCodexRules(readTextFile(TARGET_CODEX_RULES)));
    removeLegacyCodexBundle();

    upsertMarketplaceEntry();

    const version = pluginVersion(sourcePluginManifest()) ?? '0.0.0';
    const hash = contentHashForSource();
    writeManifest({
      version,
      contentHash: hash,
      installedAt: new Date().toISOString(),
      files: managedFiles()
    });

    return {
      ok: true,
      installedFiles: managedFiles().filter(filePath => fs.existsSync(filePath))
    };
  } catch (error) {
    return {
      ok: false,
      installedFiles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function repairOverlordPlugin(): OverlordPluginInstallResult {
  return installOverlordPlugin();
}

export function uninstallOverlordPlugin(): OverlordPluginUninstallResult {
  try {
    const removedFiles: string[] = [];

    if (fs.existsSync(TARGET_PLUGIN_DIR)) {
      fs.rmSync(TARGET_PLUGIN_DIR, { recursive: true, force: true });
      removedFiles.push(TARGET_PLUGIN_DIR);
    }

    if (fs.existsSync(TARGET_MARKETPLACE)) {
      removeMarketplaceEntry();
      removedFiles.push(TARGET_MARKETPLACE);
    }

    if (fs.existsSync(TARGET_CODEX_RULES)) {
      const cleanedRules = removeManagedCodexRules(readTextFile(TARGET_CODEX_RULES));
      if (cleanedRules.trim().length > 0) {
        writeTextFile(TARGET_CODEX_RULES, cleanedRules);
      } else {
        fs.rmSync(TARGET_CODEX_RULES, { force: true });
      }
      removedFiles.push(TARGET_CODEX_RULES);
    }

    if (fs.existsSync(MANIFEST_PATH)) {
      fs.rmSync(MANIFEST_PATH, { force: true });
      removedFiles.push(MANIFEST_PATH);
    }

    return { ok: true, removedFiles };
  } catch (error) {
    return {
      ok: false,
      removedFiles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
