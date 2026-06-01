import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { listProjectFiles } from '@/lib/filesystem/project-file-tree';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}

async function initGitRepository(cwd: string): Promise<void> {
  await runGit(cwd, ['init', '--initial-branch=main']);
  await runGit(cwd, ['config', 'user.email', 'project-file-tree@test.local']);
  await runGit(cwd, ['config', 'user.name', 'Project File Tree Test']);
}

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

describe('project file tree helpers', () => {
  let tempDirectory: string | null = null;

  afterEach(async () => {
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = null;
    }
  });

  it('includes tracked hidden-directory files and deep tracked files in git repositories', async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ovld-project-tree-'));
    await initGitRepository(tempDirectory);

    const deepSegments = Array.from({ length: 9 }, (_, index) => `level-${index + 1}`);
    const deepFilePath = path.join(tempDirectory, ...deepSegments, 'deep-file.ts');

    await writeFile(path.join(tempDirectory, '.github/workflows/ci.yml'), 'name: ci\n');
    await writeFile(deepFilePath, 'export const value = 1;\n');
    await writeFile(path.join(tempDirectory, 'src/index.ts'), 'export const index = true;\n');
    await writeFile(path.join(tempDirectory, '.gitignore'), 'ignored.log\n');
    await writeFile(path.join(tempDirectory, 'ignored.log'), 'ignore me\n');

    await runGit(tempDirectory, ['add', '.github/workflows/ci.yml', deepFilePath, 'src/index.ts']);

    const result = await listProjectFiles(tempDirectory);

    expect(result.files).toContain('.github/workflows/ci.yml');
    expect(result.files).toContain(`${deepSegments.join('/')}/deep-file.ts`);
    expect(result.files).toContain('src/index.ts');
    expect(result.files).not.toContain('ignored.log');
    expect(result.truncated).toBe(false);
  });

  it('returns paths relative to the selected working directory inside a git repository', async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ovld-project-tree-'));
    await initGitRepository(tempDirectory);

    const packageRoot = path.join(tempDirectory, 'packages/app');
    await writeFile(path.join(packageRoot, 'src/index.ts'), 'export const app = true;\n');
    await writeFile(path.join(tempDirectory, 'README.md'), '# repo\n');

    await runGit(tempDirectory, ['add', 'packages/app/src/index.ts', 'README.md']);

    const result = await listProjectFiles(packageRoot);

    expect(result.files).toEqual(['src/index.ts']);
    expect(result.truncated).toBe(false);
  });
});
