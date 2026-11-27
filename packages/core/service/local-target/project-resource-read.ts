import type { ProjectResourceReadRequest, RepositoryDirectoryData } from '@overlord/contract';
import { opendirSync } from 'node:fs';
import path from 'node:path';

import { readCurrentDiffGit } from './current-diff-git.ts';
import {
  configuredSensitiveGlobs,
  isSensitiveRepositoryPath,
  normalizeRepositoryRelativePath,
  resolveProjectPreviewPath,
  statOrNull
} from './repository-paths.ts';
import { readGitStatusGit, readRepositoryFileGit } from './repository-read-git.ts';
import type {
  CurrentDiffData,
  GitStatusData,
  RepositoryFileData,
  RepositoryReadTargetValue
} from './types.ts';

export type ProjectResourceReadInput = ProjectResourceReadRequest & {
  repoPath: string;
  resourceId: string;
};
export type ProjectResourceReadValue = RepositoryReadTargetValue<
  CurrentDiffData | GitStatusData | RepositoryFileData | RepositoryDirectoryData | null
>;

const DIRECTORY_PAGE_SIZE = 100;
const PROJECT_DIRECTORY_SCAN_LIMIT = 10_000;

function readResult(
  outcome: ProjectResourceReadValue['outcome'],
  data: RepositoryDirectoryData | null = null,
  truncated = false
): ProjectResourceReadValue {
  return {
    outcome,
    data,
    truncated,
    head: null,
    branch: null,
    observedAt: new Date().toISOString()
  };
}

function listDirectory(input: ProjectResourceReadInput & { operation: 'list_directory' }) {
  const folder = resolveProjectPreviewPath(input.repoPath, input.relativePath);
  if (!folder.ok) return readResult(folder.outcome);
  const identity = statOrNull(folder.absolutePath);
  if (!identity?.isDirectory()) return readResult('not_found');

  const extra = configuredSensitiveGlobs();
  const offset = input.offset ?? 0;
  const entries: RepositoryDirectoryData['entries'] = [];
  let index = 0;
  let truncated = false;
  let nextOffset: number | null = null;
  const directory = opendirSync(folder.absolutePath);
  try {
    while (true) {
      const entry = directory.readSync();
      if (!entry) break;
      if (index >= PROJECT_DIRECTORY_SCAN_LIMIT) {
        truncated = true;
        break;
      }
      index += 1;
      if (index <= offset) continue;
      const relativePath = path.posix.join(folder.relativePath, entry.name);
      const checked = normalizeRepositoryRelativePath(relativePath);
      if (
        (!entry.isFile() && !entry.isDirectory()) ||
        !checked.ok ||
        checked.relativePath !== relativePath ||
        isSensitiveRepositoryPath(relativePath, extra) ||
        relativePath.toLowerCase() === '.overlord/tmp'
      )
        continue;
      if (entries.length === DIRECTORY_PAGE_SIZE) {
        nextOffset = index - 1;
        break;
      }
      entries.push({
        name: entry.name,
        relativePath,
        type: entry.isDirectory() ? 'directory' : 'file'
      });
    }
  } finally {
    directory.closeSync();
  }
  const current = resolveProjectPreviewPath(input.repoPath, input.relativePath);
  const after = current.ok ? statOrNull(current.absolutePath) : null;
  if (
    !current.ok ||
    current.absolutePath !== folder.absolutePath ||
    after?.dev !== identity.dev ||
    after.ino !== identity.ino
  ) {
    return readResult('denied');
  }
  return readResult('ok', { relativePath: folder.relativePath, entries, nextOffset }, truncated);
}

export async function readProjectResource(input: ProjectResourceReadInput) {
  switch (input.operation) {
    case 'git_status':
      return readGitStatusGit({ ...input, requireExactRoot: true, maxEntriesPerClass: 50 });
    case 'diff': {
      const candidate = resolveProjectPreviewPath(input.repoPath, input.relativePath);
      if (!candidate.ok && candidate.outcome !== 'not_found') return readResult(candidate.outcome);
      return readCurrentDiffGit({
        ...input,
        relativePaths: [input.relativePath],
        requireExactRoot: true
      });
    }
    case 'read_file':
      return readRepositoryFileGit({ ...input, filesystemOnly: true });
    case 'list_directory':
      return listDirectory(input);
    default:
      return readResult('unavailable');
  }
}
