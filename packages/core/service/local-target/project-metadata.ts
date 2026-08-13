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

export const PROJECT_JSON_VERSION = 3;

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

export interface ProjectJsonProjectEntry {
  projectId: string;
  projectName?: string;
  resourceId: string;
  resourceKey?: string;
  resourceIdsByExecutionTarget?: Record<string, string>;
  isPrimary: boolean;
  linkedAt: string;
}

export interface ProjectJsonContents {
  _warning: string;
  version: number;
  projectId: string;
  projectName?: string;
  resourceId: string;
  resourceKey?: string;
  resourceIdsByExecutionTarget?: Record<string, string>;
  isPrimary: boolean;
  linkedAt: string;
  projects: ProjectJsonProjectEntry[];
}

export interface ReadProjectJsonOptions {
  preferredExecutionTargetId?: string | null;
  preferredProjectId?: string | null;
}

export interface ProjectJsonLink {
  projectId: string;
  projectName: string | null;
  resourceId: string;
  resourceKey: string | null;
  resourceIdsByExecutionTarget: Record<string, string>;
  isPrimary: boolean;
  linkedAt: string;
}

function parseResourceIdsByExecutionTarget(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' &&
        entry[0].trim().length > 0 &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0
    )
  );
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseProjectEntry(value: unknown): ProjectJsonProjectEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.projectId !== 'string' || typeof record.resourceId !== 'string') return null;

  const resourceKey = parseOptionalTrimmedString(record.resourceKey);
  const projectName = parseOptionalTrimmedString(record.projectName);
  const resourceIdsByExecutionTarget = parseResourceIdsByExecutionTarget(
    record.resourceIdsByExecutionTarget
  );

  return {
    projectId: record.projectId,
    ...(projectName ? { projectName } : {}),
    resourceId: record.resourceId,
    ...(resourceKey ? { resourceKey } : {}),
    ...(Object.keys(resourceIdsByExecutionTarget).length > 0
      ? { resourceIdsByExecutionTarget }
      : {}),
    isPrimary: record.isPrimary === true,
    linkedAt: typeof record.linkedAt === 'string' ? record.linkedAt : nowIso()
  };
}

function latestLinkedAt(entries: ProjectJsonProjectEntry[]): ProjectJsonProjectEntry {
  return [...entries].sort((left, right) => right.linkedAt.localeCompare(left.linkedAt))[0]!;
}

export function selectPrimaryProjectEntry(
  projects: ProjectJsonProjectEntry[]
): ProjectJsonProjectEntry | null {
  if (projects.length === 0) return null;
  const primaries = projects.filter(entry => entry.isPrimary);
  if (primaries.length === 1) return primaries[0]!;
  if (primaries.length > 1) return latestLinkedAt(primaries);
  if (projects.length === 1) return projects[0]!;
  return latestLinkedAt(projects);
}

function parseProjectJson(projectJsonPath: string): ProjectJsonContents | null {
  if (!existsSync(projectJsonPath)) return null;
  const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>;

  const fromArray = Array.isArray(parsed.projects)
    ? parsed.projects
        .map(entry => parseProjectEntry(entry))
        .filter((entry): entry is ProjectJsonProjectEntry => entry !== null)
    : [];
  const fromTopLevel = parseProjectEntry(parsed);
  const projects = fromArray.length > 0 ? fromArray : fromTopLevel ? [fromTopLevel] : [];
  const primary = selectPrimaryProjectEntry(projects);
  if (!primary) return null;

  const resourceIdsByExecutionTarget = primary.resourceIdsByExecutionTarget ?? {};

  return {
    _warning: typeof parsed._warning === 'string' ? parsed._warning : PROJECT_JSON_WARNING,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    projectId: primary.projectId,
    ...(primary.projectName ? { projectName: primary.projectName } : {}),
    resourceId: primary.resourceId,
    ...(primary.resourceKey ? { resourceKey: primary.resourceKey } : {}),
    resourceIdsByExecutionTarget,
    isPrimary: primary.isPrimary,
    linkedAt: primary.linkedAt,
    projects
  };
}

function toProjectJsonLink({
  entry,
  preferredExecutionTargetId
}: {
  entry: ProjectJsonProjectEntry;
  preferredExecutionTargetId?: string | null;
}): ProjectJsonLink {
  const preferredResourceId =
    preferredExecutionTargetId?.trim() &&
    entry.resourceIdsByExecutionTarget?.[preferredExecutionTargetId.trim()];

  return {
    projectId: entry.projectId,
    projectName: entry.projectName ?? null,
    resourceId: preferredResourceId ?? entry.resourceId,
    resourceKey: entry.resourceKey ?? null,
    resourceIdsByExecutionTarget: entry.resourceIdsByExecutionTarget ?? {},
    isPrimary: entry.isPrimary,
    linkedAt: entry.linkedAt
  };
}

export function readProjectJsonLinks(
  projectJsonPath: string,
  options: ReadProjectJsonOptions = {}
): ProjectJsonLink[] {
  const parsed = parseProjectJson(projectJsonPath);
  if (!parsed) return [];
  return parsed.projects.map(entry =>
    toProjectJsonLink({
      entry,
      preferredExecutionTargetId: options.preferredExecutionTargetId
    })
  );
}

export function selectPrimaryProjectLink(links: ProjectJsonLink[]): ProjectJsonLink | null {
  if (links.length === 0) return null;
  const primaries = links.filter(link => link.isPrimary);
  if (primaries.length === 1) return primaries[0]!;
  if (primaries.length > 1) {
    return [...primaries].sort((left, right) => right.linkedAt.localeCompare(left.linkedAt))[0]!;
  }
  if (links.length === 1) return links[0]!;
  return [...links].sort((left, right) => right.linkedAt.localeCompare(left.linkedAt))[0]!;
}

export function readProjectJsonLink(
  projectJsonPath: string,
  options: ReadProjectJsonOptions = {}
): ProjectJsonLink | null {
  const links = readProjectJsonLinks(projectJsonPath, options);
  const preferredProjectId = options.preferredProjectId?.trim() || null;
  if (preferredProjectId) {
    return links.find(link => link.projectId === preferredProjectId) ?? null;
  }
  return selectPrimaryProjectLink(links);
}

function serializeProjectEntry(entry: ProjectJsonProjectEntry): ProjectJsonProjectEntry {
  return {
    projectId: entry.projectId,
    ...(entry.projectName ? { projectName: entry.projectName } : {}),
    resourceId: entry.resourceId,
    ...(entry.resourceKey ? { resourceKey: entry.resourceKey } : {}),
    ...(entry.resourceIdsByExecutionTarget &&
    Object.keys(entry.resourceIdsByExecutionTarget).length > 0
      ? { resourceIdsByExecutionTarget: entry.resourceIdsByExecutionTarget }
      : {}),
    isPrimary: entry.isPrimary,
    linkedAt: entry.linkedAt
  };
}

/**
 * Write `<directoryPath>/.overlord/project.json` (creating the `.overlord`
 * scratch dirs), returning the absolute path written.
 *
 * Linking a second project merges into `projects` rather than replacing the
 * file. A write with `isPrimary: true` demotes every other entry so at most
 * one project remains primary (the most recently promoted one).
 */
export function writeProjectJson({
  directoryPath,
  projectId,
  projectName,
  resourceId,
  resourceKey,
  executionTargetId,
  isPrimary
}: {
  directoryPath: string;
  projectId: string;
  projectName?: string | null;
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
  const existing = parseProjectJson(projectJsonPath);
  const existingProjects = existing?.projects ?? [];
  const existingEntry = existingProjects.find(entry => entry.projectId === projectId);

  const resourceIdsByExecutionTarget = {
    ...(existingEntry?.resourceIdsByExecutionTarget ?? {})
  };
  if (executionTargetId?.trim()) {
    resourceIdsByExecutionTarget[executionTargetId.trim()] = resourceId;
  }

  const resolvedProjectName = parseOptionalTrimmedString(projectName) ?? existingEntry?.projectName;
  const resolvedResourceKey = parseOptionalTrimmedString(resourceKey) ?? existingEntry?.resourceKey;

  const nextEntry = serializeProjectEntry({
    projectId,
    ...(resolvedProjectName ? { projectName: resolvedProjectName } : {}),
    resourceId,
    ...(resolvedResourceKey ? { resourceKey: resolvedResourceKey } : {}),
    ...(Object.keys(resourceIdsByExecutionTarget).length > 0
      ? { resourceIdsByExecutionTarget }
      : {}),
    isPrimary,
    linkedAt: nowIso()
  });

  const projects = [
    ...existingProjects
      .filter(entry => entry.projectId !== projectId)
      .map(entry => (isPrimary ? serializeProjectEntry({ ...entry, isPrimary: false }) : entry)),
    nextEntry
  ];

  const primary = selectPrimaryProjectEntry(projects) ?? nextEntry;
  const primaryResourceIds = primary.resourceIdsByExecutionTarget ?? {};

  writeFileSync(
    projectJsonPath,
    `${JSON.stringify(
      {
        _warning: PROJECT_JSON_WARNING,
        version: PROJECT_JSON_VERSION,
        projectId: primary.projectId,
        ...(primary.projectName ? { projectName: primary.projectName } : {}),
        resourceId: primary.resourceId,
        ...(primary.resourceKey ? { resourceKey: primary.resourceKey } : {}),
        ...(Object.keys(primaryResourceIds).length > 0
          ? { resourceIdsByExecutionTarget: primaryResourceIds }
          : {}),
        isPrimary: primary.isPrimary,
        linkedAt: primary.linkedAt,
        projects
      } satisfies ProjectJsonContents,
      null,
      2
    )}\n`
  );
  return projectJsonPath;
}
