/**
 * Agent bundle installer — installs and manages durable Overlord workflow
 * configuration for Claude Code and Codex.
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
  CODEX_AGENTS_SECTION,
  JSON_MARKER_KEY,
  PERMISSION_HOOK_SCRIPT
} from './templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentBundleAgent = 'claude' | 'codex';

export type BundleStatus = 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';

export type AgentBundleStatus = {
  agent: AgentBundleAgent;
  status: BundleStatus;
  version: string | null;
  installedVersion: string | null;
  details: string;
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
  codex?: ManifestEntry;
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

function codexPaths() {
  const base = path.join(os.homedir(), '.codex');
  return {
    agentsFile: path.join(base, 'AGENTS.md')
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

export function getAgentBundleStatus(agent: AgentBundleAgent): AgentBundleStatus {
  const manifest = readManifest();
  const entry = manifest[agent];

  if (!entry) {
    // Check if files exist anyway (manual install or pre-manifest)
    const filesExist = agent === 'claude' ? checkClaudeFilesExist() : checkCodexFilesExist();
    if (filesExist) {
      return {
        agent,
        status: 'partial',
        version: BUNDLE_VERSION,
        installedVersion: null,
        details: 'Files found but no manifest entry. Run repair to register.'
      };
    }
    return {
      agent,
      status: 'not_installed',
      version: BUNDLE_VERSION,
      installedVersion: null,
      details: 'Bundle not installed.'
    };
  }

  if (entry.version !== BUNDLE_VERSION) {
    return {
      agent,
      status: 'stale',
      version: BUNDLE_VERSION,
      installedVersion: entry.version,
      details: `Installed v${entry.version}, current is v${BUNDLE_VERSION}.`
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
      details: 'Some managed files are missing. Run repair.'
    };
  }

  return {
    agent,
    status: 'installed',
    version: BUNDLE_VERSION,
    installedVersion: entry.version,
    details: 'Bundle is up to date.'
  };
}

export function getAllBundleStatuses(): AgentBundleStatus[] {
  return [getAgentBundleStatus('claude'), getAgentBundleStatus('codex')];
}

function checkClaudeFilesExist(): boolean {
  const paths = claudePaths();
  return fs.existsSync(paths.skillFile);
}

function checkCodexFilesExist(): boolean {
  const paths = codexPaths();
  if (!fs.existsSync(paths.agentsFile)) return false;
  const content = readTextFile(paths.agentsFile);
  return hasOverlordSection(content);
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

    const hookAdditions = {
      hooks: {
        PermissionRequest: [...filteredPermHooks, overlordHook]
      }
    };

    const merged = mergeJsonSettings(existingSettings, hookAdditions, ['hooks.PermissionRequest']);
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

// ---------------------------------------------------------------------------
// Install: Codex
// ---------------------------------------------------------------------------

function installCodex(): InstallResult {
  const paths = codexPaths();
  const backups: string[] = [];

  try {
    // 1. Backup existing AGENTS.md if it exists
    const backup = backupFile(paths.agentsFile);
    if (backup) backups.push(backup);

    // 2. Merge Overlord section into AGENTS.md
    const existing = readTextFile(paths.agentsFile);
    const merged = mergeMarkdownSection(existing, CODEX_AGENTS_SECTION);
    writeTextFile(paths.agentsFile, merged);

    // 3. Update manifest
    const manifest = readManifest();
    manifest.codex = {
      version: BUNDLE_VERSION,
      contentHash: contentHash(CODEX_AGENTS_SECTION),
      installedAt: new Date().toISOString(),
      files: [paths.agentsFile]
    };
    writeManifest(manifest);

    return { ok: true, agent: 'codex', backups };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: 'codex', backups, error: message };
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
  if (agent === 'codex') return installCodex();
  return { ok: false, agent, backups: [], error: `Unknown agent: ${agent}` };
}

/**
 * Install bundles for all supported agents.
 */
export function installAllBundles(): InstallResult[] {
  return [installAgentBundle('claude'), installAgentBundle('codex')];
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
    } else if (agent === 'codex') {
      const paths = codexPaths();
      // Remove Overlord section from AGENTS.md
      if (fs.existsSync(paths.agentsFile)) {
        const existing = readTextFile(paths.agentsFile);
        // Remove the managed section including markers
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
