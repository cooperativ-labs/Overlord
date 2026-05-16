import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };
type CommandResult = { stdout: string; stderr: string };
type Runner = (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>;

export type CheckpointKind = 'objective' | 'delivery' | 'manual';

export type CreateCheckpointInput = {
  workspacePath: string;
  objectiveId: string;
  kind?: CheckpointKind;
  summary?: string | null;
  runner?: Runner;
};

export type CreateCheckpointResult = {
  workspacePath: string;
  objectiveId: string;
  ref: string;
  gitCommitId: string;
  headSha: string;
  diffStat: string | null;
};

export type RestoreCheckpointInput = {
  workspacePath: string;
  objectiveId: string;
  runner?: Runner;
};

export type RestoreCheckpointResult = {
  ref: string;
  gitCommitId: string;
  safetyRef: string | null;
  safetySha: string | null;
};

export type CheckpointDiffInput = {
  workspacePath: string;
  objectiveId?: string;
  gitCommitId?: string;
  runner?: Runner;
};

export type CheckpointDiffResult = {
  ref: string | null;
  gitCommitId: string;
  parentSha: string | null;
  headSha: string;
  diff: string;
  diffStat: string | null;
};

const REF_NS = 'refs/overlord/checkpoints';
const SAFETY_NS = 'refs/overlord/safety';

function refFor(objectiveId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(objectiveId)) {
    throw new Error(`Invalid objectiveId for git ref: ${objectiveId}`);
  }
  return `${REF_NS}/${objectiveId}`;
}

const defaultRunner: Runner = async (command, args, options = {}) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ?? { ...process.env, NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000
  });
  return {
    stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
    stderr: typeof stderr === 'string' ? stderr : String(stderr ?? '')
  };
};

async function git(
  runner: Runner,
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await runner('git', ['-C', cwd, ...args], { cwd, env });
  return stdout.trim();
}

async function gitOk(
  runner: Runner,
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ ok: boolean; output: string }> {
  try {
    const out = await git(runner, cwd, args, env);
    return { ok: true, output: out };
  } catch {
    return { ok: false, output: '' };
  }
}

async function assertGitRepo(runner: Runner, workspacePath: string): Promise<string> {
  const top = await gitOk(runner, workspacePath, ['rev-parse', '--show-toplevel']);
  if (!top.ok || !top.output) {
    throw new Error(`No git repository found at ${workspacePath}.`);
  }
  return top.output;
}

async function snapshotWorkingTree(
  runner: Runner,
  repoRoot: string,
  parentSha: string,
  message: string
): Promise<string> {
  const tempIndex = path.join(repoRoot, '.git', `overlord-snap-index-${Date.now()}`);
  const env = { ...process.env, NO_COLOR: '1', GIT_INDEX_FILE: tempIndex };
  try {
    await git(runner, repoRoot, ['read-tree', 'HEAD'], env);
    await git(runner, repoRoot, ['add', '-A'], env);
    const tree = await git(runner, repoRoot, ['write-tree'], env);
    if (!tree) throw new Error('git write-tree produced no output.');
    return await git(runner, repoRoot, ['commit-tree', tree, '-p', parentSha, '-m', message]);
  } finally {
    await fs.unlink(tempIndex).catch(() => {});
  }
}

/**
 * Snapshot the working tree (including untracked files) to a hidden ref
 * `refs/overlord/checkpoints/<objectiveId>`. The user's branch and HEAD
 * are not modified. Idempotent: if the ref already exists for this
 * objectiveId, the existing snapshot is returned unchanged.
 */
export async function createCheckpoint(
  input: CreateCheckpointInput
): Promise<CreateCheckpointResult> {
  const workspacePath = path.resolve(input.workspacePath.trim());
  const runner = input.runner ?? defaultRunner;
  const ref = refFor(input.objectiveId);
  const repoRoot = await assertGitRepo(runner, workspacePath);

  const headSha = await git(runner, repoRoot, ['rev-parse', 'HEAD']);

  const existing = await gitOk(runner, repoRoot, ['rev-parse', '--verify', ref]);
  if (existing.ok && existing.output) {
    const diff = await gitOk(runner, repoRoot, ['diff', '--stat', `${existing.output}^!`]);
    return {
      workspacePath: repoRoot,
      objectiveId: input.objectiveId,
      ref,
      gitCommitId: existing.output,
      headSha,
      diffStat: diff.output || null
    };
  }

  const message = input.summary?.trim()
    ? `overlord checkpoint ${input.objectiveId}\n\n${input.summary.trim()}`
    : `overlord checkpoint ${input.objectiveId}`;
  const commit = await snapshotWorkingTree(runner, repoRoot, headSha, message);
  if (!commit) throw new Error('git commit-tree produced no output.');

  await git(runner, repoRoot, ['update-ref', ref, commit]);
  const diff = await gitOk(runner, repoRoot, ['diff', '--stat', `${commit}^!`]);

  return {
    workspacePath: repoRoot,
    objectiveId: input.objectiveId,
    ref,
    gitCommitId: commit,
    headSha,
    diffStat: diff.output || null
  };
}

/**
 * Restore the working tree to a previously captured checkpoint. Captures
 * a safety snapshot of the current state to refs/overlord/safety/<ts>
 * before mutating anything. Caller is responsible for confirming with
 * the user; this does not prompt.
 */
export async function restoreCheckpoint(
  input: RestoreCheckpointInput
): Promise<RestoreCheckpointResult> {
  const workspacePath = path.resolve(input.workspacePath.trim());
  const runner = input.runner ?? defaultRunner;
  const ref = refFor(input.objectiveId);
  const repoRoot = await assertGitRepo(runner, workspacePath);

  const target = await gitOk(runner, repoRoot, ['rev-parse', '--verify', ref]);
  if (!target.ok || !target.output) {
    throw new Error(`No checkpoint exists for objective ${input.objectiveId}.`);
  }

  let safetyRef: string | null = null;
  let safetySha: string | null = null;
  try {
    const headSha = await git(runner, repoRoot, ['rev-parse', 'HEAD']);
    const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
    const sRef = `${SAFETY_NS}/${stamp}`;
    const sha = await snapshotWorkingTree(
      runner,
      repoRoot,
      headSha,
      `overlord pre-revert safety ${new Date().toISOString()}`
    );
    if (sha) {
      await git(runner, repoRoot, ['update-ref', sRef, sha]);
      safetyRef = sRef;
      safetySha = sha;
    }
  } catch {
    // Safety stash is best-effort; do not block restore on it.
  }

  await git(runner, repoRoot, ['read-tree', '--reset', '-u', target.output]);

  return { ref, gitCommitId: target.output, safetyRef, safetySha };
}

export async function diffCheckpoint(input: CheckpointDiffInput): Promise<CheckpointDiffResult> {
  const workspacePath = path.resolve(input.workspacePath.trim());
  const runner = input.runner ?? defaultRunner;
  const repoRoot = await assertGitRepo(runner, workspacePath);
  const headSha = await git(runner, repoRoot, ['rev-parse', 'HEAD']);
  let ref: string | null = null;
  let gitCommitId = input.gitCommitId?.trim() ?? '';

  if (!gitCommitId) {
    if (!input.objectiveId) {
      throw new Error('objectiveId or gitCommitId is required.');
    }
    ref = refFor(input.objectiveId);
    const target = await gitOk(runner, repoRoot, ['rev-parse', '--verify', ref]);
    if (!target.ok || !target.output) {
      throw new Error(`No checkpoint exists for objective ${input.objectiveId}.`);
    }
    gitCommitId = target.output;
  }

  const verified = await gitOk(runner, repoRoot, [
    'rev-parse',
    '--verify',
    `${gitCommitId}^{commit}`
  ]);
  if (!verified.ok || !verified.output) {
    throw new Error(`Checkpoint commit ${gitCommitId} does not exist in this repository.`);
  }

  const [diff, diffStat, parent] = await Promise.all([
    gitOk(runner, repoRoot, ['diff', '--find-renames', verified.output, 'HEAD']),
    gitOk(runner, repoRoot, ['diff', '--stat', verified.output, 'HEAD']),
    gitOk(runner, repoRoot, ['rev-parse', '--verify', `${verified.output}^`])
  ]);

  return {
    ref,
    gitCommitId: verified.output,
    parentSha: parent.ok && parent.output ? parent.output : null,
    headSha,
    diff: diff.output,
    diffStat: diffStat.output || null
  };
}

export type CheckpointSummary = {
  objectiveId: string;
  ref: string;
  gitCommitId: string;
};

export async function listCheckpoints(input: {
  workspacePath: string;
  runner?: Runner;
}): Promise<CheckpointSummary[]> {
  const runner = input.runner ?? defaultRunner;
  const repoRoot = await assertGitRepo(runner, path.resolve(input.workspacePath.trim()));
  const out = await gitOk(runner, repoRoot, [
    'for-each-ref',
    `--format=%(refname) %(objectname)`,
    `${REF_NS}/`
  ]);
  if (!out.ok) return [];
  return out.output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ref, sha] = line.split(/\s+/);
      const objectiveId = ref.slice(`${REF_NS}/`.length);
      return { objectiveId, ref, gitCommitId: sha };
    });
}

export type SafetyRefSummary = {
  ref: string;
  gitCommitId: string;
  createdAt: string | null;
};

function parseSafetyStamp(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safetyRefIsValid(ref: string): boolean {
  return ref.startsWith(`${SAFETY_NS}/`) && /^[A-Za-z0-9/_-]+$/.test(ref);
}

export async function listSafetyRefs(input: {
  workspacePath: string;
  runner?: Runner;
}): Promise<SafetyRefSummary[]> {
  const runner = input.runner ?? defaultRunner;
  const repoRoot = await assertGitRepo(runner, path.resolve(input.workspacePath.trim()));
  const out = await gitOk(runner, repoRoot, [
    'for-each-ref',
    `--format=%(refname) %(objectname)`,
    `${SAFETY_NS}/`
  ]);
  if (!out.ok) return [];
  return out.output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ref, sha] = line.split(/\s+/);
      const stamp = ref.slice(`${SAFETY_NS}/`.length);
      return { ref, gitCommitId: sha, createdAt: parseSafetyStamp(stamp) };
    })
    .sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export type RestoreSafetyRefInput = {
  workspacePath: string;
  ref: string;
  runner?: Runner;
};

export async function restoreSafetyRef(
  input: RestoreSafetyRefInput
): Promise<RestoreCheckpointResult> {
  if (!safetyRefIsValid(input.ref)) {
    throw new Error(`Invalid safety ref: ${input.ref}`);
  }
  const workspacePath = path.resolve(input.workspacePath.trim());
  const runner = input.runner ?? defaultRunner;
  const repoRoot = await assertGitRepo(runner, workspacePath);

  const target = await gitOk(runner, repoRoot, ['rev-parse', '--verify', input.ref]);
  if (!target.ok || !target.output) {
    throw new Error(`Safety ref ${input.ref} not found.`);
  }

  let safetyRef: string | null = null;
  let safetySha: string | null = null;
  try {
    const headSha = await git(runner, repoRoot, ['rev-parse', 'HEAD']);
    const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
    const sRef = `${SAFETY_NS}/${stamp}`;
    const sha = await snapshotWorkingTree(
      runner,
      repoRoot,
      headSha,
      `overlord pre-safety-restore ${new Date().toISOString()}`
    );
    if (sha) {
      await git(runner, repoRoot, ['update-ref', sRef, sha]);
      safetyRef = sRef;
      safetySha = sha;
    }
  } catch {
    // Best-effort safety; do not block restore.
  }

  await git(runner, repoRoot, ['read-tree', '--reset', '-u', target.output]);

  return { ref: input.ref, gitCommitId: target.output, safetyRef, safetySha };
}

export async function pruneCheckpoints(input: {
  workspacePath: string;
  objectiveIds: string[];
  runner?: Runner;
}): Promise<{ pruned: string[] }> {
  const runner = input.runner ?? defaultRunner;
  const repoRoot = await assertGitRepo(runner, path.resolve(input.workspacePath.trim()));
  const pruned: string[] = [];
  for (const id of input.objectiveIds) {
    const ref = refFor(id);
    const result = await gitOk(runner, repoRoot, ['update-ref', '-d', ref]);
    if (result.ok) pruned.push(id);
  }
  return { pruned };
}
