// The `writeProjectMetadata` capability's implementation: write a linked
// checkout's `.overlord/project.json` on the machine that owns the checkout.
//
// This lives in the local-target module (not projects.ts) so the in-process
// provider can wrap it without a cycle — projects.ts depends on the local-target
// module, never the other way around. The hosted backend must NOT write this to
// its own filesystem; routing through a provider
// makes that automatic — only a co-located in-process provider writes.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { nowIso } from '../util.js';

export const PROJECT_JSON_VERSION = 2;

const PROJECT_JSON_WARNING =
  'STRICTLY PROTECTED: This file is managed exclusively by Overlord. Agents and users must not edit, replace, stage, commit, or delete it. Re-link the resource with Overlord to change it.';
const INSTRUCTION_BLOCK_START = '<!-- OVERLORD PROJECT METADATA PROTECTION: START -->';
const INSTRUCTION_BLOCK_END = '<!-- OVERLORD PROJECT METADATA PROTECTION: END -->';
const PROJECT_METADATA_INSTRUCTION = `${INSTRUCTION_BLOCK_START}
## Overlord project metadata — do not edit

\`.overlord/project.json\` is exclusively managed by Overlord. Do not edit,
replace, stage, commit, delete, or revert it. If its link metadata needs to
change, use Overlord's resource-linking command instead.
${INSTRUCTION_BLOCK_END}`;
function writeIfChanged(filePath: string, content: string): void {
  if (!existsSync(filePath) || readFileSync(filePath, 'utf8') !== content) {
    writeFileSync(filePath, content);
  }
}

function replaceManagedBlock(content: string, block: string): string {
  const blockPattern = new RegExp(
    `${INSTRUCTION_BLOCK_START}[\\s\\S]*?${INSTRUCTION_BLOCK_END}\\n?`,
    'g'
  );
  const withoutExisting = content.replace(blockPattern, '').trimEnd();
  return `${withoutExisting}${withoutExisting ? '\n\n' : ''}${block}\n`;
}

function ensureAgentInstructions(checkoutPath: string): void {
  for (const filename of ['AGENTS.md', 'CLAUDE.md']) {
    const instructionPath = path.join(checkoutPath, filename);
    const existing = existsSync(instructionPath) ? readFileSync(instructionPath, 'utf8') : '';
    writeIfChanged(instructionPath, replaceManagedBlock(existing, PROJECT_METADATA_INSTRUCTION));
  }
}

function ensureGitignore(checkoutPath: string): void {
  const gitignorePath = path.join(checkoutPath, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const existingPatterns = new Set(
    existing
      .split(/\r?\n/)
      .map(line => line.trim().replace(/^\//, ''))
      .filter(Boolean)
  );
  const additions = ['.overlord/tmp/', '.overlord/logs/'].filter(
    pattern => !existingPatterns.has(pattern)
  );
  if (additions.length === 0) return;

  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${existing}${separator}${additions.join('\n')}\n`);
}

function resolveGitRoot(directoryPath: string): string | null {
  try {
    return execFileSync('git', ['-C', directoryPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function protectProjectMetadata(directoryPath: string): void {
  const gitRoot = resolveGitRoot(directoryPath);
  const checkoutPath = gitRoot ?? directoryPath;
  ensureAgentInstructions(checkoutPath);
  ensureGitignore(checkoutPath);
}

export interface ProjectJsonContents {
  _warning: string;
  version: number;
  projectId: string;
  resourceId: string;
  resourceKey?: string;
  resourceIdsByExecutionTarget?: Record<string, string>;
  isPrimary: boolean;
  linkedAt: string;
}

export interface ReadProjectJsonOptions {
  preferredExecutionTargetId?: string | null;
}

export interface ProjectJsonLink {
  projectId: string;
  resourceId: string;
  resourceKey: string | null;
  resourceIdsByExecutionTarget: Record<string, string>;
  isPrimary: boolean;
}

function parseProjectJson(projectJsonPath: string): ProjectJsonContents | null {
  if (!existsSync(projectJsonPath)) return null;
  const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
    _warning?: unknown;
    version?: unknown;
    projectId?: unknown;
    resourceId?: unknown;
    resourceKey?: unknown;
    resourceIdsByExecutionTarget?: unknown;
    isPrimary?: unknown;
    linkedAt?: unknown;
  };
  if (typeof parsed.projectId !== 'string' || typeof parsed.resourceId !== 'string') return null;

  const resourceIdsByExecutionTarget =
    parsed.resourceIdsByExecutionTarget &&
    typeof parsed.resourceIdsByExecutionTarget === 'object' &&
    !Array.isArray(parsed.resourceIdsByExecutionTarget)
      ? Object.fromEntries(
          Object.entries(parsed.resourceIdsByExecutionTarget).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === 'string' &&
              entry[0].trim().length > 0 &&
              typeof entry[1] === 'string' &&
              entry[1].trim().length > 0
          )
        )
      : {};

  const resourceKey =
    typeof parsed.resourceKey === 'string' && parsed.resourceKey.trim().length > 0
      ? parsed.resourceKey.trim()
      : undefined;

  return {
    _warning: typeof parsed._warning === 'string' ? parsed._warning : PROJECT_JSON_WARNING,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    projectId: parsed.projectId,
    resourceId: parsed.resourceId,
    ...(resourceKey ? { resourceKey } : {}),
    resourceIdsByExecutionTarget,
    isPrimary: parsed.isPrimary === true,
    linkedAt: typeof parsed.linkedAt === 'string' ? parsed.linkedAt : nowIso()
  };
}

export function readProjectJsonLink(
  projectJsonPath: string,
  options: ReadProjectJsonOptions = {}
): ProjectJsonLink | null {
  const parsed = parseProjectJson(projectJsonPath);
  if (!parsed) return null;

  const preferredExecutionTargetId = options.preferredExecutionTargetId?.trim() || null;
  const preferredResourceId =
    preferredExecutionTargetId && parsed.resourceIdsByExecutionTarget?.[preferredExecutionTargetId];

  return {
    projectId: parsed.projectId,
    resourceId: preferredResourceId ?? parsed.resourceId,
    resourceKey: parsed.resourceKey ?? null,
    resourceIdsByExecutionTarget: parsed.resourceIdsByExecutionTarget ?? {},
    isPrimary: parsed.isPrimary
  };
}

/**
 * Write `<directoryPath>/.overlord/project.json` (creating the `.overlord`
 * scratch dirs), returning the absolute path written.
 */
export function writeProjectJson({
  directoryPath,
  projectId,
  resourceId,
  resourceKey,
  executionTargetId,
  isPrimary
}: {
  directoryPath: string;
  projectId: string;
  resourceId: string;
  resourceKey?: string | null;
  executionTargetId?: string | null;
  isPrimary: boolean;
}): string {
  const overlordDir = path.join(directoryPath, '.overlord');
  mkdirSync(overlordDir, { recursive: true });
  mkdirSync(path.join(overlordDir, 'tmp'), { recursive: true });
  mkdirSync(path.join(overlordDir, 'logs'), { recursive: true });
  protectProjectMetadata(directoryPath);

  const projectJsonPath = path.join(overlordDir, 'project.json');
  const existing = readProjectJsonLink(projectJsonPath);
  const resourceIdsByExecutionTarget = {
    ...(existing?.projectId === projectId ? existing.resourceIdsByExecutionTarget : {})
  };
  if (executionTargetId?.trim()) {
    resourceIdsByExecutionTarget[executionTargetId.trim()] = resourceId;
  }
  writeFileSync(
    projectJsonPath,
    `${JSON.stringify(
      {
        _warning: PROJECT_JSON_WARNING,
        version: PROJECT_JSON_VERSION,
        projectId,
        resourceId,
        ...(resourceKey?.trim() ? { resourceKey: resourceKey.trim() } : {}),
        ...(Object.keys(resourceIdsByExecutionTarget).length > 0
          ? { resourceIdsByExecutionTarget }
          : {}),
        isPrimary,
        linkedAt: nowIso()
      } satisfies ProjectJsonContents,
      null,
      2
    )}\n`
  );
  return projectJsonPath;
}
