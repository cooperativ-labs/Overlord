import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  computeMergedBranches,
  prepareMissionBranch,
  resolveMissionProjectSlug
} from '../src/branch-preparation.ts';
import type { CliRuntime } from '../src/runtime.ts';

function runtimeWithProjects(
  projects: Array<{ id: string; slug: string }>,
  calls: string[] = []
): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://localhost.test',
      health: async () => ({ ok: true }),
      get: async path => {
        calls.push(path);
        // Slug resolution reads a single project by id, so the fake backend
        // serves the detail route rather than the collection.
        const match = /^\/api\/projects\/(.+)$/.exec(path);
        if (match) {
          const project = projects.find(entry => entry.id === decodeURIComponent(match[1]!));
          if (!project) throw new Error(`project not found: ${match[1]}`);
          return project as never;
        }
        throw new Error(`unexpected GET ${path}`);
      },
      post: async () => null as never,
      patch: async () => null as never,
      delete: async () => null as never
    },
    close: () => {}
  };
}

test('resolveMissionProjectSlug uses embedded mission project slug when present', async () => {
  const calls: string[] = [];
  const slug = await resolveMissionProjectSlug({
    runtime: runtimeWithProjects([{ id: 'p1', slug: 'from-api' }], calls),
    mission: { projectId: 'p1', project: { slug: 'from-mission' } }
  });

  assert.equal(slug, 'from-mission');
  assert.deepEqual(calls, []);
});

test('resolveMissionProjectSlug reads the slug from the project detail endpoint', async () => {
  const calls: string[] = [];
  const slug = await resolveMissionProjectSlug({
    runtime: runtimeWithProjects(
      [
        { id: 'p1', slug: 'alpha' },
        { id: 'p2', slug: 'overlord' }
      ],
      calls
    ),
    mission: { projectId: 'p2' }
  });

  assert.equal(slug, 'overlord');
  assert.deepEqual(calls, ['/api/projects/p2']);
});

test('resolveMissionProjectSlug falls back for unresolved legacy payloads', async () => {
  const slug = await resolveMissionProjectSlug({
    runtime: runtimeWithProjects([{ id: 'p1', slug: 'alpha' }]),
    mission: { projectId: 'missing' }
  });

  assert.equal(slug, 'project');
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  }).trim();
}

function runtimeForMission(mission: Record<string, unknown>): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://localhost.test',
      health: async () => ({ ok: true }),
      get: async (p: string) => {
        if (p === '/api/projects') return [{ id: 'p1', slug: 'demo' }] as never;
        if (p.startsWith('/api/missions/')) return mission as never;
        throw new Error(`unexpected GET ${p}`);
      },
      post: async () => null as never,
      patch: async () => null as never,
      delete: async () => null as never
    },
    close: () => {}
  };
}

function initRepo(prefix: string): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'base']);
  return repo;
}

function canonicalPath(value: string): string {
  return realpathSync(value);
}

test('prepareMissionBranch creates a worktree when the mission resolves to worktree mode', async () => {
  const repo = initRepo('ovld-prep-worktree-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-wt-root-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  try {
    const result = await prepareMissionBranch({
      runtime: runtimeForMission({
        title: 'Add feature',
        sequence: 7,
        projectId: 'p1',
        project: { slug: 'demo' },
        branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
      }),
      options: {
        missionId: 'coo:7',
        workingDirectory: repo,
        automationEnabled: false
      }
    });
    assert.ok(result.branchAutomation, 'expected a branch automation payload');
    assert.equal(result.workingDirectory, result.branchAutomation?.worktreePath);
    assert.ok(result.workingDirectory.startsWith(worktreeRoot), 'worktree under the worktree root');
    // The branch is checked out in a *separate* worktree, not the primary repo.
    const list = git(repo, ['worktree', 'list', '--porcelain']);
    assert.ok(list.includes(result.workingDirectory), 'a dedicated worktree was registered');
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch reuses a dirty same-mission worktree', async () => {
  const repo = initRepo('ovld-prep-dirty-reuse-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-dirty-reuse-wt-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  try {
    const mission = {
      title: 'Continue dirty work',
      sequence: 15,
      projectId: 'p1',
      project: { slug: 'demo' },
      branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
    };
    const first = await prepareMissionBranch({
      runtime: runtimeForMission(mission),
      options: {
        missionId: 'coo:15',
        workingDirectory: repo,
        automationEnabled: false
      }
    });
    assert.ok(first.branchAutomation, 'expected initial branch automation payload');
    writeFileSync(path.join(first.workingDirectory, 'dirty.txt'), 'uncommitted work\n');
    assert.ok(git(first.workingDirectory, ['status', '--porcelain']).includes('dirty.txt'));

    const second = await prepareMissionBranch({
      runtime: runtimeForMission({
        ...mission,
        branch: {
          ...mission.branch,
          name: first.branchAutomation.branchName,
          status: 'created'
        }
      }),
      options: {
        missionId: 'coo:15',
        workingDirectory: repo,
        automationEnabled: false
      }
    });

    assert.equal(second.workingDirectory, first.workingDirectory);
    assert.equal(second.branchAutomation?.branchName, first.branchAutomation.branchName);
    assert.ok(
      git(second.workingDirectory, ['status', '--porcelain']).includes('dirty.txt'),
      'dirty work is preserved for the next objective'
    );
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch isolates a concurrent objective into its own worktree', async () => {
  const repo = initRepo('ovld-prep-parallel-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-parallel-wt-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  try {
    const objectives = [
      { id: 'obj-a', displayKey: 'k7xm', state: 'draft', resourceKey: null },
      { id: 'obj-b', displayKey: 'q4t9', state: 'draft', resourceKey: null }
    ];
    const mission = {
      title: 'Parallel objectives',
      sequence: 21,
      projectId: 'p1',
      project: { slug: 'demo' },
      allowParallelObjectives: true,
      objectives,
      branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
    };

    const first = await prepareMissionBranch({
      runtime: runtimeForMission(mission),
      options: {
        missionId: 'coo:21',
        workingDirectory: repo,
        objectiveId: 'obj-a',
        automationEnabled: false
      }
    });
    assert.ok(first.branchAutomation);
    assert.equal(first.branchAutomation.branchName, 'parallel-objectives-21');
    assert.equal(
      first.branchAutomation.isolated,
      false,
      'the first objective owns the mission branch'
    );
    writeFileSync(path.join(first.workingDirectory, 'a.txt'), 'objective A work\n');

    // Objective A is now live on the mission branch, so B must not be dropped into
    // A's dirty checkout: it gets its own branch (suffixed with B's display key)
    // cut from the mission branch, in its own worktree.
    const second = await prepareMissionBranch({
      runtime: runtimeForMission({
        ...mission,
        objectives: [{ ...objectives[0]!, state: 'executing' }, objectives[1]!],
        branch: {
          ...mission.branch,
          name: first.branchAutomation.branchName,
          status: 'created'
        }
      }),
      options: {
        missionId: 'coo:21',
        workingDirectory: repo,
        objectiveId: 'obj-b',
        automationEnabled: false
      }
    });

    assert.equal(second.branchAutomation?.branchName, 'parallel-objectives-21-q4t9');
    assert.equal(second.branchAutomation?.isolated, true);
    assert.notEqual(second.workingDirectory, first.workingDirectory);
    assert.equal(
      git(second.workingDirectory, ['status', '--porcelain']),
      '',
      "objective A's uncommitted work is not visible in B's worktree"
    );
    assert.ok(
      git(first.workingDirectory, ['status', '--porcelain']).includes('a.txt'),
      "objective A's worktree is untouched"
    );

    // Relaunching B lands back in B's own worktree rather than cutting another one.
    const relaunch = await prepareMissionBranch({
      runtime: runtimeForMission({
        ...mission,
        objectives: [{ ...objectives[0]!, state: 'executing' }, objectives[1]!],
        branch: {
          ...mission.branch,
          name: first.branchAutomation.branchName,
          status: 'created'
        }
      }),
      options: {
        missionId: 'coo:21',
        workingDirectory: repo,
        objectiveId: 'obj-b',
        automationEnabled: false
      }
    });
    assert.equal(relaunch.workingDirectory, second.workingDirectory);
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch shares one checkout for concurrent objectives without worktrees', async () => {
  const repo = initRepo('ovld-prep-parallel-shared-');
  const objectives = [
    { id: 'obj-a', displayKey: 'k7xm', state: 'executing', resourceKey: null },
    { id: 'obj-b', displayKey: 'q4t9', state: 'draft', resourceKey: null }
  ];
  const result = await prepareMissionBranch({
    runtime: runtimeForMission({
      title: 'Shared checkout',
      sequence: 22,
      projectId: 'p1',
      project: { slug: 'demo' },
      allowParallelObjectives: true,
      objectives,
      branch: {
        baseBranch: 'main',
        willPrepareBranch: true,
        willUseWorktree: false
      }
    }),
    options: {
      missionId: 'coo:22',
      workingDirectory: repo,
      objectiveId: 'obj-b',
      automationEnabled: false
    }
  });

  assert.equal(result.workingDirectory, canonicalPath(repo));
  assert.equal(result.branchAutomation?.branchName, 'shared-checkout-22');
  assert.equal(result.branchAutomation?.isolated, false);
});

test('prepareMissionBranch keeps one worktree for a sibling on a different resource', async () => {
  const repo = initRepo('ovld-prep-parallel-other-resource-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-parallel-other-wt-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  try {
    const result = await prepareMissionBranch({
      runtime: runtimeForMission({
        title: 'Cross repo mission',
        sequence: 23,
        projectId: 'p1',
        project: { slug: 'demo' },
        allowParallelObjectives: true,
        objectives: [
          { id: 'obj-a', displayKey: 'k7xm', state: 'executing', resourceKey: 'mobile' },
          { id: 'obj-b', displayKey: 'q4t9', state: 'draft', resourceKey: 'primary' }
        ],
        branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
      }),
      options: {
        missionId: 'coo:23',
        workingDirectory: repo,
        objectiveId: 'obj-b',
        resourceKey: 'primary',
        automationEnabled: false
      }
    });

    // The live sibling is in another repository; nothing to isolate from here.
    assert.equal(result.branchAutomation?.branchName, 'cross-repo-mission-23');
    assert.equal(result.branchAutomation?.isolated, false);
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch falls back to the primary checkout branch as base', async () => {
  const repo = initRepo('ovld-prep-current-base-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-current-base-wt-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  git(repo, ['checkout', '-q', '-b', 'release/current']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'release base']);

  try {
    const result = await prepareMissionBranch({
      runtime: runtimeForMission({
        title: 'Use checked out base',
        sequence: 12,
        projectId: 'p1',
        project: { slug: 'demo' },
        branch: { willPrepareBranch: true, willUseWorktree: true }
      }),
      options: {
        missionId: 'coo:12',
        workingDirectory: repo,
        automationEnabled: false
      }
    });

    assert.equal(result.branchAutomation?.baseBranch, 'release/current');
    assert.equal(
      git(repo, ['rev-parse', result.branchAutomation!.branchName]),
      git(repo, ['rev-parse', 'release/current'])
    );
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch ignores a linked worktree checkout when resolving the base', async () => {
  const repo = initRepo('ovld-prep-primary-base-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-primary-base-wt-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  git(repo, ['checkout', '-q', '-b', 'release/primary']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'primary base']);
  const linked = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-linked-'));
  git(repo, ['worktree', 'add', '-q', '-b', 'scratch/worktree', linked, 'main']);

  try {
    const result = await prepareMissionBranch({
      runtime: runtimeForMission({
        title: 'Use primary checkout',
        sequence: 13,
        projectId: 'p1',
        project: { slug: 'demo' },
        branch: { willPrepareBranch: true, willUseWorktree: true }
      }),
      options: {
        missionId: 'coo:13',
        workingDirectory: linked,
        automationEnabled: false
      }
    });

    assert.equal(result.branchAutomation?.baseBranch, 'release/primary');
    assert.equal(
      git(repo, ['rev-parse', result.branchAutomation!.branchName]),
      git(repo, ['rev-parse', 'release/primary'])
    );
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch checks the branch out in the primary repo for branch-only mode', async () => {
  const repo = initRepo('ovld-prep-branch-only-');
  const result = await prepareMissionBranch({
    runtime: runtimeForMission({
      title: 'Quick fix',
      sequence: 3,
      projectId: 'p1',
      project: { slug: 'demo' },
      branch: {
        baseBranch: 'main',
        willPrepareBranch: true,
        willUseWorktree: false,
        worktreePreference: 'branch'
      }
    }),
    options: {
      missionId: 'coo:3',
      workingDirectory: repo,
      automationEnabled: false
    }
  });
  assert.ok(result.branchAutomation, 'expected a branch automation payload');
  // Branch-only: the working directory IS the primary repo (no separate worktree).
  assert.equal(canonicalPath(result.workingDirectory), canonicalPath(repo));
  assert.equal(canonicalPath(result.branchAutomation!.worktreePath), canonicalPath(repo));
  // The branch is now checked out in the primary repo.
  assert.equal(git(repo, ['branch', '--show-current']), result.branchAutomation?.branchName);
  // No extra worktree directory was added.
  const worktrees = git(repo, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter(line => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1, 'only the primary repo worktree exists');
});

test('prepareMissionBranch reuses the primary checkout when the worktree is gone', async () => {
  const repo = initRepo('ovld-prep-wt-gone-');
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-wt-gone-root-'));
  process.env.OVERLORD_WORKTREE_ROOT = worktreeRoot;
  try {
    const mission = {
      title: 'Moved to main repo',
      sequence: 21,
      projectId: 'p1',
      project: { slug: 'demo' },
      branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
    };
    const first = await prepareMissionBranch({
      runtime: runtimeForMission(mission),
      options: { missionId: 'coo:21', workingDirectory: repo, automationEnabled: false }
    });
    const branchName = first.branchAutomation!.branchName;
    // The user removed the worktree and checked the branch out in the main repo.
    git(repo, ['worktree', 'remove', first.workingDirectory]);
    git(repo, ['checkout', branchName]);

    const second = await prepareMissionBranch({
      runtime: runtimeForMission({
        ...mission,
        branch: { ...mission.branch, name: branchName, status: 'created' }
      }),
      options: { missionId: 'coo:21', workingDirectory: repo, automationEnabled: false }
    });
    assert.equal(second.branchAutomation?.branchName, branchName);
    assert.equal(canonicalPath(second.workingDirectory), canonicalPath(repo));
    assert.equal(canonicalPath(second.branchAutomation!.worktreePath), canonicalPath(repo));
    assert.equal(git(repo, ['branch', '--show-current']), branchName);
  } finally {
    delete process.env.OVERLORD_WORKTREE_ROOT;
  }
});

test('prepareMissionBranch follows a linked worktree in branch-only mode', async () => {
  const repo = initRepo('ovld-prep-branch-linked-');
  const worktreePath = mkdtempSync(path.join(os.tmpdir(), 'ovld-prep-branch-linked-wt-'));
  git(repo, ['branch', 'pinned']);
  git(repo, ['worktree', 'add', '-f', worktreePath, 'pinned']);
  const result = await prepareMissionBranch({
    runtime: runtimeForMission({
      title: 'Pinned elsewhere',
      sequence: 22,
      projectId: 'p1',
      project: { slug: 'demo' },
      branch: {
        baseBranch: 'main',
        overrideBranch: 'pinned',
        willPrepareBranch: true,
        willUseWorktree: false,
        worktreePreference: 'branch'
      }
    }),
    options: { missionId: 'coo:22', workingDirectory: repo, automationEnabled: false }
  });
  assert.equal(result.branchAutomation?.branchName, 'pinned');
  assert.equal(canonicalPath(result.workingDirectory), canonicalPath(worktreePath));
  // The primary repo stays on main; git cannot check `pinned` out twice.
  assert.equal(git(repo, ['branch', '--show-current']), 'main');
});

test('prepareMissionBranch prepares nothing when the mission runs off its base branch', async () => {
  const repo = initRepo('ovld-prep-off-');
  const result = await prepareMissionBranch({
    runtime: runtimeForMission({
      title: 'No branch',
      sequence: 1,
      projectId: 'p1',
      project: { slug: 'demo' },
      branch: { baseBranch: 'main', willPrepareBranch: false, willUseWorktree: false }
    }),
    options: {
      missionId: 'coo:1',
      workingDirectory: repo,
      automationEnabled: false
    }
  });
  assert.equal(result.branchAutomation, null);
  assert.equal(result.workingDirectory, repo);
  assert.equal(git(repo, ['branch', '--show-current']), 'main');
});

test('prepareMissionBranch never touches git on a dry run', async () => {
  const repo = initRepo('ovld-prep-dryrun-');
  const result = await prepareMissionBranch({
    runtime: runtimeForMission({
      branch: { baseBranch: 'main', willPrepareBranch: true, willUseWorktree: true }
    }),
    options: {
      missionId: 'coo:9',
      workingDirectory: repo,
      automationEnabled: true,
      dryRun: true
    }
  });
  assert.equal(result.branchAutomation, null);
  assert.equal(result.workingDirectory, repo);
  assert.equal(git(repo, ['branch', '--show-current']), 'main');
});

test('computeMergedBranches reports only branches that genuinely landed via merge', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'ovld-merged-branches-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'base']);
  const root = git(repo, ['rev-list', '--max-parents=0', 'main']);

  // An empty established branch cut from the base — no commits of its own.
  git(repo, ['branch', 'empty-1', 'main']);

  // A branch with real work that we merge into main with a --no-ff merge commit
  // (the shape Overlord's merge-with-parent flow produces).
  git(repo, ['branch', 'merged-1', 'main']);
  git(repo, ['checkout', '-q', 'merged-1']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'work']);
  git(repo, ['checkout', '-q', 'main']);
  git(repo, ['merge', '-q', '--no-ff', '-m', 'merge merged-1', 'merged-1']);

  // main has now advanced past empty-1's tip (the root commit), so the base
  // *contains* empty-1 even though it never landed via a merge.
  git(repo, ['merge-base', '--is-ancestor', root, 'main']);

  const merged = computeMergedBranches(repo, 'main');
  // The genuinely-merged branch is reported...
  assert.ok(merged.includes('merged-1'), `expected merged-1 in ${JSON.stringify(merged)}`);
  // ...but the empty branch the base merely advanced past is NOT (so the planner
  // keeps reusing it instead of cutting a new cycle branch per objective).
  assert.ok(!merged.includes('empty-1'), `empty-1 should not be merged: ${JSON.stringify(merged)}`);
});
