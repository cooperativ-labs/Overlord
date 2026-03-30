import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

export function resolveLinkedDirectory(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const home = os.homedir();
  if (raw === '~') return home;
  if (raw.startsWith('~/')) return path.join(home, raw.slice(2));
  if (!path.isAbsolute(raw)) return path.resolve(raw);
  return path.normalize(raw);
}

type FileTreeOptions = {
  maxDepth?: number;
  maxEntriesPerDirectory?: number;
  maxFiles?: number;
};

export async function listProjectFiles(
  rootDirectory: string,
  options: FileTreeOptions = {}
): Promise<{ files: string[]; truncated: boolean }> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDirectory =
    options.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
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

    entries.sort((a, b) => a.name.localeCompare(b.name));

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
