import { execFileSync, spawn } from 'node:child_process';
import { devNull } from 'node:os';

export type GitRun = { ok: boolean; stdout: string; stderr: string };

/**
 * `-c` overrides that keep an *inspection* from executing anything the
 * repository configures: no fsmonitor hook, no hooks directory, no external
 * diff, no pager, no fetch (including partial-clone lazy fetch), no submodule
 * recursion, no background maintenance. Command-line config outranks every
 * config file and propagates to Git's own child processes. Configured
 * `filter.<driver>` commands are neutralized per call (see
 * {@link neutralizedFilterArgs}) because their names are repository-defined.
 */
export const INSPECTION_GIT_CONFIG_ARGS: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'diff.external=',
  '-c',
  'core.pager=cat',
  '-c',
  'protocol.allow=never',
  '-c',
  'submodule.recurse=false',
  '-c',
  'status.submoduleSummary=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
  '-c',
  'color.ui=false',
  '-c',
  'core.quotePath=false',
  '--no-pager'
];

/** Environment variables that would steer Git at another repository, index, or tool. */
const STEERING_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
  'GIT_PAGER',
  'GIT_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT'
];

/**
 * Process environment for an inspection: no optional locks (so `status`/`diff`
 * never refresh and rewrite the index), no prompts, no lazy fetch, and none of
 * the variables that redirect Git elsewhere.
 */
export function inspectionGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of STEERING_ENV_KEYS) delete env[key];
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_PAGER = 'cat';
  env.PAGER = 'cat';
  env.LC_ALL = 'C';
  return env;
}

/**
 * Overrides for every repository-configured `filter.<driver>` so a clean,
 * smudge, or long-running process filter never executes during an inspection.
 * Reading config executes nothing; an empty command disables the driver and
 * `required=false` keeps Git from failing on the missing filter.
 */
export function neutralizedFilterArgs(cwd: string): string[] {
  let listing = '';
  try {
    listing = execFileSync(
      'git',
      [
        ...INSPECTION_GIT_CONFIG_ARGS,
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\.'
      ],
      {
        cwd,
        encoding: 'utf8',
        env: inspectionGitEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
        maxBuffer: 256 * 1024
      }
    );
  } catch {
    return [];
  }
  const drivers = new Set<string>();
  for (const key of listing.split('\0')) {
    const match = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(key.trim());
    if (match?.[1]) drivers.add(match[1]);
  }
  const args: string[] = [];
  for (const driver of drivers) {
    args.push(
      '-c',
      `filter.${driver}.clean=`,
      '-c',
      `filter.${driver}.smudge=`,
      '-c',
      `filter.${driver}.process=`,
      '-c',
      `filter.${driver}.required=false`
    );
  }
  return args;
}

export function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 2 * 1024 * 1024
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Surfaces failure (exit code + stderr) for mutations where the outcome drives typed errors.
 * `inspection: true` applies the hardened read-only configuration — use it for
 * reads only, never for commits or merges whose hooks must run.
 */
export function runGitResult(
  cwd: string,
  args: string[],
  options: { inspection?: boolean } = {}
): GitRun {
  try {
    const stdout = execFileSync(
      'git',
      options.inspection
        ? [...INSPECTION_GIT_CONFIG_ARGS, ...neutralizedFilterArgs(cwd), ...args]
        : args,
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
        ...(options.inspection ? { env: inspectionGitEnv() } : {})
      }
    );
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      ok: false,
      stdout: (e.stdout ? String(e.stdout) : '').trim(),
      stderr: (e.stderr ? String(e.stderr) : '').trim()
    };
  }
}

export interface InspectionGitResult {
  /** Process exit code; null when it was killed. */
  exitCode: number | null;
  /** Captured stdout, at most `maxBytes`. */
  stdout: Buffer;
  /** Captured stderr, at most 4 KiB, for typed error mapping only. */
  stderr: string;
  /** Output passed `maxBytes`; the process was stopped and stdout cut. */
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
}

const STDERR_CAPTURE_BYTES = 4 * 1024;

/**
 * Run one read-only Git command for an inspection: no shell, hardened config
 * and environment, a hard timeout, cancellation, and an output bound. The child
 * is killed as soon as any of them trips; Git read commands hold no lock under
 * `GIT_OPTIONAL_LOCKS=0`, so a kill leaves nothing behind. Never retries.
 */
export function runInspectionGit({
  cwd,
  args,
  timeoutMs,
  maxBytes,
  signal,
  filterArgs = []
}: {
  cwd: string;
  args: string[];
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal | undefined;
  /** Output of {@link neutralizedFilterArgs} for commands that read the worktree. */
  filterArgs?: readonly string[];
}): Promise<InspectionGitResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let captured = 0;
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    if (signal?.aborted) {
      resolve({
        exitCode: null,
        stdout: Buffer.alloc(0),
        stderr: '',
        truncated: false,
        timedOut: false,
        aborted: true
      });
      return;
    }

    const child = spawn('git', [...INSPECTION_GIT_CONFIG_ARGS, ...filterArgs, ...args], {
      cwd,
      env: inspectionGitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    });

    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        stop();
      },
      Math.max(1, timeoutMs)
    );
    const onAbort = () => {
      aborted = true;
      stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const room = maxBytes - captured;
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room));
        captured = maxBytes;
        truncated = true;
        stop();
        return;
      }
      chunks.push(chunk);
      captured += chunk.length;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAPTURE_BYTES) {
        stderr += chunk.toString('utf8').slice(0, STDERR_CAPTURE_BYTES - stderr.length);
      }
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode,
        stdout: Buffer.concat(chunks, captured),
        stderr: stderr.trim(),
        truncated,
        timedOut,
        aborted
      });
    };
    child.on('error', () => finish(null));
    child.on('close', code => finish(code));
  });
}
