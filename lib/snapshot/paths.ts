import path from 'node:path';

function shortId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return normalized.slice(0, 8) || 'unknown';
}

function bookmarkSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown'
  );
}

export function buildManagedSnapshotRoot(baseDirectory: string, projectId: string): string {
  return path.join(baseDirectory, 'projects', projectId, 'jj');
}

export function buildManagedShadowRepoPath(baseDirectory: string, projectId: string): string {
  return path.join(buildManagedSnapshotRoot(baseDirectory, projectId), 'repo');
}

export function buildManagedWorkspacePath(
  baseDirectory: string,
  projectId: string,
  workspaceName: string
): string {
  return path.join(buildManagedSnapshotRoot(baseDirectory, projectId), 'workspaces', workspaceName);
}

export function buildManagedWorkspaceName(args: {
  projectId: string;
  sessionId: string;
  ticketSequence: number;
  retryIndex?: number;
}): string {
  const retryIndex = args.retryIndex ?? 1;
  const sessionShort = shortId(args.sessionId);
  const projectShort = shortId(args.projectId);
  const retrySuffix = retryIndex > 1 ? `-retry-${retryIndex}` : '';
  return `ovld-${projectShort}-${args.ticketSequence}-${sessionShort}${retrySuffix}`;
}

export function buildManagedBookmarkName(args: { ticketId: string; attemptId: string }): string {
  return `ovld/${bookmarkSegment(args.ticketId)}/${bookmarkSegment(args.attemptId)}`;
}

export function isManagedWorkspaceName(workspaceName: string): boolean {
  return workspaceName.startsWith('ovld-');
}
