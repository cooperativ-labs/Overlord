// The one current-diff implementation (contract v152, coo:1108.zg8m). It backs
// the resource-addressed `readCurrentDiff` capability and supplies the
// `git diff` arguments the commit-message drafter uses, so Overlord has a
// single diff definition: hardened (no external diff, no textconv, no
// configured filters or hooks), submodule-free, colorless, and bounded.

import { runInspectionGit } from './git-run.ts';
import { isSensitiveRepositoryPath, normalizeRepositoryRelativePath } from './repository-paths.ts';
import {
  clampBound,
  inspectRepositoryRoot,
  ReadDeadline,
  REPOSITORY_READ_TARGET_BOUNDS,
  type RepositoryReadFailure
} from './repository-read-git.ts';
import type {
  CurrentDiffData,
  CurrentDiffResult,
  CurrentDiffScope,
  ReadCurrentDiffInput
} from './types.ts';

/**
 * `git diff` arguments for a scope. `base` is the commit or tree compared
 * against for `staged`/`all` (HEAD, or the empty tree before the first
 * commit). Pathspecs are literal and relative to the working directory, and
 * `--relative` keeps a subdirectory resource from reporting the rest of the
 * repository.
 */
export function currentDiffArgs({
  scope,
  base = 'HEAD',
  pathspecs = []
}: {
  scope: CurrentDiffScope;
  base?: string;
  pathspecs?: readonly string[];
}): string[] {
  const args = [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--ignore-submodules=all',
    '--relative'
  ];
  if (scope === 'staged') args.push('--cached', base);
  else if (scope === 'all') args.push(base);
  args.push('--', ...(pathspecs.length > 0 ? pathspecs.map(p => `:(literal)${p}`) : ['.']));
  return args;
}

const SECTION_HEADER = /^diff --git /m;

/** The path a `diff --git` section is about, preferring the `+++`/`---` lines. */
function sectionPaths(section: string): string[] {
  const paths = new Set<string>();
  for (const line of section.split('\n', 12)) {
    const plus = /^\+\+\+ b\/(.*)$/.exec(line);
    const minus = /^--- a\/(.*)$/.exec(line);
    const rename = /^rename (?:from|to) (.*)$/.exec(line);
    const value = plus?.[1] ?? minus?.[1] ?? rename?.[1];
    if (value) paths.add(value.replace(/\t$/, ''));
  }
  if (paths.size === 0) {
    // Mode-only or binary sections have no ---/+++ lines; the header is
    // `diff --git a/X b/X`, symmetric for anything that is not a rename.
    const header = section.split('\n', 1)[0] ?? '';
    const body = header.replace(/^diff --git a\//, '');
    const half = (body.length - 3) / 2;
    if (Number.isInteger(half) && body.slice(half, half + 3) === ' b/') {
      paths.add(body.slice(0, half));
    }
  }
  return [...paths];
}

/**
 * Split a unified diff into per-file sections, withholding every section that
 * touches a sensitive path. Filtering happens on the target, so withheld
 * content never crosses the queue.
 */
export function withholdSensitiveDiffSections(diff: string): {
  diff: string;
  files: string[];
  excludedPaths: string[];
} {
  const files: string[] = [];
  const excludedPaths: string[] = [];
  const parts = diff.split(SECTION_HEADER);
  const kept: string[] = [parts[0] ?? ''];
  for (const part of parts.slice(1)) {
    const section = `diff --git ${part}`;
    const paths = sectionPaths(section);
    if (paths.some(p => isSensitiveRepositoryPath(p))) {
      excludedPaths.push(...paths);
      continue;
    }
    files.push(...paths.slice(-1));
    kept.push(section);
  }
  return { diff: kept.join(''), files, excludedPaths };
}

/** Git's empty tree for this repository's object format (no object is written). */
async function emptyTree(root: string, deadline: ReadDeadline): Promise<string | null> {
  const run = await runInspectionGit({
    cwd: root,
    args: ['hash-object', '-t', 'tree', '--stdin'],
    timeoutMs: deadline.remaining(),
    maxBytes: 256,
    signal: deadline.signal
  });
  return run.exitCode === 0 ? run.stdout.toString('utf8').trim() || null : null;
}

export async function readCurrentDiffGit(
  input: ReadCurrentDiffInput,
  signal?: AbortSignal
): Promise<CurrentDiffResult | RepositoryReadFailure> {
  const deadline = new ReadDeadline(REPOSITORY_READ_TARGET_BOUNDS.commandTimeoutMs, signal);
  const root = await inspectRepositoryRoot(input.repoPath, deadline);
  if (!root.ok) return root;
  const observedAt = () => new Date().toISOString();
  const base = { head: root.head, branch: root.branch, truncated: false };
  if (!root.isGitRepository) {
    return {
      ok: false,
      code: 'NOT_GIT_REPOSITORY',
      message: 'The resource is not a Git checkout.'
    };
  }
  const scope: CurrentDiffScope =
    input.scope === 'staged' || input.scope === 'unstaged' ? input.scope : 'all';
  const requested = Array.isArray(input.relativePaths) ? input.relativePaths : [];
  if (requested.length > REPOSITORY_READ_TARGET_BOUNDS.diffPaths) {
    return {
      ...base,
      outcome: 'denied',
      observedAt: observedAt(),
      message: 'Too many paths.',
      data: null
    };
  }
  const pathspecs: string[] = [];
  for (const entry of requested) {
    const checked = normalizeRepositoryRelativePath(entry);
    if (!checked.ok) {
      return {
        ...base,
        outcome: 'denied',
        observedAt: observedAt(),
        message: checked.reason,
        data: null
      };
    }
    pathspecs.push(checked.relativePath || '.');
  }
  let against = 'HEAD';
  if (scope !== 'unstaged' && root.head === null) {
    const tree = await emptyTree(root.realRoot, deadline);
    if (!tree) {
      return { ok: false, code: 'GIT_COMMAND_FAILED', message: 'Could not resolve the diff base.' };
    }
    against = tree;
  }
  const maxBytes = clampBound(input.maxBytes, REPOSITORY_READ_TARGET_BOUNDS.diffBytes);
  const run = await runInspectionGit({
    cwd: root.realRoot,
    args: currentDiffArgs({ scope, base: against, pathspecs }),
    timeoutMs: deadline.remaining(),
    maxBytes,
    signal,
    filterArgs: root.filterArgs
  });
  if (run.timedOut || run.aborted) {
    return {
      ...base,
      outcome: 'timeout',
      observedAt: observedAt(),
      message: run.aborted ? 'The read was cancelled.' : 'The read timed out on the target.',
      data: null
    };
  }
  if (run.exitCode !== 0 && !run.truncated) {
    return { ok: false, code: 'GIT_COMMAND_FAILED', message: 'git diff failed on the target.' };
  }
  const filtered = withholdSensitiveDiffSections(run.stdout.toString('utf8'));
  const data: CurrentDiffData = { scope, ...filtered };
  return { ...base, outcome: 'ok', observedAt: observedAt(), truncated: run.truncated, data };
}
