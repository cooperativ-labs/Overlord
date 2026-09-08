import assert from 'node:assert/strict';
import test from 'node:test';

import type { MissionBranchDto, MissionBranchStatus } from '../../shared/contract.ts';
import { ApiRequestError } from '../lib/api.ts';

import { shouldRequestBusyConfirmation } from './use-branch-actions.ts';
import { deriveBranchPanelView } from './use-branch-panel-view.ts';

function branch(overrides: Partial<MissionBranchDto> = {}): MissionBranchDto {
  return {
    name: 'feature/branch-panel',
    baseBranch: 'main',
    worktreePath: '/tmp/branch-panel',
    status: 'pending',
    dirty: false,
    overrideBranch: null,
    worktreeAutomationEnabled: true,
    worktreePreference: null,
    willPrepareBranch: true,
    willUseWorktree: true,
    ...overrides
  };
}

test('characterizes every branch status across dirty, unpublished, and execution states', () => {
  const expected: Record<
    MissionBranchStatus,
    Pick<
      ReturnType<typeof deriveBranchPanelView>,
      'canConfigureBranch' | 'isMerged' | 'showBranchIdentity' | 'showCreatePr' | 'showPushParent'
    >
  > = {
    pending: {
      canConfigureBranch: true,
      isMerged: false,
      showBranchIdentity: false,
      showCreatePr: false,
      showPushParent: false
    },
    created: {
      canConfigureBranch: false,
      isMerged: false,
      showBranchIdentity: true,
      showCreatePr: false,
      showPushParent: false
    },
    published: {
      canConfigureBranch: false,
      isMerged: false,
      showBranchIdentity: true,
      showCreatePr: true,
      showPushParent: false
    },
    merged_unpushed: {
      canConfigureBranch: false,
      isMerged: true,
      showBranchIdentity: true,
      showCreatePr: false,
      showPushParent: true
    },
    merged: {
      canConfigureBranch: false,
      isMerged: true,
      showBranchIdentity: true,
      showCreatePr: false,
      showPushParent: false
    }
  };

  for (const status of Object.keys(expected) as MissionBranchStatus[]) {
    for (const dirty of [false, true]) {
      for (const hasUnpushedCommits of [false, true]) {
        for (const isExecuting of [false, true]) {
          const view = deriveBranchPanelView({
            branch: branch({ status, dirty, hasUnpushedCommits }),
            localTargetUnavailable: false,
            isRemoteTarget: false,
            pendingMutation: false,
            isExecuting
          });
          const mergeable = status === 'created' || status === 'published';

          assert.deepEqual(
            {
              canConfigureBranch: view.canConfigureBranch,
              isMerged: view.isMerged,
              showBranchIdentity: view.showBranchIdentity,
              showCreatePr: view.showCreatePr,
              showPushParent: view.showPushParent
            },
            expected[status]
          );
          assert.equal(view.showCommit, mergeable && dirty);
          assert.equal(view.showIntegrate, mergeable && !dirty);
          assert.equal(
            view.showPublish,
            status === 'created' || (status === 'published' && hasUnpushedCommits)
          );
          assert.equal(view.isExecuting, isExecuting);
        }
      }
    }
  }
});

test('characterizes unavailable targets and missing local checkouts', () => {
  const created = branch({ status: 'created' });

  assert.equal(
    deriveBranchPanelView({
      branch: created,
      localTargetUnavailable: true,
      isRemoteTarget: false,
      pendingMutation: false,
      isExecuting: false
    }).gitUnavailable,
    true
  );
  assert.equal(
    deriveBranchPanelView({
      branch: created,
      localTargetUnavailable: true,
      isRemoteTarget: true,
      pendingMutation: false,
      isExecuting: false
    }).gitUnavailable,
    false
  );
  assert.equal(
    deriveBranchPanelView({
      branch: branch({
        status: 'published',
        observationSource: 'client',
        worktreePath: null
      }),
      localTargetUnavailable: false,
      isRemoteTarget: false,
      pendingMutation: false,
      isExecuting: false
    }).gitUnavailable,
    true
  );
});

test('characterizes busy-conflict recovery before an action is retried with confirmation', () => {
  const busy = new ApiRequestError('Branch is busy', 409, 'BRANCH_BUSY_EXECUTING');

  assert.equal(shouldRequestBusyConfirmation(busy, false), true);
  assert.equal(shouldRequestBusyConfirmation(busy, true), false);
  assert.equal(shouldRequestBusyConfirmation(new Error('Branch is busy'), false), false);
});
