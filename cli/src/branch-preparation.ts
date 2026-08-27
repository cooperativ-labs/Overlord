import { parseObjectiveRef } from '@overlord/contract';
import { resolveManagedWorktreeRoot } from '@overlord/core/service/local-target/worktree-git';
import { deriveProjectResourceKey } from '@overlord/core/service/project-resource-key';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { type BranchDecision, type BranchIsolation, planMissionBranch } from './branch-planning.js';
import type { CliRuntime } from './runtime.js';

export type BranchPreparationOptions = {
  missionId: string;
  workingDirectory: string;
  /** Logical project resource key for worktree path planning. */
  resourceKey?: string | null;
  /** Objective being launched; used to resolve resourceKey from the mission payload. */
  objectiveId?: string | null;
  /**
   * The workspace-wide worktree/branch automation setting. Used as a fallback to
   * recompute the mission's effective decision when the mission DTO does not
   * carry the resolved `willPrepareBranch`/`willUseWorktree` flags.
   */
  automationEnabled: boolean;
  /** No git side-effects; used for launch previews. */
  dryRun?: boolean;
  /** The `--no-worktree` flag: downgrade a worktree decision to a branch-only checkout. */
  noWorktree?: boolean;
  overrideBranch?: string | null;
};

export type BranchPreparationResult = {
  workingDirectory: string;
  branchAutomation: BranchAutomationPayload | null;
};

export type BranchAutomationPayload = {
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  resourceKey: string;
  action: BranchDecision['action'];
  cycle: number;
  /**
   * True when this branch belongs to one objective running in parallel with a
   * sibling on the same resource, rather than to the mission as a whole. The
   * backend records it on `objectives.branch` but leaves `missions.active_branch`
   * (and the mission-level branch observation) pointing at the shared mission
   * branch.
   */
  isolated?: boolean;
};

export type MissionShape = {
  title?: unknown;
  sequenceNumber?: unknown;
  sequence?: unknown;
  projectId?: unknown;
  projectSlug?: unknown;
  project?: { slug?: unknown };
  allowParallelObjectives?: unknown;
  objectives?: Array<{
    id?: unknown;
    resourceKey?: unknown;
    state?: unknown;
    displayKey?: unknown;
  }>;
  branch?: {
    name?: unknown;
    status?: unknown;
    baseBranch?: unknown;
    overrideBranch?: unknown;
    worktreePreference?: unknown;
    willPrepareBranch?: unknown;
    willUseWorktree?: unknown;
  } | null;
};

type ProjectShape = {
  id?: unknown;
  slug?: unknown;
};

function runGit(cwd: string, args: string[], options: { optional?: boolean } = {}): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    }).trim();
  } catch (error) {
    if (options.optional) return '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${message}`, { cause: error });
  }
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function resolveGitRoot(workingDirectory: string): string {
  const root = runGit(workingDirectory, ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error(`${workingDirectory} is not inside a git repository.`);
  return path.resolve(root);
}

function repoDefaultBranch(gitRoot: string): string {
  const symbolic = runGit(gitRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    optional: true
  });
  const fromOrigin = symbolic.replace(/^origin\//, '').trim();
  if (fromOrigin) return fromOrigin;
  const local = lines(runGit(gitRoot, ['branch', '--format=%(refname:short)'], { optional: true }));
  if (local.includes('main')) return 'main';
  if (local.includes('master')) return 'master';
  return local[0] ?? 'main';
}

function mainWorktreeBranch(gitRoot: string): string | null {
  const out = runGit(gitRoot, ['worktree', 'list', '--porcelain'], { optional: true });
  let inMainWorktree = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (inMainWorktree) break;
      inMainWorktree = true;
      continue;
    }
    if (!inMainWorktree || !line.startsWith('branch ')) continue;
    const branch = line
      .slice('branch '.length)
      .trim()
      .replace(/^refs\/heads\//, '');
    return branch || null;
  }
  const current = runGit(gitRoot, ['branch', '--show-current'], { optional: true });
  return current || null;
}

function refExists(gitRoot: string, ref: string): boolean {
  return (
    runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], {
      optional: true
    }) !== '' ||
    runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`], {
      optional: true
    }) !== ''
  );
}

// Resolves the base/parent branch to cut from. The project-configured default
// branch (surfaced on the mission as `branch.baseBranch`) wins when it actually
// exists in this checkout. Otherwise, use the user's primary checkout branch
// (the main worktree, not a linked worktree the runner may be standing in) before
// falling back to the repo's git default.
function resolveBaseBranch(gitRoot: string, mission: MissionShape): string {
  const configured = mission.branch?.baseBranch;
  if (typeof configured === 'string' && configured.trim()) {
    const base = configured.trim();
    if (refExists(gitRoot, base)) return base;
  }
  const checkedOut = mainWorktreeBranch(gitRoot);
  if (checkedOut && refExists(gitRoot, checkedOut)) return checkedOut;
  return repoDefaultBranch(gitRoot);
}

// Every checkout of this repo (the primary repo first, then linked worktrees),
// keyed by the branch it has checked out.
function worktreeCheckouts(gitRoot: string): Map<string, string> {
  const checkouts = new Map<string, string>();
  let currentPath: string | null = null;
  for (const line of lines(
    runGit(gitRoot, ['worktree', 'list', '--porcelain'], { optional: true })
  )) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line.startsWith('branch ') && currentPath) {
      const branch = line.replace(/^branch refs\/heads\//, '');
      if (branch && !checkouts.has(branch)) checkouts.set(branch, currentPath);
    }
  }
  return checkouts;
}

function currentWorktrees(gitRoot: string): string[] {
  return [...worktreeCheckouts(gitRoot).keys()];
}

// Where `branch` is already checked out — the primary repo or a linked
// worktree — or null when it is checked out nowhere. Git refuses to check one
// branch out twice, so an existing checkout is always the place to work.
function existingCheckout(gitRoot: string, branch: string): string | null {
  return worktreeCheckouts(gitRoot).get(branch) ?? null;
}

function revParse(gitRoot: string, ref: string): string {
  return runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    optional: true
  }).trim();
}

// The set of commit SHAs on `base`'s first-parent trunk — the linear backbone you
// walk by always following the first parent. Overlord's merge-with-parent flow
// advances the parent with a `--no-ff` merge commit whose SECOND parent is the
// branch tip, so a genuinely merged branch tip is NOT on this trunk; a branch the
// base merely advanced past linearly (e.g. an empty mission branch) stays on it.
function firstParentTrunk(gitRoot: string, base: string): Set<string> {
  return new Set(lines(runGit(gitRoot, ['rev-list', '--first-parent', base], { optional: true })));
}

// Branches genuinely merged into `base`: contained in the base AND off its
// first-parent trunk (they landed via the `--no-ff` merge commit). Plain
// `git branch --merged <base>` lists every branch whose tip is reachable from the
// base — including freshly-cut/empty ones the base advanced past — which would make
// the planner treat the mission's established (but un-merged) branch as merged and
// spin up a new cycle branch for each objective. Filtering to off-trunk tips keeps
// objectives on the same branch until it has actually been merged into its parent.
// Mirrors the webapp's `branchMergedIntoBase` divergence/first-parent rule.
export function computeMergedBranches(gitRoot: string, base: string): string[] {
  const localTrunk = firstParentTrunk(gitRoot, base);
  const remoteTrunk = firstParentTrunk(gitRoot, `origin/${base}`);
  const result: string[] = [];
  const collect = (refArgs: string[], trunk: Set<string>): void => {
    for (const branch of lines(runGit(gitRoot, refArgs, { optional: true }))) {
      const sha = revParse(gitRoot, branch);
      // On the first-parent trunk ⇒ a plain ancestor, not a real merge ⇒ skip.
      if (sha && trunk.has(sha)) continue;
      result.push(branch);
    }
  };
  collect(['branch', '--merged', base, '--format=%(refname:short)'], localTrunk);
  collect(['branch', '-r', '--merged', `origin/${base}`, '--format=%(refname:short)'], remoteTrunk);
  return result;
}

function repoRefs(gitRoot: string, base: string) {
  return {
    local: lines(runGit(gitRoot, ['branch', '--format=%(refname:short)'], { optional: true })),
    remote: lines(
      runGit(gitRoot, ['branch', '-r', '--format=%(refname:short)'], { optional: true })
    ),
    merged: computeMergedBranches(gitRoot, base),
    checkedOut: currentWorktrees(gitRoot)
  };
}

function worktreeBranch(worktreePath: string): string | null {
  const inside = runGit(worktreePath, ['rev-parse', '--is-inside-work-tree'], { optional: true });
  if (inside !== 'true') return null;
  const branch = runGit(worktreePath, ['branch', '--show-current'], { optional: true });
  return branch || null;
}

function readMissionProjectSlug(mission: MissionShape): string | null {
  const slug = mission.project?.slug;
  if (typeof slug === 'string' && slug.trim()) return slug.trim();
  if (typeof mission.projectSlug === 'string' && mission.projectSlug.trim()) {
    return mission.projectSlug.trim();
  }
  return null;
}

export async function resolveMissionProjectSlug({
  runtime,
  mission
}: {
  runtime: CliRuntime;
  mission: MissionShape;
}): Promise<string> {
  const embedded = readMissionProjectSlug(mission);
  if (embedded) return embedded;

  const projectId = typeof mission.projectId === 'string' ? mission.projectId.trim() : '';
  if (projectId) {
    try {
      const project = (await runtime.backend.get(
        `/api/projects/${encodeURIComponent(projectId)}`
      )) as ProjectShape;
      if (typeof project?.slug === 'string' && project.slug.trim()) return project.slug.trim();
    } catch {
      // Keep branch preparation best-effort for older or restricted backends.
    }
  }

  return 'project';
}

function recordedMissionBranch(mission: MissionShape): string | null {
  const branch = mission.branch;
  if (!branch || branch.status === 'pending') return null;
  return typeof branch.name === 'string' && branch.name.trim() ? branch.name.trim() : null;
}

// A branch the user pinned in the mission panel to override the planner's default
// (MissionBranchDto.overrideBranch). The explicit `--branch` flag still wins.
function missionOverrideBranch(mission: MissionShape): string | null {
  const override = mission.branch?.overrideBranch;
  return typeof override === 'string' && override.trim() ? override.trim() : null;
}

function missionSequence(mission: MissionShape, missionId: string): number {
  const direct = mission.sequenceNumber ?? mission.sequence;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (typeof direct === 'string') {
    const parsed = Number.parseInt(direct, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const match = missionId.match(/:(\d+)$/);
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

function ensureBranchRef(gitRoot: string, decision: BranchDecision): void {
  if (decision.action === 'reuse') return;
  const check = runGit(gitRoot, ['check-ref-format', '--branch', decision.branch], {
    optional: true
  });
  if (!check) throw new Error(`Invalid branch name: ${decision.branch}`);
}

// Ensures the planned branch has a worktree and returns the directory to work
// in. That is the canonical worktree path, unless the branch is already checked
// out somewhere else — its worktree was removed and the branch checked out in
// the primary repo, say — in which case that existing checkout is used instead
// of failing on git's one-checkout-per-branch rule.
function ensureWorktree(gitRoot: string, decision: BranchDecision): string {
  ensureBranchRef(gitRoot, decision);
  mkdirSync(path.dirname(decision.worktreePath), { recursive: true });

  if (existsSync(decision.worktreePath)) {
    if (!statSync(decision.worktreePath).isDirectory()) {
      throw new Error(`Worktree path exists and is not a directory: ${decision.worktreePath}`);
    }
    const existingBranch = worktreeBranch(decision.worktreePath);
    if (!existingBranch) {
      throw new Error(`Worktree path exists but is not a git worktree: ${decision.worktreePath}`);
    }
    if (existingBranch !== decision.branch) {
      throw new Error(
        `Worktree path is checked out on ${existingBranch}, expected ${decision.branch}: ${decision.worktreePath}`
      );
    }
    return decision.worktreePath;
  }

  // The worktree directory is gone but git may still hold a stale registration
  // for this path (e.g. it was purged from Settings → Worktrees, or deleted
  // out-of-band). Prune first so re-adding the same path for a follow-on
  // objective succeeds instead of failing with "already registered".
  runGit(gitRoot, ['worktree', 'prune'], { optional: true });

  if (decision.action === 'reuse') {
    const checkout = existingCheckout(gitRoot, decision.branch);
    if (checkout) return checkout;
    runGit(gitRoot, ['worktree', 'add', decision.worktreePath, decision.branch]);
    return decision.worktreePath;
  }
  runGit(gitRoot, ['worktree', 'add', '-b', decision.branch, decision.worktreePath, decision.from]);
  return decision.worktreePath;
}

// Creates (when needed) and checks out the planned branch directly in the
// primary repo — the "branch without a worktree" mode (coo:9). Unlike
// `ensureWorktree`, no separate worktree directory is added; the branch lives in
// the working repo, switching it onto the branch. Returns the directory to work
// in: the primary repo, or the linked worktree that already has the branch
// checked out (git will not check it out a second time).
function ensureBranchCheckout(gitRoot: string, decision: BranchDecision): string {
  ensureBranchRef(gitRoot, decision);
  const checkout = existingCheckout(gitRoot, decision.branch);
  if (checkout) return checkout;
  const exists = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', decision.branch], {
    optional: true
  });
  if (!exists && decision.action !== 'reuse') {
    runGit(gitRoot, ['branch', decision.branch, decision.from]);
  }
  runGit(gitRoot, ['checkout', decision.branch]);
  return gitRoot;
}

// Resolves the mission's effective branch behavior. Prefers the resolved flags
// the REST layer computes on the mission DTO (`willPrepareBranch`/
// `willUseWorktree`); falls back to recomputing from the per-mission
// `worktreePreference` and the user's automation default for older backends.
function resolveBranchDecision(
  mission: MissionShape,
  automationEnabled: boolean
): { willPrepareBranch: boolean; willUseWorktree: boolean } {
  const branch = mission.branch;
  if (
    branch &&
    typeof branch.willPrepareBranch === 'boolean' &&
    typeof branch.willUseWorktree === 'boolean'
  ) {
    return {
      willPrepareBranch: branch.willPrepareBranch,
      willUseWorktree: branch.willUseWorktree
    };
  }
  const raw = branch?.worktreePreference;
  const preference = raw === 'worktree' || raw === 'branch' ? raw : null;
  const willPrepareBranch =
    preference === 'worktree' ||
    preference === 'branch' ||
    (preference === null && automationEnabled);
  const willUseWorktree = preference === 'worktree' || (preference === null && automationEnabled);
  return { willPrepareBranch, willUseWorktree };
}

function resolveLaunchResourceKey({
  mission,
  options
}: {
  mission: MissionShape;
  options: BranchPreparationOptions;
}): string {
  const explicit = options.resourceKey?.trim();
  if (explicit) return explicit;

  const objectiveId = options.objectiveId?.trim();
  if (objectiveId && Array.isArray(mission.objectives)) {
    const objective = mission.objectives.find(
      candidate => typeof candidate.id === 'string' && candidate.id === objectiveId
    );
    const key = typeof objective?.resourceKey === 'string' ? objective.resourceKey.trim() : '';
    if (key) return key;
  }

  return deriveProjectResourceKey({ directoryPath: options.workingDirectory });
}

// Objective states that hold the sibling-execution slot. Mirrors
// `PARALLEL_BLOCKING_OBJECTIVE_STATES` in the Automations Layer's objective
// lifecycle rules; the Runner Layer reads them off the mission DTO rather than
// importing the automations package.
const PARALLEL_BLOCKING_OBJECTIVE_STATES = ['launching', 'executing', 'pending_delivery'];

const DEFAULT_PRIMARY_RESOURCE_KEY = 'primary';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// The project's primary `resource_key`, used to compare an objective that
// declares no resource against a sibling that names one. Best-effort: an older
// or restricted backend falls back to the contract's `primary` default, which is
// also what the service layer's sibling check uses.
async function resolveProjectPrimaryResourceKey({
  runtime,
  mission
}: {
  runtime: CliRuntime;
  mission: MissionShape;
}): Promise<string> {
  const projectId = readString(mission.projectId);
  if (!projectId) return DEFAULT_PRIMARY_RESOURCE_KEY;
  try {
    const resources = (await runtime.backend.get(
      `/api/projects/${encodeURIComponent(projectId)}/resources`
    )) as Array<{ resourceKey?: unknown; isPrimary?: unknown }> | null;
    if (!Array.isArray(resources)) return DEFAULT_PRIMARY_RESOURCE_KEY;
    const primary = resources.find(resource => resource?.isPrimary === true);
    return readString(primary?.resourceKey) || DEFAULT_PRIMARY_RESOURCE_KEY;
  } catch {
    return DEFAULT_PRIMARY_RESOURCE_KEY;
  }
}

/**
 * Whether this launch must get its own checkout instead of sharing the mission's.
 *
 * Isolation applies only in worktree mode: with worktrees off, the mission works
 * in one checkout by construction and two concurrent objectives deliberately
 * share it (capture attributes files through the objective/session change ledger,
 * not through the checkout). In worktree mode a shared dirty checkout would let
 * two agents clobber each other, so a concurrently launched objective gets its
 * own branch and worktree — the same thing that happens when a mission's branch
 * has already been merged and the next objective needs a fresh one.
 *
 * The suffix is the objective's stable display key, so the decision is
 * deterministic per objective: two objectives launched in the same instant plan
 * different branches without coordinating, and relaunching one lands it back in
 * its own worktree.
 */
export async function resolveBranchIsolation({
  runtime,
  mission,
  options,
  useWorktree
}: {
  runtime: CliRuntime;
  mission: MissionShape;
  options: BranchPreparationOptions;
  useWorktree: boolean;
}): Promise<BranchIsolation | null> {
  if (!useWorktree) return null;
  if (mission.allowParallelObjectives !== true) return null;
  const objectiveId = readString(options.objectiveId);
  if (!objectiveId) return null;

  const objectives = Array.isArray(mission.objectives) ? mission.objectives : [];
  // The pin may arrive as a UUID (runner) or a display id (`ovld launch
  // --objective-id coo:756.k7xm`); missing the display form would silently drop
  // per-objective worktree isolation rather than fail loudly.
  const parsedPin = parseObjectiveRef(objectiveId);
  const pinnedKey =
    parsedPin.kind === 'display_id' || parsedPin.kind === 'display_key'
      ? parsedPin.displayKey
      : null;
  const matchesPin = (candidate: { id?: unknown; displayId?: unknown; displayKey?: unknown }) =>
    readString(candidate.id) === objectiveId ||
    readString(candidate.displayId) === objectiveId ||
    (pinnedKey !== null && readString(candidate.displayKey) === pinnedKey);
  const self = objectives.find(candidate => matchesPin(candidate));
  const objectiveKey = readString(self?.displayKey);
  if (!self || !objectiveKey) return null;

  const primaryResourceKey = await resolveProjectPrimaryResourceKey({ runtime, mission });
  const canonical = (value: unknown): string => readString(value) || primaryResourceKey;
  const selfResourceKey = canonical(self.resourceKey);

  const hasLiveSibling = objectives.some(
    candidate =>
      !matchesPin(candidate) &&
      PARALLEL_BLOCKING_OBJECTIVE_STATES.includes(readString(candidate.state)) &&
      canonical(candidate.resourceKey) === selfResourceKey
  );
  return hasLiveSibling ? { objectiveKey } : null;
}

export async function prepareMissionBranch({
  runtime,
  options
}: {
  runtime: CliRuntime;
  options: BranchPreparationOptions;
}): Promise<BranchPreparationResult> {
  // A launch preview must never touch git.
  if (options.dryRun) {
    return { workingDirectory: options.workingDirectory, branchAutomation: null };
  }

  const gitRoot = resolveGitRoot(options.workingDirectory);
  const mission = (await runtime.backend.get(
    `/api/missions/${encodeURIComponent(options.missionId)}`
  )) as MissionShape;

  const { willPrepareBranch, willUseWorktree } = resolveBranchDecision(
    mission,
    options.automationEnabled
  );
  const overrideFlag = options.overrideBranch?.trim() || null;
  // An explicit `--branch` always forces at least a branch, even for a mission
  // that would otherwise run off its base (the legacy escape hatch).
  const prepareBranch = willPrepareBranch || Boolean(overrideFlag);
  if (!prepareBranch) {
    return { workingDirectory: options.workingDirectory, branchAutomation: null };
  }
  // `--no-worktree` downgrades a worktree decision to a branch-only checkout.
  const useWorktree = willUseWorktree && !options.noWorktree;

  const base = resolveBaseBranch(gitRoot, mission);
  const refs = repoRefs(gitRoot, base);
  // The explicit `--branch` flag wins; otherwise honor the mission's pinned
  // override (set in the mission panel's branch selector).
  const overrideBranch = overrideFlag || missionOverrideBranch(mission);
  const projectSlug = await resolveMissionProjectSlug({ runtime, mission });
  const resourceKey = resolveLaunchResourceKey({ mission, options });
  const isolation = await resolveBranchIsolation({ runtime, mission, options, useWorktree });
  const decision = planMissionBranch({
    mission: {
      title: typeof mission.title === 'string' ? mission.title : 'mission',
      sequence: missionSequence(mission, options.missionId)
    },
    project: { slug: projectSlug },
    resourceKey,
    recordedBranch: recordedMissionBranch(mission),
    base,
    refs,
    worktreeRoot: resolveManagedWorktreeRoot(),
    overrideBranch,
    isolation
  });
  // An explicit branch pin beats isolation inside the planner, so a pinned launch
  // is never reported as isolated even when a sibling is running.
  const isolated = Boolean(isolation) && !overrideBranch;

  if (useWorktree) {
    const worktreePath = ensureWorktree(gitRoot, decision);
    return {
      workingDirectory: worktreePath,
      branchAutomation: {
        branchName: decision.branch,
        baseBranch: decision.baseBranch,
        worktreePath,
        resourceKey,
        action: decision.action,
        cycle: decision.cycle,
        isolated
      }
    };
  }

  // Branch-only: check the branch out in the primary repo (no worktree). The
  // branch's "worktree" is the primary repo itself, which the mission panel's
  // git-state derivation resolves via `git worktree list`.
  const checkoutPath = ensureBranchCheckout(gitRoot, decision);
  return {
    workingDirectory: checkoutPath,
    branchAutomation: {
      branchName: decision.branch,
      baseBranch: decision.baseBranch,
      worktreePath: checkoutPath,
      resourceKey,
      action: decision.action,
      cycle: decision.cycle,
      isolated: false
    }
  };
}
