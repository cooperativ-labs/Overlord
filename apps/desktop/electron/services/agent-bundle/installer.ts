/**
 * Agent bundle installer — installs and manages durable Overlord workflow
 * configuration for Claude Code and OpenCode.
 *
 * Responsibilities:
 * - Detect current install status per agent
 * - Merge Overlord-owned config into user files without clobbering
 * - Create backups before modifying user-managed root config files
 * - Record bundle version and hashes for repair/update detection
 * - Expose install, repair, and status operations
 */

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import legacyGeminiConnector from '../../../../../lib/overlord/legacy-gemini-connector.cjs';

import {
  backupFile,
  hasOverlordSection,
  mergeMarkdownSection,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile
} from './merge-helpers';

const { removeLegacyGeminiConnector: removeLegacyGeminiConnectorFiles } = legacyGeminiConnector;
import { installSlashCommands, uninstallSlashCommands } from './slash-commands';
import { BUNDLE_VERSION, JSON_MARKER_KEY, OPENCODE_AGENTS_SECTION } from './templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentBundleAgent = 'claude' | 'cursor' | 'antigravity' | 'opencode';

export type BundleStatus = 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';

export type AgentBundleStatus = {
  agent: AgentBundleAgent;
  status: BundleStatus;
  version: string | null;
  installedVersion: string | null;
  details: string;
  /** Current content hash — useful for building unique dismiss keys. */
  currentContentHash: string;
};

export type InstallResult = {
  ok: boolean;
  agent: AgentBundleAgent;
  backups: string[];
  error?: string;
};

type ManifestEntry = {
  version: string;
  contentHash: string;
  installedAt: string;
  files: string[];
};

type BundleManifest = {
  claude?: ManifestEntry;
  cursor?: ManifestEntry;
  antigravity?: ManifestEntry;
  opencode?: ManifestEntry;
  /** @deprecated Legacy Gemini connector manifest entry removed during migration. */
  gemini?: ManifestEntry;
};

const ANTIGRAVITY_RUNTIME_SCRIPTS_DIR = path.join(os.homedir(), '.ovld', 'antigravity', 'scripts');
const ANTIGRAVITY_INSTALLED_PLUGINS_DIR = path.join(
  os.homedir(),
  '.gemini',
  'antigravity-cli',
  'plugins'
);
const ANTIGRAVITY_MCP_PATH_PLACEHOLDER = '__OVERLORD_MCP_SCRIPT_PATH__';
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MANIFEST_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'bundle-manifest.json');

const CLAUDE_MARKETPLACE_NAME = 'overlord-local';
const CLAUDE_PLUGIN_NAME = 'overlord';

function claudePaths() {
  const base = path.join(os.homedir(), '.claude');
  const pluginsBase = path.join(base, 'plugins');
  const marketplaceRoot = path.join(os.homedir(), '.ovld', 'claude-marketplace');
  return {
    skillDir: path.join(base, 'skills', 'overlord-local'),
    skillFile: path.join(base, 'skills', 'overlord-local', 'SKILL.md'),
    settingsFile: path.join(base, 'settings.json'),
    hookScript: path.join(base, 'overlord-permission-hook.sh'),
    // Local marketplace files the Claude desktop app reads on startup.
    knownMarketplacesFile: path.join(pluginsBase, 'known_marketplaces.json'),
    installedPluginsFile: path.join(pluginsBase, 'installed_plugins.json'),
    pluginCacheDir: path.join(pluginsBase, 'cache', CLAUDE_MARKETPLACE_NAME, CLAUDE_PLUGIN_NAME),
    // Marketplace wrapper we generate outside the asar bundle so the path is stable
    // across Overlord app versions.
    marketplaceRoot,
    marketplaceManifest: path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
    marketplacePluginDir: path.join(marketplaceRoot, 'plugins', CLAUDE_PLUGIN_NAME)
  };
}

function claudeSourcePluginDir(): string {
  const appPath = app.getAppPath();
  const bundledPath = path.join(appPath, 'plugins', 'claude');
  if (!app.isPackaged) return bundledPath;

  const unpackedPath = path.join(
    appPath.replace('app.asar', 'app.asar.unpacked'),
    'plugins',
    'claude'
  );
  return fs.existsSync(unpackedPath) ? unpackedPath : bundledPath;
}

function openCodePaths() {
  const base = path.join(os.homedir(), '.config', 'opencode');
  return {
    agentsFile: path.join(base, 'AGENTS.md'),
    configFile: path.join(base, 'opencode.json')
  };
}

const CURSOR_USER_PROMPT_HOOK_RELATIVE =
  'plugins/local/overlord/hooks/overlord-user-prompt-submit.sh';

function isOverlordCursorBeforeSubmitHook(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = (entry as { command?: string }).command ?? '';
  return cmd.includes('overlord-user-prompt-submit');
}

function mergeCursorBeforeSubmitHook({ hooksFile }: { hooksFile: string }): void {
  const base = fs.existsSync(hooksFile)
    ? (readJsonFile(hooksFile) as Record<string, unknown>)
    : { version: 1, hooks: {} };
  const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
  const existing = Array.isArray(hooks.beforeSubmitPrompt) ? hooks.beforeSubmitPrompt : [];
  hooks.beforeSubmitPrompt = [
    ...existing.filter(entry => !isOverlordCursorBeforeSubmitHook(entry)),
    { command: CURSOR_USER_PROMPT_HOOK_RELATIVE }
  ];
  writeJsonFile(hooksFile, {
    ...base,
    version: typeof base.version === 'number' ? base.version : 1,
    hooks
  });
}

function removeCursorBeforeSubmitHook({ hooksFile }: { hooksFile: string }): void {
  if (!fs.existsSync(hooksFile)) return;
  const base = readJsonFile(hooksFile) as Record<string, unknown>;
  const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
  if (!Array.isArray(hooks.beforeSubmitPrompt)) return;
  hooks.beforeSubmitPrompt = hooks.beforeSubmitPrompt.filter(
    entry => !isOverlordCursorBeforeSubmitHook(entry)
  );
  if (hooks.beforeSubmitPrompt.length === 0) {
    delete hooks.beforeSubmitPrompt;
  }
  if (Object.keys(hooks).length === 0) {
    delete base.hooks;
  } else {
    base.hooks = hooks;
  }
  writeJsonFile(hooksFile, base);
}

function cursorPaths() {
  const base = path.join(os.homedir(), '.cursor');
  return {
    pluginDir: path.join(base, 'plugins', 'local', 'overlord'),
    pluginManifest: path.join(
      base,
      'plugins',
      'local',
      'overlord',
      '.cursor-plugin',
      'plugin.json'
    ),
    rulesFile: path.join(base, 'rules', 'overlord-local.mdc'),
    settingsFile: path.join(base, 'settings.json'),
    hooksFile: path.join(base, 'hooks.json')
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function antigravityPaths() {
  return {
    policyFile: path.join(os.homedir(), '.gemini', 'policies', 'overlord-protocol.toml'),
    installedPluginJson: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'plugin.json'),
    installedHooks: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'hooks.json'),
    installedMcp: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'mcp_config.json'),
    runtimeMcp: path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, 'overlord-mcp.mjs'),
    runtimeHook: path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, 'user-prompt-submit-hook.sh')
  };
}

function monorepoAntigravityPluginCandidates(appPath: string): string[] {
  return [
    path.join(appPath, 'packages', 'overlord-cli', 'plugins', 'antigravity'),
    path.join(appPath, '..', '..', 'packages', 'overlord-cli', 'plugins', 'antigravity'),
    path.join(appPath, '..', '..', 'plugins', 'antigravity'),
    path.join(appPath, 'plugins', 'antigravity')
  ];
}

function antigravitySourcePluginDir(): string {
  const appPath = app.getAppPath();
  const unpackedAppPath = appPath.replace('app.asar', 'app.asar.unpacked');
  const candidates = [
    ...(!app.isPackaged ? monorepoAntigravityPluginCandidates(appPath) : []),
    path.join(unpackedAppPath, 'plugins', 'antigravity'),
    path.join(unpackedAppPath, 'packages', 'overlord-cli', 'plugins', 'antigravity'),
    path.join(appPath, 'plugins', 'antigravity'),
    path.join(appPath, 'packages', 'overlord-cli', 'plugins', 'antigravity')
  ];

  return (
    candidates.find(candidate => fs.existsSync(path.join(candidate, 'plugin.json'))) ??
    candidates[0]
  );
}

function ensureAntigravityRuntimeScripts(sourceDir: string): void {
  const scriptNames = ['overlord-mcp.mjs', 'user-prompt-submit-hook.sh'];
  fs.mkdirSync(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, { recursive: true });

  for (const scriptName of scriptNames) {
    const sourcePath = path.join(sourceDir, 'scripts', scriptName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Antigravity runtime script missing: ${sourcePath}`);
    }
    const targetPath = path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, scriptName);
    fs.copyFileSync(sourcePath, targetPath);
    if (scriptName.endsWith('.sh')) {
      fs.chmodSync(targetPath, 0o755);
    }
  }
}

function patchAntigravityMcpServers(
  servers: Record<string, { command?: string; args?: unknown[] }> | undefined,
  mcpScriptPath: string
): void {
  if (!servers || typeof servers !== 'object') return;
  for (const entry of Object.values(servers)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.args)) continue;
    const referencesOverlordMcp = entry.args.some(
      arg =>
        arg === ANTIGRAVITY_MCP_PATH_PLACEHOLDER ||
        (typeof arg === 'string' && arg.includes('overlord-mcp'))
    );
    if (referencesOverlordMcp) {
      entry.args = [mcpScriptPath];
      entry.command = entry.command ?? 'node';
    }
  }
}

function patchAntigravityInstalledPaths({
  mcpScriptPath,
  hookScriptPath
}: {
  mcpScriptPath: string;
  hookScriptPath: string;
}): void {
  const paths = antigravityPaths();

  if (fs.existsSync(paths.installedHooks)) {
    const hooks = readJsonFile(paths.installedHooks) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string }> }>>;
    };
    const groups = hooks.hooks;
    if (groups) {
      for (const eventHooks of Object.values(groups)) {
        if (!Array.isArray(eventHooks)) continue;
        for (const group of eventHooks) {
          if (!group?.hooks) continue;
          for (const hook of group.hooks) {
            if (hook?.type !== 'command') continue;
            hook.command = hookScriptPath;
          }
        }
      }
      writeJsonFile(paths.installedHooks, hooks as Record<string, unknown>);
    }
  }

  if (fs.existsSync(paths.installedMcp)) {
    const mcpConfig = readJsonFile(paths.installedMcp) as {
      mcpServers?: Record<string, { command?: string; args?: unknown[] }>;
    };
    patchAntigravityMcpServers(mcpConfig.mcpServers, mcpScriptPath);
    writeJsonFile(paths.installedMcp, mcpConfig as Record<string, unknown>);
  }

  if (fs.existsSync(paths.installedPluginJson)) {
    const pluginJson = readJsonFile(paths.installedPluginJson) as {
      mcpServers?: Record<string, { command?: string; args?: unknown[] }>;
    };
    patchAntigravityMcpServers(pluginJson.mcpServers, mcpScriptPath);
    writeJsonFile(paths.installedPluginJson, pluginJson as Record<string, unknown>);
  }
}

function runAgyPluginInstall(sourceDir: string): void {
  try {
    execFileSync('agy', ['plugin', 'install', sourceDir], { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already') || message.includes('imported')) {
      execFileSync('agy', ['plugin', 'import', '--force', sourceDir], { stdio: 'inherit' });
      return;
    }
    throw error;
  }
}

function removeLegacyGeminiConnector(): string[] {
  return removeLegacyGeminiConnectorFiles({
    readManifest,
    writeManifest: manifest => writeManifest(manifest as BundleManifest),
    readTextFile
  });
}

function checkAntigravityFilesExist(): boolean {
  const paths = antigravityPaths();
  return (
    fs.existsSync(paths.installedPluginJson) &&
    fs.existsSync(paths.runtimeMcp) &&
    fs.existsSync(paths.runtimeHook)
  );
}

function cursorSourcePluginDir(): string {
  const appPath = app.getAppPath();
  const unpackedAppPath = appPath.replace('app.asar', 'app.asar.unpacked');
  const candidates = [
    path.join(unpackedAppPath, 'plugins', 'cursor'),
    path.join(unpackedAppPath, 'packages', 'overlord-cli', 'plugins', 'cursor'),
    path.join(appPath, 'plugins', 'cursor'),
    path.join(appPath, 'packages', 'overlord-cli', 'plugins', 'cursor')
  ];

  return (
    candidates.find(candidate =>
      fs.existsSync(path.join(candidate, '.cursor-plugin', 'plugin.json'))
    ) ?? candidates[0]
  );
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function readManifest(): BundleManifest {
  return readJsonFile(MANIFEST_FILE) as BundleManifest;
}

function writeManifest(manifest: BundleManifest): void {
  writeJsonFile(MANIFEST_FILE, manifest as Record<string, unknown>);
}

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(resolved);
    return [resolved];
  });
}

function contentHashForDirectory(sourceDir: string): string {
  const hash = crypto.createHash('sha256');
  for (const filePath of listFilesRecursive(sourceDir).sort()) {
    hash.update(path.relative(sourceDir, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function pluginVersion(filePath: string): string | null {
  const parsed = readJsonFile(filePath) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Returns the content hash for the current (bundled) template of a given agent. */
function currentContentHashForAgent(agent: AgentBundleAgent): string {
  if (agent === 'claude') return contentHashForDirectory(claudeSourcePluginDir());
  if (agent === 'cursor') return contentHashForDirectory(cursorSourcePluginDir());
  if (agent === 'antigravity') return contentHashForDirectory(antigravitySourcePluginDir());
  return contentHash(OPENCODE_AGENTS_SECTION);
}

export function getAgentBundleStatus(agent: AgentBundleAgent): AgentBundleStatus {
  const manifest = readManifest();
  const entry = manifest[agent];
  const hash = currentContentHashForAgent(agent);
  const currentVersion =
    agent === 'claude'
      ? pluginVersion(path.join(claudeSourcePluginDir(), '.claude-plugin', 'plugin.json'))
      : agent === 'cursor'
        ? pluginVersion(path.join(cursorSourcePluginDir(), '.cursor-plugin', 'plugin.json'))
        : agent === 'antigravity'
          ? pluginVersion(path.join(antigravitySourcePluginDir(), 'plugin.json'))
          : BUNDLE_VERSION;

  if (!entry) {
    if (agent === 'claude') {
      return {
        agent,
        status: 'not_installed',
        version: currentVersion,
        installedVersion: null,
        details:
          'Claude plugin migration is required for Overlord v4. Run install to validate the plugin and remove v3.25 connector files.',
        currentContentHash: hash
      };
    }

    // Check if files exist anyway (manual install or pre-manifest)
    let filesExist: boolean;
    if (agent === 'cursor') filesExist = checkCursorFilesExist();
    else if (agent === 'antigravity') filesExist = checkAntigravityFilesExist();
    else filesExist = checkOpenCodeFilesExist();
    if (filesExist) {
      return {
        agent,
        status: 'partial',
        version: currentVersion,
        installedVersion: null,
        details: 'Files found but no manifest entry. Run repair to register.',
        currentContentHash: hash
      };
    }
    return {
      agent,
      status: 'not_installed',
      version: currentVersion,
      installedVersion: null,
      details: 'Bundle not installed.',
      currentContentHash: hash
    };
  }

  if (entry.version !== currentVersion) {
    return {
      agent,
      status: 'stale',
      version: currentVersion,
      installedVersion: entry.version,
      details: `Installed v${entry.version}, current is v${currentVersion ?? 'unknown'}.`,
      currentContentHash: hash
    };
  }

  // Even if the version matches, check if the template content has changed.
  // This catches cases where templates are updated without bumping the version string.
  if (entry.contentHash !== hash) {
    return {
      agent,
      status: 'stale',
      version: currentVersion,
      installedVersion: entry.version,
      details:
        agent === 'claude'
          ? 'Claude plugin content has changed since v4 migration. Update to refresh the launch plugin.'
          : 'Template content has changed since last install. Update to get the latest.',
      currentContentHash: hash
    };
  }

  // Verify files still exist
  const allFilesExist = entry.files.every(f => fs.existsSync(f));
  if (!allFilesExist) {
    return {
      agent,
      status: 'partial',
      version: currentVersion,
      installedVersion: entry.version,
      details:
        agent === 'claude'
          ? 'Some Claude plugin source files are missing. Repair the Overlord desktop installation.'
          : 'Some managed files are missing. Run repair.',
      currentContentHash: hash
    };
  }

  return {
    agent,
    status: 'installed',
    version: currentVersion,
    installedVersion: entry.version,
    details:
      agent === 'claude'
        ? 'Claude v4 plugin is registered as a local marketplace under ~/.claude/plugins so the desktop app and CLI both discover it.'
        : 'Bundle is up to date.',
    currentContentHash: hash
  };
}

export function getAllBundleStatuses(): AgentBundleStatus[] {
  return [
    getAgentBundleStatus('claude'),
    getAgentBundleStatus('cursor'),
    getAgentBundleStatus('antigravity'),
    getAgentBundleStatus('opencode')
  ];
}

function checkOpenCodeFilesExist(): boolean {
  const paths = openCodePaths();
  if (!fs.existsSync(paths.agentsFile)) return false;
  const content = readTextFile(paths.agentsFile);
  return hasOverlordSection(content);
}

function checkCursorFilesExist(): boolean {
  const paths = cursorPaths();
  return fs.existsSync(paths.pluginManifest);
}

// ---------------------------------------------------------------------------
// Claude local marketplace registration
// ---------------------------------------------------------------------------

/**
 * Builds a self-contained local marketplace under ~/.ovld/claude-marketplace so
 * the Claude desktop app (which reads ~/.claude/plugins/{known_marketplaces,
 * installed_plugins}.json at startup) can discover and load the Overlord plugin
 * without needing `claude --plugin-dir`.
 */
function registerClaudeLocalMarketplace(sourceDir: string, version: string): void {
  const paths = claudePaths();

  // 1. Build the marketplace wrapper directory with the plugin inside.
  fs.mkdirSync(path.dirname(paths.marketplacePluginDir), { recursive: true });
  fs.rmSync(paths.marketplacePluginDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, paths.marketplacePluginDir, { recursive: true });

  const marketplaceManifest = {
    name: CLAUDE_MARKETPLACE_NAME,
    owner: { name: 'Cooperativ', email: 'support@ovld.ai' },
    metadata: {
      description: 'Overlord plugin registered locally by the Overlord desktop app.',
      version
    },
    plugins: [
      {
        name: CLAUDE_PLUGIN_NAME,
        source: `./plugins/${CLAUDE_PLUGIN_NAME}`,
        description:
          'Overlord ticket protocol workflow for Claude Code (attach/update/ask/deliver, slash commands, permission hook).',
        version
      }
    ]
  };
  fs.mkdirSync(path.dirname(paths.marketplaceManifest), { recursive: true });
  fs.writeFileSync(paths.marketplaceManifest, JSON.stringify(marketplaceManifest, null, 2) + '\n');

  // 2. Copy the plugin into Claude's versioned cache so /plugin loads it directly.
  const cacheVersionDir = path.join(paths.pluginCacheDir, version);
  fs.mkdirSync(path.dirname(cacheVersionDir), { recursive: true });
  fs.rmSync(cacheVersionDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, cacheVersionDir, { recursive: true });

  // 3. Register the marketplace in known_marketplaces.json (preserving other entries).
  const known = readJsonFile(paths.knownMarketplacesFile);
  const now = new Date().toISOString();
  known[CLAUDE_MARKETPLACE_NAME] = {
    source: {
      source: 'directory',
      path: paths.marketplaceRoot
    },
    installLocation: paths.marketplaceRoot,
    lastUpdated: now
  };
  writeJsonFile(paths.knownMarketplacesFile, known);

  // 4. Register the plugin in installed_plugins.json (preserving other entries).
  const installed = readJsonFile(paths.installedPluginsFile);
  const plugins =
    installed.plugins && typeof installed.plugins === 'object' && !Array.isArray(installed.plugins)
      ? (installed.plugins as Record<string, unknown>)
      : {};
  const key = `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_NAME}`;
  plugins[key] = [
    {
      scope: 'user',
      installPath: cacheVersionDir,
      version,
      installedAt: now,
      lastUpdated: now
    }
  ];
  writeJsonFile(paths.installedPluginsFile, {
    ...installed,
    version: typeof installed.version === 'number' ? installed.version : 2,
    plugins
  });
}

function unregisterClaudeLocalMarketplace(): string[] {
  const paths = claudePaths();
  const removed: string[] = [];

  if (fs.existsSync(paths.knownMarketplacesFile)) {
    const known = readJsonFile(paths.knownMarketplacesFile);
    if (CLAUDE_MARKETPLACE_NAME in known) {
      delete known[CLAUDE_MARKETPLACE_NAME];
      writeJsonFile(paths.knownMarketplacesFile, known);
      removed.push(paths.knownMarketplacesFile);
    }
  }

  if (fs.existsSync(paths.installedPluginsFile)) {
    const installed = readJsonFile(paths.installedPluginsFile);
    const plugins =
      installed.plugins &&
      typeof installed.plugins === 'object' &&
      !Array.isArray(installed.plugins)
        ? (installed.plugins as Record<string, unknown>)
        : null;
    const key = `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_NAME}`;
    if (plugins && key in plugins) {
      delete plugins[key];
      writeJsonFile(paths.installedPluginsFile, { ...installed, plugins });
      removed.push(paths.installedPluginsFile);
    }
  }

  if (fs.existsSync(paths.pluginCacheDir)) {
    fs.rmSync(paths.pluginCacheDir, { recursive: true, force: true });
    removed.push(paths.pluginCacheDir);
  }

  if (fs.existsSync(paths.marketplaceRoot)) {
    fs.rmSync(paths.marketplaceRoot, { recursive: true, force: true });
    removed.push(paths.marketplaceRoot);
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Install: Claude
// ---------------------------------------------------------------------------

function removeLegacyClaudeBundle(): string[] {
  const paths = claudePaths();
  const removed: string[] = [];

  if (fs.existsSync(paths.skillDir)) {
    fs.rmSync(paths.skillDir, { recursive: true, force: true });
    removed.push(paths.skillDir);
  }

  if (fs.existsSync(paths.hookScript)) {
    fs.rmSync(paths.hookScript, { force: true });
    removed.push(paths.hookScript);
  }

  const slashUninstall = uninstallSlashCommands('claude');
  if (slashUninstall.ok) {
    removed.push(...slashUninstall.removedFiles);
  }

  if (fs.existsSync(paths.settingsFile)) {
    const settings = readJsonFile(paths.settingsFile);
    let changed = false;

    if (settings[JSON_MARKER_KEY]) {
      delete settings[JSON_MARKER_KEY];
      changed = true;
    }

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    if (Array.isArray(hooks.PermissionRequest)) {
      const nextPermissionHooks = hooks.PermissionRequest.filter((hook: unknown) => {
        if (hook && typeof hook === 'object' && 'hooks' in hook) {
          const h = hook as { hooks?: Array<{ command?: string }> };
          return !h.hooks?.some(
            inner =>
              typeof inner.command === 'string' &&
              inner.command.includes('overlord-permission-hook')
          );
        }
        return true;
      });
      if (nextPermissionHooks.length !== hooks.PermissionRequest.length) {
        changed = true;
        if (nextPermissionHooks.length > 0) {
          hooks.PermissionRequest = nextPermissionHooks;
        } else {
          delete hooks.PermissionRequest;
        }
      }
    }

    if (changed) {
      if (Object.keys(hooks).length > 0) settings.hooks = hooks;
      else delete settings.hooks;
      writeJsonFile(paths.settingsFile, settings);
      removed.push(paths.settingsFile);
    }
  }

  return removed;
}

function installClaude(): InstallResult {
  const backups: string[] = [];

  try {
    const sourceDir = claudeSourcePluginDir();
    if (!fs.existsSync(path.join(sourceDir, '.claude-plugin', 'plugin.json'))) {
      return {
        ok: false,
        agent: 'claude',
        backups,
        error: `Claude plugin source not found at ${sourceDir}.`
      };
    }

    removeLegacyClaudeBundle();

    const version = pluginVersion(path.join(sourceDir, '.claude-plugin', 'plugin.json')) ?? '0.0.0';

    // Register as a local marketplace so the Claude desktop app discovers the
    // plugin, not just CLI sessions launched with `claude --plugin-dir`.
    registerClaudeLocalMarketplace(sourceDir, version);

    const paths = claudePaths();
    const manifest = readManifest();
    manifest.claude = {
      version,
      contentHash: contentHashForDirectory(sourceDir),
      installedAt: new Date().toISOString(),
      files: [
        ...listFilesRecursive(sourceDir),
        paths.knownMarketplacesFile,
        paths.installedPluginsFile,
        paths.marketplaceManifest
      ]
    };
    writeManifest(manifest);

    return { ok: true, agent: 'claude', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'claude', backups, error: message };
  }
}

function installOpenCode(): InstallResult {
  const paths = openCodePaths();
  const backups: string[] = [];

  try {
    const agentsBackup = backupFile(paths.agentsFile);
    if (agentsBackup) backups.push(agentsBackup);

    const existingAgents = readTextFile(paths.agentsFile);
    const mergedAgents = mergeMarkdownSection(existingAgents, OPENCODE_AGENTS_SECTION);
    writeTextFile(paths.agentsFile, mergedAgents);

    const configBackup = backupFile(paths.configFile);
    if (configBackup) backups.push(configBackup);

    const existingConfig = readJsonFile(paths.configFile);
    const existingInstructions = Array.isArray(existingConfig.instructions)
      ? existingConfig.instructions.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
        )
      : [];
    const existingPermission =
      existingConfig.permission && typeof existingConfig.permission === 'object'
        ? (existingConfig.permission as Record<string, unknown>)
        : {};
    const existingBash =
      existingPermission.bash && typeof existingPermission.bash === 'object'
        ? (existingPermission.bash as Record<string, unknown>)
        : {};

    writeJsonFile(paths.configFile, {
      ...existingConfig,
      $schema: 'https://opencode.ai/config.json',
      instructions: Array.from(new Set([...existingInstructions, paths.agentsFile])),
      permission: {
        ...existingPermission,
        bash: {
          '*': 'ask',
          ...existingBash,
          'ovld protocol *': 'allow'
        }
      }
    });

    const slashResult = installSlashCommands('opencode');
    if (!slashResult.ok) {
      return { ok: false, agent: 'opencode', backups, error: slashResult.error };
    }
    backups.push(...slashResult.backups);

    const manifest = readManifest();
    manifest.opencode = {
      version: BUNDLE_VERSION,
      contentHash: contentHash(OPENCODE_AGENTS_SECTION),
      installedAt: new Date().toISOString(),
      files: [paths.agentsFile, paths.configFile, ...slashResult.managedFiles]
    };
    writeManifest(manifest);

    return { ok: true, agent: 'opencode', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'opencode', backups, error: message };
  }
}

function installCursor(): InstallResult {
  const paths = cursorPaths();
  const backups: string[] = [];

  try {
    const sourceDir = cursorSourcePluginDir();
    fs.mkdirSync(path.dirname(paths.pluginDir), { recursive: true });
    fs.rmSync(paths.pluginDir, { recursive: true, force: true });
    fs.cpSync(sourceDir, paths.pluginDir, { recursive: true });

    // Remove legacy cursor connector files if present.
    if (fs.existsSync(paths.rulesFile)) {
      fs.rmSync(paths.rulesFile, { force: true });
    }
    uninstallSlashCommands('cursor');

    const hooksBackup = backupFile(paths.hooksFile);
    if (hooksBackup) backups.push(hooksBackup);
    mergeCursorBeforeSubmitHook({ hooksFile: paths.hooksFile });

    const settingsBackup = backupFile(paths.settingsFile);
    if (settingsBackup) backups.push(settingsBackup);

    const existingSettings = readJsonFile(paths.settingsFile);
    const permissions =
      existingSettings.permissions && typeof existingSettings.permissions === 'object'
        ? (existingSettings.permissions as Record<string, unknown>)
        : {};
    const mergedAllow = Array.from(
      new Set([...asStringArray(permissions.allow), 'Shell(ovld protocol:*)'])
    );
    writeJsonFile(paths.settingsFile, {
      ...existingSettings,
      permissions: {
        ...permissions,
        allow: mergedAllow
      }
    });

    const manifest = readManifest();
    manifest.cursor = {
      version: pluginVersion(paths.pluginManifest) ?? '0.0.0',
      contentHash: contentHashForDirectory(sourceDir),
      installedAt: new Date().toISOString(),
      files: [...listFilesRecursive(paths.pluginDir), paths.settingsFile, paths.hooksFile]
    };
    writeManifest(manifest);

    return { ok: true, agent: 'cursor', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'cursor', backups, error: message };
  }
}

function installAntigravity(): InstallResult {
  const backups: string[] = [];

  try {
    const sourceDir = antigravitySourcePluginDir();
    if (!fs.existsSync(path.join(sourceDir, 'plugin.json'))) {
      return {
        ok: false,
        agent: 'antigravity',
        backups,
        error: `Antigravity plugin source not found at ${sourceDir}.`
      };
    }

    removeLegacyGeminiConnector();
    const paths = antigravityPaths();
    ensureAntigravityRuntimeScripts(sourceDir);
    runAgyPluginInstall(sourceDir);
    patchAntigravityInstalledPaths({
      mcpScriptPath: paths.runtimeMcp,
      hookScriptPath: paths.runtimeHook
    });

    const policyContent = [
      '# Managed by Overlord onboarding',
      '[[rule]]',
      'toolName = "run_shell_command"',
      'commandPrefix = "ovld protocol"',
      'decision = "allow"',
      'priority = 900',
      ''
    ].join('\n');
    writeTextFile(paths.policyFile, policyContent);

    const installedFiles = [
      paths.policyFile,
      paths.runtimeMcp,
      paths.runtimeHook,
      paths.installedPluginJson,
      paths.installedHooks,
      paths.installedMcp
    ].filter(filePath => fs.existsSync(filePath));

    const manifest = readManifest();
    manifest.antigravity = {
      version: pluginVersion(path.join(sourceDir, 'plugin.json')) ?? '0.0.0',
      contentHash: contentHashForDirectory(sourceDir),
      installedAt: new Date().toISOString(),
      files: installedFiles
    };
    writeManifest(manifest);

    return { ok: true, agent: 'antigravity', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'antigravity', backups, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the Overlord bundle for the specified agent.
 * Idempotent — safe to call multiple times.
 */
export function installAgentBundle(agent: AgentBundleAgent): InstallResult {
  if (agent === 'claude') return installClaude();
  if (agent === 'cursor') return installCursor();
  if (agent === 'antigravity') return installAntigravity();
  return installOpenCode();
}

/**
 * Install bundles for all supported agents.
 */
export function installAllBundles(): InstallResult[] {
  return [
    installAgentBundle('claude'),
    installAgentBundle('cursor'),
    installAgentBundle('antigravity'),
    installAgentBundle('opencode')
  ];
}

/**
 * Repair = reinstall. Same as install but explicitly framed as a repair operation.
 */
export function repairAgentBundle(agent: AgentBundleAgent): InstallResult {
  return installAgentBundle(agent);
}

/**
 * Uninstall the Overlord bundle for a specific agent.
 * Removes only Overlord-owned files/sections, not user content.
 */
export function uninstallAgentBundle(agent: AgentBundleAgent): { ok: boolean; error?: string } {
  try {
    if (agent === 'claude') {
      const paths = claudePaths();
      // Remove the skill directory
      if (fs.existsSync(paths.skillDir)) {
        fs.rmSync(paths.skillDir, { recursive: true });
      }
      // Remove the hook script
      if (fs.existsSync(paths.hookScript)) {
        fs.unlinkSync(paths.hookScript);
      }
      // Remove Overlord entries from settings.json
      if (fs.existsSync(paths.settingsFile)) {
        const settings = readJsonFile(paths.settingsFile);
        // Remove managed marker
        delete settings[JSON_MARKER_KEY];
        // Remove Overlord hooks from PermissionRequest
        const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
        if (Array.isArray(hooks.PermissionRequest)) {
          hooks.PermissionRequest = hooks.PermissionRequest.filter((hook: unknown) => {
            if (hook && typeof hook === 'object' && 'hooks' in hook) {
              const h = hook as { hooks?: Array<{ command?: string }> };
              return !h.hooks?.some(
                inner =>
                  typeof inner.command === 'string' &&
                  inner.command.includes('overlord-permission-hook')
              );
            }
            return true;
          });
          if (hooks.PermissionRequest.length === 0) {
            delete hooks.PermissionRequest;
          }
        }
        if (Object.keys(hooks).length === 0) {
          delete settings.hooks;
        } else {
          settings.hooks = hooks;
        }
        writeJsonFile(paths.settingsFile, settings);
      }

      unregisterClaudeLocalMarketplace();

      const slashUninstall = uninstallSlashCommands('claude');
      if (!slashUninstall.ok) {
        return { ok: false, error: slashUninstall.error };
      }
    } else if (agent === 'cursor') {
      const paths = cursorPaths();
      if (fs.existsSync(paths.pluginDir)) {
        fs.rmSync(paths.pluginDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.rulesFile)) {
        fs.rmSync(paths.rulesFile, { force: true });
      }
      removeCursorBeforeSubmitHook({ hooksFile: paths.hooksFile });

      const slashUninstall = uninstallSlashCommands('cursor');
      if (!slashUninstall.ok) {
        return { ok: false, error: slashUninstall.error };
      }
    } else if (agent === 'opencode') {
      const paths = openCodePaths();
      if (fs.existsSync(paths.agentsFile)) {
        const existing = readTextFile(paths.agentsFile);
        const startIdx = existing.indexOf('<!-- overlord:managed:start -->');
        const endIdx = existing.indexOf('<!-- overlord:managed:end -->');
        if (startIdx !== -1 && endIdx !== -1) {
          const before = existing.slice(0, startIdx).trimEnd();
          const after = existing.slice(endIdx + '<!-- overlord:managed:end -->'.length).trimStart();
          const cleaned = before + (before && after ? '\n\n' : '') + after;
          if (cleaned.trim()) {
            writeTextFile(paths.agentsFile, cleaned.trim() + '\n');
          } else {
            fs.unlinkSync(paths.agentsFile);
          }
        }
      }

      if (fs.existsSync(paths.configFile)) {
        const config = readJsonFile(paths.configFile);
        const instructions = Array.isArray(config.instructions)
          ? config.instructions.filter(
              (entry: unknown) => typeof entry === 'string' && entry !== paths.agentsFile
            )
          : [];
        const permission =
          config.permission && typeof config.permission === 'object'
            ? (config.permission as Record<string, unknown>)
            : {};
        const bash =
          permission.bash && typeof permission.bash === 'object'
            ? { ...(permission.bash as Record<string, unknown>) }
            : null;

        if (bash) {
          delete bash['ovld protocol *'];
        }

        const nextConfig: Record<string, unknown> = { ...config };
        if (instructions.length > 0) {
          nextConfig.instructions = instructions;
        } else {
          delete nextConfig.instructions;
        }

        if (bash && Object.keys(bash).length > 0) {
          nextConfig.permission = { ...permission, bash };
        } else if (Object.keys(permission).length > 0) {
          const nextPermission = { ...permission };
          delete nextPermission.bash;
          if (Object.keys(nextPermission).length > 0) {
            nextConfig.permission = nextPermission;
          } else {
            delete nextConfig.permission;
          }
        } else {
          delete nextConfig.permission;
        }

        writeJsonFile(paths.configFile, nextConfig);
      }

      const slashUninstall = uninstallSlashCommands('opencode');
      if (!slashUninstall.ok) {
        return { ok: false, error: slashUninstall.error };
      }
    } else if (agent === 'antigravity') {
      const paths = antigravityPaths();
      if (fs.existsSync(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR)) {
        fs.rmSync(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, { recursive: true, force: true });
      }
      if (fs.existsSync(ANTIGRAVITY_INSTALLED_PLUGINS_DIR)) {
        fs.rmSync(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.policyFile)) {
        const existing = readTextFile(paths.policyFile);
        if (existing.includes('commandPrefix = "ovld protocol"')) {
          fs.rmSync(paths.policyFile, { force: true });
        }
      }
      removeLegacyGeminiConnector();
    }

    // Remove from manifest
    const manifest = readManifest();
    delete manifest[agent];
    writeManifest(manifest);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Check if the bundle is installed and up to date for the given agent.
 */
export function isBundleInstalled(agent: AgentBundleAgent): boolean {
  const status = getAgentBundleStatus(agent);
  return status.status === 'installed';
}
