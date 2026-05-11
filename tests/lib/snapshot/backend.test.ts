import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JjCliSnapshotBackend, type SnapshotCommandRunner } from '@/lib/snapshot';

class FakeRunner implements SnapshotCommandRunner {
  readonly calls: Array<{ args: string[]; cwd?: string }> = [];
  private readonly outputs: string[];

  constructor(outputs: string[] = ['jj 0.1.0']) {
    this.outputs = outputs;
  }

  async run(
    args: string[],
    options?: { cwd?: string }
  ): Promise<{ stdout: string; stderr: string }> {
    this.calls.push({ args, cwd: options?.cwd });
    const stdout = this.outputs.shift() ?? '';
    return { stdout, stderr: '' };
  }
}

describe('JjCliSnapshotBackend', () => {
  it('prepares a managed shadow repository and workspace using jj commands', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-jj-backend-'));
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-jj-source-'));
    fs.mkdirSync(path.join(sourceDir, '.git'));

    const runner = new FakeRunner(['jj 0.27.0']);
    const backend = new JjCliSnapshotBackend({ baseDirectory: rootDir, runner });

    const project = await backend.prepareProject({
      gitRemoteUrl: null,
      projectId: 'project-123',
      sourceDirectory: sourceDir
    });

    const workspace = await backend.createWorkspace({
      baseGitCommitId: 'abc123',
      projectId: 'project-123',
      retryIndex: 1,
      sessionId: '389dc3e6-392b-4c04-8780-3e8ec1789bd4',
      sourceBinding: project,
      ticketId: '1:973',
      ticketSequence: 973
    });

    expect(project.shadowRepoPath).toBe(
      path.join(rootDir, 'projects', 'project-123', 'jj', 'repo')
    );
    expect(workspace.workspaceName).toBe('ovld-project1-973-389dc3e6');
    expect(workspace.workspacePath).toBe(
      path.join(
        rootDir,
        'projects',
        'project-123',
        'jj',
        'workspaces',
        'ovld-project1-973-389dc3e6'
      )
    );
    expect(runner.calls[0]?.args).toEqual(['version']);
    expect(runner.calls[1]?.args).toEqual([
      'git',
      'clone',
      '--no-colocate',
      sourceDir,
      project.shadowRepoPath
    ]);
    expect(runner.calls[2]?.args).toEqual([
      '--repository',
      project.shadowRepoPath,
      'workspace',
      'add',
      workspace.workspacePath
    ]);
    expect(runner.calls[3]?.args).toEqual([
      '--repository',
      workspace.workspacePath,
      'edit',
      'abc123'
    ]);
  });
});
