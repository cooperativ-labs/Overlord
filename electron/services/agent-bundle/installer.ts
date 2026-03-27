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

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  backupFile,
  hasOverlordSection,
  mergeJsonSettings,
  mergeMarkdownSection,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile
} from './merge-helpers';
import { installSlashCommands, uninstallSlashCommands } from './slash-commands';
import {
  BUNDLE_VERSION,
  CLAUDE_SKILL_CONTENT,
  CURSOR_RULES_CONTENT,
  JSON_MARKER_KEY,
  OPENCODE_AGENTS_SECTION,
  PERMISSION_HOOK_SCRIPT
} from './templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentBundleAgent = 'claude' | 'cursor' | 'opencode';

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
  opencode?: ManifestEntry;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MANIFEST_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'bundle-manifest.json');

function claudePaths() {
  const base = path.join(os.homedir(), '.claude');
  return {
    skillDir: path.join(base, 'skills', 'overlord-local'),
    skillFile: path.join(base, 'skills', 'overlord-local', 'SKILL.md'),
    settingsFile: path.join(base, 'settings.json'),
    hookScript: path.join(base, 'overlord-permission-hook.sh')
  };
}

function openCodePaths() {
  const base = path.join(os.homedir(), '.config', 'opencode');
  return {
    agentsFile: path.join(base, 'AGENTS.md'),
    configFile: path.join(base, 'opencode.json')
  };
}

function cursorPaths() {
  const base = path.join(os.homedir(), '.cursor');
  return {
    rulesDir: path.join(base, 'rules'),
    rulesFile: path.join(base, 'rules', 'overlord-local.mdc')
  };
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Returns the content hash for the current (bundled) template of a given agent. */
function currentContentHashForAgent(agent: AgentBundleAgent): string {
  if (agent === 'claude') return contentHash(CLAUDE_SKILL_CONTENT);
  if (agent === 'cursor') return contentHash(CURSOR_RULES_CONTENT);
  return contentHash(OPENCODE_AGENTS_SECTION);
}

export function getAgentBundleStatus(agent: AgentBundleAgent): AgentBundleStatus {
  const manifest = readManifest();
  const entry = manifest[agent];
  const hash = currentContentHashForAgent(agent);

  if (!entry) {
    // Check if files exist anyway (manual install or pre-manifest)
    let filesExist: boolean;
    if (agent === 'claude') filesExist = checkClaudeFilesExist();
    else if (agent === 'cursor') filesExist = checkCursorFilesExist();
    else filesExist = checkOpenCodeFilesExist();
    if (filesExist) {
      return {
        agent,
        status: 'partial',
        version: BUNDLE_VERSION,
        installedVersion: null,
        details: 'Files found but no manifest entry. Run repair to register.',
        currentContentHash: hash
      };
    }
    return {
      agent,
      status: 'not_installed',
      version: BUNDLE_VERSION,
      installedVersion: null,
      details: 'Bundle not installed.',
      currentContentHash: hash
    };
  }

  if (entry.version !== BUNDLE_VERSION) {
    return {
      agent,
      status: 'stale',
      version: BUNDLE_VERSION,
      installedVersion: entry.version,
      details: `Installed v${entry.version}, current is v${BUNDLE_VERSION}.`,
      currentContentHash: hash
    };
  }

  // Even if the version matches, check if the template content has changed.
  // This catches cases where templates are updated without bumping the version string.
  if (entry.contentHash !== hash) {
    return {
      agent,
      status: 'stale',
      version: BUNDLE_VERSION,
      installedVersion: entry.version,
      details: 'Template content has changed since last install. Update to get the latest.',
      currentContentHash: hash
    };
  }

  // Verify files still exist
  const allFilesExist = entry.files.every(f => fs.existsSync(f));
  if (!allFilesExist) {
    return {
      agent,
      status: 'partial',
      version: BUNDLE_VERSION,
      installedVersion: entry.version,
      details: 'Some managed files are missing. Run repair.',
      currentContentHash: hash
    };
  }

  return {
    agent,
    status: 'installed',
    version: BUNDLE_VERSION,
    installedVersion: entry.version,
    details: 'Bundle is up to date.',
    currentContentHash: hash
  };
}

export function getAllBundleStatuses(): AgentBundleStatus[] {
  return [
    getAgentBundleStatus('claude'),
    getAgentBundleStatus('cursor'),
    getAgentBundleStatus('opencode')
  ];
}

function checkClaudeFilesExist(): boolean {
  const paths = claudePaths();
  return fs.existsSync(paths.skillFile);
}

function checkOpenCodeFilesExist(): boolean {
  const paths = openCodePaths();
  if (!fs.existsSync(paths.agentsFile)) return false;
  const content = readTextFile(paths.agentsFile);
  return hasOverlordSection(content);
}

function checkCursorFilesExist(): boolean {
  const paths = cursorPaths();
  return fs.existsSync(paths.rulesFile);
}

// ---------------------------------------------------------------------------
// Install: Claude
// ---------------------------------------------------------------------------

function installClaude(): InstallResult {
  const paths = claudePaths();
  const backups: string[] = [];

  try {
    // 1. Install the skill file
    writeTextFile(paths.skillFile, CLAUDE_SKILL_CONTENT);

    // 2. Install the permission hook script
    writeTextFile(paths.hookScript, PERMISSION_HOOK_SCRIPT, 0o755);

    // 3. Merge hook into settings.json
    const backup = backupFile(paths.settingsFile);
    if (backup) backups.push(backup);

    const existingSettings = readJsonFile(paths.settingsFile);

    // Build the hook entry pointing to our durable script
    const overlordHook = {
      matcher: '.*',
      hooks: [{ type: 'command', command: paths.hookScript }]
    };

    // Check if an Overlord hook already exists in PermissionRequest
    const existingHooks = (existingSettings.hooks ?? {}) as Record<string, unknown[]>;
    const existingPermHooks = Array.isArray(existingHooks.PermissionRequest)
      ? existingHooks.PermissionRequest
      : [];

    // Remove any existing Overlord hooks (ones pointing to our managed script)
    const filteredPermHooks = existingPermHooks.filter((hook: unknown) => {
      if (hook && typeof hook === 'object' && 'hooks' in hook) {
        const h = hook as { hooks?: Array<{ command?: string }> };
        return !h.hooks?.some(
          inner =>
            typeof inner.command === 'string' && inner.command.includes('overlord-permission-hook')
        );
      }
      return true;
    });

    // Merge permission allow rules for ovld protocol commands
    const existingPermissions =
      existingSettings.permissions && typeof existingSettings.permissions === 'object'
        ? (existingSettings.permissions as Record<string, unknown>)
        : {};
    const existingAllow = Array.isArray(existingPermissions.allow)
      ? existingPermissions.allow.filter((e: unknown): e is string => typeof e === 'string')
      : [];
    const requiredPerms = ['Bash(ovld protocol:*)', 'Bash(curl -sS -X POST:*)'];
    const mergedAllow = Array.from(new Set([...existingAllow, ...requiredPerms]));

    const hookAdditions = {
      hooks: {
        PermissionRequest: [...filteredPermHooks, overlordHook]
      },
      permissions: {
        ...existingPermissions,
        allow: mergedAllow
      }
    };

    const merged = mergeJsonSettings(existingSettings, hookAdditions, [
      'hooks.PermissionRequest',
      'permissions.allow'
    ]);
    writeJsonFile(paths.settingsFile, merged);

    // 4. Install Claude slash commands alongside the durable bundle.
    const slashResult = installSlashCommands('claude');
    if (!slashResult.ok) {
      return { ok: false, agent: 'claude', backups, error: slashResult.error };
    }
    backups.push(...slashResult.backups);

    // 5. Update manifest
    const manifest = readManifest();
    manifest.claude = {
      version: BUNDLE_VERSION,
      contentHash: contentHash(CLAUDE_SKILL_CONTENT),
      installedAt: new Date().toISOString(),
      files: [paths.skillFile, paths.hookScript, paths.settingsFile, ...slashResult.managedFiles]
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
          'ovld protocol *': 'allow',
          'curl -sS -X POST *': 'allow',
          'curl -s -X POST *': 'allow'
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
    // 1. Install the rules file
    writeTextFile(paths.rulesFile, CURSOR_RULES_CONTENT);

    // 2. Install Cursor slash commands alongside the durable bundle.
    const slashResult = installSlashCommands('cursor');
    if (!slashResult.ok) {
      return { ok: false, agent: 'cursor', backups, error: slashResult.error };
    }
    backups.push(...slashResult.backups);

    // 3. Update manifest
    const manifest = readManifest();
    manifest.cursor = {
      version: BUNDLE_VERSION,
      contentHash: contentHash(CURSOR_RULES_CONTENT),
      installedAt: new Date().toISOString(),
      files: [paths.rulesFile, ...slashResult.managedFiles]
    };
    writeManifest(manifest);

    return { ok: true, agent: 'cursor', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'cursor', backups, error: message };
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
  return installOpenCode();
}

/**
 * Install bundles for all supported agents.
 */
export function installAllBundles(): InstallResult[] {
  return [
    installAgentBundle('claude'),
    installAgentBundle('cursor'),
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

      const slashUninstall = uninstallSlashCommands('claude');
      if (!slashUninstall.ok) {
        return { ok: false, error: slashUninstall.error };
      }
    } else if (agent === 'cursor') {
      const paths = cursorPaths();
      if (fs.existsSync(paths.rulesFile)) {
        fs.unlinkSync(paths.rulesFile);
      }

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
          delete bash['curl -sS -X POST *'];
          delete bash['curl -s -X POST *'];
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
