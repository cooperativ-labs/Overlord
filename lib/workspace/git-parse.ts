/**
 * Shared git output parsers — usable by both the local Node implementation and
 * the remote helper server. Pure functions, no I/O.
 */

import type { GitStatusFile } from './types';

type GitStatusRaw = Omit<GitStatusFile, 'linesAdded' | 'linesRemoved'>;

export type GitFileStats = {
  linesAdded: number | null;
  linesRemoved: number | null;
};

function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

export function normalizeGitStatus(code: string): string {
  if (code === '??') return 'untracked';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('T')) return 'typechange';
  return 'modified';
}

export function parseGitStatus(stdout: string): GitStatusRaw[] {
  const entries = stdout.split('\0').filter(Boolean);
  const files: GitStatusRaw[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    const x = entry[0] ?? ' ';
    const y = entry[1] ?? ' ';
    const pathValue = entry.slice(3);
    const isRenameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    const originalPath = isRenameOrCopy ? (entries[index + 1] ?? null) : null;

    if (isRenameOrCopy) index += 1;
    if (!pathValue) continue;

    files.push({
      originalPath: originalPath ? toPosixPath(originalPath) : null,
      path: toPosixPath(pathValue),
      stagedStatus: x,
      status: normalizeGitStatus(`${x}${y}`),
      unstagedStatus: y
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parseRenameTarget(value: string): { originalPath: string; path: string } | null {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(value);
  if (braceMatch) {
    const [, prefix, originalSegment, nextSegment, suffix] = braceMatch;
    return {
      originalPath: `${prefix}${originalSegment}${suffix}`,
      path: `${prefix}${nextSegment}${suffix}`
    };
  }
  const separator = ' => ';
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex === -1) return null;
  return {
    originalPath: value.slice(0, separatorIndex),
    path: value.slice(separatorIndex + separator.length)
  };
}

export function parseNumStat(stdout: string): Map<string, GitFileStats> {
  const stats = new Map<string, GitFileStats>();
  const lines = stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
    const pathValue = pathParts.join('\t').trim();
    if (!pathValue) continue;

    const parsedPath = parseRenameTarget(pathValue);
    const nextPath = parsedPath?.path ?? pathValue;

    stats.set(toPosixPath(nextPath), {
      linesAdded: addedRaw === '-' ? null : Number.parseInt(addedRaw ?? '', 10),
      linesRemoved: removedRaw === '-' ? null : Number.parseInt(removedRaw ?? '', 10)
    });
  }

  return stats;
}

export function countLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split('\n').length;
}

export { toPosixPath };
