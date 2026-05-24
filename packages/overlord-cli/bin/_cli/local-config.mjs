// Read/merge/write logic for the per-folder `.overlord/project.json` file.
// Mirrors lib/overlord-config/local-config.ts for CLI use.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const OVERLORD_CONFIG_DIRNAME = '.overlord';
export const OVERLORD_CONFIG_FILENAME = 'project.json';
export const OVERLORD_SCRATCH_DIRNAME = 'tmp';
export const OVERLORD_LOG_DIRNAME = 'logs';

const FILE_COMMENT =
  'This file lets Overlord (https://www.ovld.ai) identify which project this folder belongs to. It is created automatically when the folder is added as a project resource. DO NOT EDIT MANUALLY.';
const GITIGNORE_ENTRIES = ['.overlord/tmp/', '.overlord/logs/'];

function buildConfig(projects) {
  return { _comment: FILE_COMMENT, projects };
}

function configDirPath(directoryPath) {
  return path.join(directoryPath, OVERLORD_CONFIG_DIRNAME);
}

function configFilePath(directoryPath) {
  return path.join(configDirPath(directoryPath), OVERLORD_CONFIG_FILENAME);
}

function scratchDirPath(directoryPath) {
  return path.join(configDirPath(directoryPath), OVERLORD_SCRATCH_DIRNAME);
}

async function ensureProjectLocalWorkspace(directoryPath) {
  await fs.mkdir(configDirPath(directoryPath), { recursive: true });
  await fs.mkdir(scratchDirPath(directoryPath), { recursive: true });
  await ensureGitignoreEntries(directoryPath);
}

async function ensureGitignoreEntries(directoryPath) {
  const gitignorePath = path.join(directoryPath, '.gitignore');
  let raw = '';
  try {
    raw = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
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

function isProjectArray(value) {
  return (
    Array.isArray(value) &&
    value.every(
      entry =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string'
    )
  );
}

async function readExistingProjects(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && isProjectArray(parsed.projects)) {
      return parsed.projects;
    }
    return [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Ensures `directoryPath/.overlord/project.json` lists the project. Returns
 * `{ filePath, action: 'created' | 'added-project' | 'unchanged' }`.
 */
export async function upsertLocalOverlordConfig({ directoryPath, project }) {
  const filePath = configFilePath(directoryPath);
  await ensureProjectLocalWorkspace(directoryPath);
  const existing = await readExistingProjects(filePath);

  if (existing === null) {
    await fs.writeFile(filePath, `${JSON.stringify(buildConfig([project]), null, 2)}\n`, 'utf8');
    return { filePath, action: 'created' };
  }

  const idx = existing.findIndex(entry => entry.id === project.id);
  if (idx >= 0) {
    if (existing[idx].name === project.name) return { filePath, action: 'unchanged' };
    const updated = existing.slice();
    updated[idx] = project;
    await fs.writeFile(filePath, `${JSON.stringify(buildConfig(updated), null, 2)}\n`, 'utf8');
    return { filePath, action: 'unchanged' };
  }

  const merged = [...existing, project];
  await fs.writeFile(filePath, `${JSON.stringify(buildConfig(merged), null, 2)}\n`, 'utf8');
  return { filePath, action: 'added-project' };
}

/**
 * Removes `projectId` from `directoryPath/.overlord/project.json`. Deletes the file
 * when the resulting projects list is empty. Returns
 * `{ filePath, action: 'removed-project' | 'deleted-file' | 'not-found' | 'unchanged' }`.
 */
export async function removeProjectFromLocalOverlordConfig({ directoryPath, projectId }) {
  const filePath = configFilePath(directoryPath);
  const existing = await readExistingProjects(filePath);

  if (existing === null) return { filePath, action: 'not-found' };

  const filtered = existing.filter(entry => entry.id !== projectId);
  if (filtered.length === existing.length) return { filePath, action: 'unchanged' };

  if (filtered.length === 0) {
    await fs.unlink(filePath);
    return { filePath, action: 'deleted-file' };
  }

  await fs.writeFile(filePath, `${JSON.stringify(buildConfig(filtered), null, 2)}\n`, 'utf8');
  return { filePath, action: 'removed-project' };
}
