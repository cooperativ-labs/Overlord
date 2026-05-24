/**
 * Read/merge/write logic for the per-folder `.overlord/project.json` file.
 *
 * This file lives under the `.overlord` folder of any directory registered as a project resource
 * and tells Overlord (and any AI agent reading the folder) which project(s) the
 * folder is associated with. The `_comment` field doubles as a human-readable
 * notice since JSON has no real comment syntax.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const OVERLORD_CONFIG_DIRNAME = '.overlord';
export const OVERLORD_CONFIG_FILENAME = 'project.json';
export const OVERLORD_SCRATCH_DIRNAME = 'tmp';
export const OVERLORD_LOG_DIRNAME = 'logs';

const FILE_COMMENT =
  'This file lets Overlord (https://www.ovld.ai) identify which project this folder belongs to. It is created automatically when the folder is added as a project resource. DO NOT EDIT MANUALLY.';
const GITIGNORE_ENTRIES = ['.overlord/tmp/', '.overlord/logs/'];

export type OverlordConfigProject = {
  id: string;
  name: string;
};

export type OverlordConfigFile = {
  _comment: string;
  projects: OverlordConfigProject[];
};

export type UpsertResult = {
  filePath: string;
  action: 'created' | 'added-project' | 'unchanged';
};

export type RemoveResult = {
  filePath: string;
  action: 'removed-project' | 'deleted-file' | 'not-found' | 'unchanged';
};

function buildConfig(projects: OverlordConfigProject[]): OverlordConfigFile {
  return { _comment: FILE_COMMENT, projects };
}

function configDirPath(directoryPath: string): string {
  return path.join(directoryPath, OVERLORD_CONFIG_DIRNAME);
}

function configFilePath(directoryPath: string): string {
  return path.join(configDirPath(directoryPath), OVERLORD_CONFIG_FILENAME);
}

function scratchDirPath(directoryPath: string): string {
  return path.join(configDirPath(directoryPath), OVERLORD_SCRATCH_DIRNAME);
}

async function ensureProjectLocalWorkspace(directoryPath: string): Promise<void> {
  await fs.mkdir(configDirPath(directoryPath), { recursive: true });
  await fs.mkdir(scratchDirPath(directoryPath), { recursive: true });
  await ensureGitignoreEntries(directoryPath);
}

async function ensureGitignoreEntries(directoryPath: string): Promise<void> {
  const gitignorePath = path.join(directoryPath, '.gitignore');
  let raw = '';
  try {
    raw = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const lines = raw.split(/\r?\n/);
  const existing = new Set(lines.map(line => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter(entry => !existing.has(entry));
  if (missing.length === 0) return;

  const next = raw.trimEnd()
    ? `${raw.trimEnd()}\n\n# Overlord local scratch\n${missing.join('\n')}\n`
    : `# Overlord local scratch\n${missing.join('\n')}\n`;
  await fs.writeFile(gitignorePath, next, 'utf8');
}

function isProjectArray(value: unknown): value is OverlordConfigProject[] {
  return (
    Array.isArray(value) &&
    value.every(
      entry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { name?: unknown }).name === 'string'
    )
  );
}

async function readExistingProjects(filePath: string): Promise<OverlordConfigProject[] | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'projects' in parsed) {
      const projects = (parsed as { projects: unknown }).projects;
      if (isProjectArray(projects)) return projects;
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Ensures the directory's `.overlord/project.json` includes an entry for the given
 * project. Creates the file when missing, appends when a new project, no-op
 * when already present (id match). Project name is refreshed on every call.
 */
export async function upsertLocalOverlordConfig(input: {
  directoryPath: string;
  project: OverlordConfigProject;
}): Promise<UpsertResult> {
  const directoryPath = input.directoryPath;
  const filePath = configFilePath(directoryPath);

  await ensureProjectLocalWorkspace(directoryPath);
  const existing = await readExistingProjects(filePath);

  if (existing === null) {
    const config = buildConfig([input.project]);
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return { filePath, action: 'created' };
  }

  const matchIndex = existing.findIndex(entry => entry.id === input.project.id);
  if (matchIndex >= 0) {
    if (existing[matchIndex].name === input.project.name) {
      return { filePath, action: 'unchanged' };
    }
    const updated = existing.slice();
    updated[matchIndex] = input.project;
    await fs.writeFile(filePath, `${JSON.stringify(buildConfig(updated), null, 2)}\n`, 'utf8');
    return { filePath, action: 'unchanged' };
  }

  const merged = [...existing, input.project];
  await fs.writeFile(filePath, `${JSON.stringify(buildConfig(merged), null, 2)}\n`, 'utf8');
  return { filePath, action: 'added-project' };
}

/**
 * Removes the given project id from the directory's `.overlord/project.json`. When the
 * resulting projects array would be empty, deletes the file entirely so the
 * folder is left clean. No-ops when the file or entry is absent.
 */
export async function removeProjectFromLocalOverlordConfig(input: {
  directoryPath: string;
  projectId: string;
}): Promise<RemoveResult> {
  const filePath = configFilePath(input.directoryPath);
  const existing = await readExistingProjects(filePath);

  if (existing === null) return { filePath, action: 'not-found' };

  const filtered = existing.filter(entry => entry.id !== input.projectId);
  if (filtered.length === existing.length) {
    return { filePath, action: 'unchanged' };
  }

  if (filtered.length === 0) {
    await fs.unlink(filePath);
    return { filePath, action: 'deleted-file' };
  }

  await fs.writeFile(filePath, `${JSON.stringify(buildConfig(filtered), null, 2)}\n`, 'utf8');
  return { filePath, action: 'removed-project' };
}
