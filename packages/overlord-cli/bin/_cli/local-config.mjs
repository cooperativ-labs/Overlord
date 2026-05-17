// Read/merge/write logic for the per-folder `overlord.json` file.
// Mirrors lib/overlord-config/local-config.ts for CLI use.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const OVERLORD_CONFIG_FILENAME = 'overlord.json';

const FILE_COMMENT =
  'This file lets Overlord (https://www.ovld.ai) identify which project this folder belongs to. It is created automatically when the folder is added as a project resource. DO NOT EDIT MANUALLY.';

function buildConfig(projects) {
  return { _comment: FILE_COMMENT, projects };
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
 * Ensures `directoryPath/overlord.json` lists the project. Returns
 * `{ filePath, action: 'created' | 'added-project' | 'unchanged' }`.
 */
export async function upsertLocalOverlordConfig({ directoryPath, project }) {
  const filePath = path.join(directoryPath, OVERLORD_CONFIG_FILENAME);
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
 * Removes `projectId` from `directoryPath/overlord.json`. Deletes the file
 * when the resulting projects list is empty. Returns
 * `{ filePath, action: 'removed-project' | 'deleted-file' | 'not-found' | 'unchanged' }`.
 */
export async function removeProjectFromLocalOverlordConfig({ directoryPath, projectId }) {
  const filePath = path.join(directoryPath, OVERLORD_CONFIG_FILENAME);
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
