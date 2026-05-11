import {
  buildManagedBookmarkName,
  buildManagedShadowRepoPath,
  buildManagedSnapshotRoot,
  buildManagedWorkspaceName,
  buildManagedWorkspacePath,
  isManagedWorkspaceName
} from '@/lib/snapshot';

describe('snapshot path helpers', () => {
  it('builds managed repository and workspace paths under the project snapshot root', () => {
    const root = buildManagedSnapshotRoot('/tmp/overlord', 'project-123');
    const repo = buildManagedShadowRepoPath('/tmp/overlord', 'project-123');
    const workspace = buildManagedWorkspacePath('/tmp/overlord', 'project-123', 'ovld-demo');

    expect(root).toBe('/tmp/overlord/projects/project-123/jj');
    expect(repo).toBe('/tmp/overlord/projects/project-123/jj/repo');
    expect(workspace).toBe('/tmp/overlord/projects/project-123/jj/workspaces/ovld-demo');
  });

  it('builds stable managed workspace and bookmark names', () => {
    const workspaceName = buildManagedWorkspaceName({
      projectId: 'Project Alpha',
      sessionId: '389dc3e6-392b-4c04-8780-3e8ec1789bd4',
      ticketSequence: 973
    });
    const retryWorkspaceName = buildManagedWorkspaceName({
      projectId: 'Project Alpha',
      sessionId: '389dc3e6-392b-4c04-8780-3e8ec1789bd4',
      ticketSequence: 973,
      retryIndex: 2
    });
    const bookmarkName = buildManagedBookmarkName({
      ticketId: '1:973',
      attemptId: 'ab12CD34'
    });

    expect(workspaceName).toBe('ovld-projecta-973-389dc3e6');
    expect(retryWorkspaceName).toBe('ovld-projecta-973-389dc3e6-retry-2');
    expect(bookmarkName).toBe('ovld/1-973/ab12cd34');
    expect(isManagedWorkspaceName(workspaceName)).toBe(true);
    expect(isManagedWorkspaceName('user-workspace')).toBe(false);
  });
});
