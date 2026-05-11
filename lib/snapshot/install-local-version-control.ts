import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CommandResult = { stdout: string; stderr: string };
type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean }
) => Promise<CommandResult & { ok?: boolean }>;

export type InstallLocalVersionControlInput = {
  directory: string;
  mode: 'jj';
  runner?: CommandRunner;
};

export type InstallLocalVersionControlResult =
  | {
      ok: true;
      backend: 'jj';
      rootPath: string;
      alreadyInstalled: boolean;
      jjVersion: string | null;
    }
  | {
      ok: false;
      error: string;
    };

async function defaultRunner(
  command: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {}
): Promise<CommandResult & { ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000
    });
    return {
      ok: true,
      stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
      stderr: typeof stderr === 'string' ? stderr : String(stderr ?? '')
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout:
          error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
            ? error.stdout
            : '',
        stderr:
          error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
            ? error.stderr
            : ''
      };
    }
    throw error;
  }
}

export async function installLocalVersionControl(
  input: InstallLocalVersionControlInput
): Promise<InstallLocalVersionControlResult> {
  if (input.mode !== 'jj') return { ok: false, error: 'Only JJ version control is supported.' };
  const runner = input.runner ?? defaultRunner;
  const directory = path.resolve(input.directory.trim());

  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) return { ok: false, error: 'Path is not a directory.' };
    await fs.access(directory, fsConstants.W_OK);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Directory does not exist or is not writable.'
    };
  }

  let version: string | null;
  try {
    const result = await runner('jj', ['version'], { cwd: directory });
    version = result.stdout.trim() || null;
  } catch {
    return {
      ok: false,
      error: 'The `jj` command was not found. Install Jujutsu before enabling version control.'
    };
  }

  const existing = await runner('jj', ['--repository', directory, 'root'], {
    cwd: directory,
    allowFailure: true
  });
  const alreadyInstalled = existing.ok !== false && existing.stdout.trim().length > 0;

  if (!alreadyInstalled) {
    const hasGit = Boolean(await fs.stat(path.join(directory, '.git')).catch(() => null));
    const initAttempts = hasGit
      ? [
          ['git', 'init', '--colocate'],
          ['git', 'init', directory, '--colocate']
        ]
      : [
          ['git', 'init', '--colocate'],
          ['git', 'init', directory, '--colocate'],
          ['init', '--git'],
          ['init', directory, '--git']
        ];

    let initialized = false;
    let lastError: string | null = null;
    for (const args of initAttempts) {
      const result = await runner('jj', args, { cwd: directory, allowFailure: true });
      if (result.ok !== false) {
        initialized = true;
        break;
      }
      lastError = result.stderr || result.stdout || `jj ${args.join(' ')} failed.`;
    }
    if (!initialized) return { ok: false, error: lastError ?? 'Failed to initialize JJ.' };
  }

  await runner('jj', ['--repository', directory, 'util', 'snapshot'], { cwd: directory });
  const root = await runner('jj', ['--repository', directory, 'root'], { cwd: directory });

  return {
    ok: true,
    backend: 'jj',
    rootPath: root.stdout.trim() || directory,
    alreadyInstalled,
    jjVersion: version
  };
}
