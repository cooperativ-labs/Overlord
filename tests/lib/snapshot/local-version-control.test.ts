import { createLocalCheckpoint, installLocalVersionControl } from '@/lib/snapshot';

describe('installLocalVersionControl', () => {
  it('returns a clear error when jj is missing', async () => {
    const result = await installLocalVersionControl({
      directory: process.cwd(),
      mode: 'jj',
      runner: async command => {
        if (command === 'jj') throw new Error('spawn jj ENOENT');
        return { stdout: '', stderr: '', ok: true };
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('jj');
  });

  it('adopts an existing jj repository without initializing again', async () => {
    const calls: string[] = [];
    const result = await installLocalVersionControl({
      directory: process.cwd(),
      mode: 'jj',
      runner: async (_command, args) => {
        calls.push(args.join(' '));
        if (args[0] === 'version') return { stdout: 'jj 0.99.0\n', stderr: '', ok: true };
        if (args.includes('root')) return { stdout: `${process.cwd()}\n`, stderr: '', ok: true };
        return { stdout: '', stderr: '', ok: true };
      }
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyInstalled: true,
      backend: 'jj'
    });
    expect(calls.some(call => call.startsWith('git init'))).toBe(false);
  });
});

describe('createLocalCheckpoint', () => {
  it('collects jj ids and diff stat', async () => {
    const result = await createLocalCheckpoint({
      backendPreference: 'jj',
      checkpointKind: 'delivery',
      projectId: 'project',
      ticketId: '1:1',
      sessionId: 'session',
      workspacePath: process.cwd(),
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (joined.includes(' op log ')) return { stdout: 'op789\n', stderr: '' };
        if (joined.includes(' log ')) return { stdout: 'change123 commit456\n', stderr: '' };
        if (joined.includes(' diff --stat')) return { stdout: '1 file changed\n', stderr: '' };
        return { stdout: '', stderr: '' };
      }
    });

    expect(result).toMatchObject({
      backend: 'jj',
      jjChangeId: 'change123',
      jjCommitId: 'commit456',
      jjOperationId: 'op789',
      diffStat: '1 file changed'
    });
  });

  it('falls back to git metadata when no jj repository is active', async () => {
    const result = await createLocalCheckpoint({
      backendPreference: 'git',
      checkpointKind: 'delivery',
      projectId: 'project',
      ticketId: '1:1',
      sessionId: 'session',
      workspacePath: process.cwd(),
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (joined.includes('rev-parse --show-toplevel')) {
          return { stdout: `${process.cwd()}\n`, stderr: '' };
        }
        if (joined.includes('rev-parse HEAD')) return { stdout: 'abc123\n', stderr: '' };
        if (joined.includes('diff --stat HEAD')) return { stdout: '2 files changed\n', stderr: '' };
        return { stdout: '', stderr: '' };
      }
    });

    expect(result).toMatchObject({
      backend: 'git',
      gitCommitId: 'abc123',
      diffStat: '2 files changed'
    });
  });
});
