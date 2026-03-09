import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeTerminalCwd } from '../services/terminal-manager';

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 5000;

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.turbo'
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

async function listProjectFiles(
  rootDirectory: string,
  options?: { maxDepth?: number; maxEntriesPerDirectory?: number; maxFiles?: number }
): Promise<{ files: string[]; truncated: boolean }> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDirectory =
    options?.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
  console.log('listProjectFiles', 'rootDirectory', rootDirectory, 'options', options);
  const files: string[] = [];
  let truncated = false;

  async function walk(currentDirectory: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) return;

    let entries: Array<{
      isDirectory(): boolean;
      isFile(): boolean;
      name: string;
    }>;
    try {
      const rawEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
      entries = rawEntries.map(entry => ({
        isDirectory: () => entry.isDirectory(),
        isFile: () => entry.isFile(),
        name: String(entry.name)
      }));
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    if (entries.length > maxEntriesPerDirectory) {
      entries = entries.slice(0, maxEntriesPerDirectory);
      truncated = true;
    }

    for (const entry of entries) {
      if (truncated) return;

      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      files.push(toPosixPath(path.relative(rootDirectory, absolutePath)));
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await walk(rootDirectory, 0);
  return { files, truncated };
}

export function registerFilesystemIpc(): void {
  ipcMain.handle('filesystem:directory-exists', async (_event, directory?: string) => {
    const resolvedDirectory = normalizeTerminalCwd(directory);
    if (!resolvedDirectory) return false;

    const stat = await fs.stat(resolvedDirectory).catch(() => null);
    return Boolean(stat?.isDirectory());
  });

  ipcMain.handle(
    'filesystem:list-project-files',
    async (
      _event,
      payload?: {
        directory?: string;
        maxDepth?: number;
        maxEntriesPerDirectory?: number;
        maxFiles?: number;
      }
    ) => {
      const resolvedDirectory = normalizeTerminalCwd(payload?.directory);
      if (!resolvedDirectory) {
        return {
          files: [],
          linkedDirectory: null,
          truncated: false,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }

      const { files, truncated } = await listProjectFiles(resolvedDirectory, payload);
      return {
        files,
        linkedDirectory: resolvedDirectory,
        truncated
      };
    }
  );
}
