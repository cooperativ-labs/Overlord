import { useMemo } from 'react';

import type { MissionBranchDto, MissionDetailDto } from '../../shared/contract.ts';
import { useLocalTargetUnavailable } from '../lib/local-target-client.ts';
import {
  hasPendingLocalTargetMutation,
  useIsRemoteExecutionTargetForProject
} from '../lib/local-target-remote.ts';

export type BranchActionName = 'integrate' | 'commit' | 'push_parent' | 'publish';

export interface BranchPanelView {
  actionLabels: Record<BranchActionName, string>;
  branch: MissionBranchDto;
  canConfigureBranch: boolean;
  canRevertToBase: boolean;
  gitUnavailable: boolean;
  hasActions: boolean;
  isExecuting: boolean;
  isMerged: boolean;
  isRemoteTarget: boolean;
  localTargetUnavailable: boolean;
  notCheckedOutHere: boolean;
  parent: string;
  pendingMutation: boolean;
  prCommand: string;
  showBranchIdentity: boolean;
  showCommit: boolean;
  showCreatePr: boolean;
  showIntegrate: boolean;
  showPublish: boolean;
  showPushParent: boolean;
}

export function deriveBranchPanelView({
  branch,
  localTargetUnavailable,
  isRemoteTarget,
  pendingMutation,
  isExecuting
}: {
  branch: MissionBranchDto;
  localTargetUnavailable: boolean;
  isRemoteTarget: boolean;
  pendingMutation: boolean;
  isExecuting: boolean;
}): BranchPanelView {
  const canConfigureBranch = branch.status === 'pending';
  const isMerged = branch.status === 'merged' || branch.status === 'merged_unpushed';
  const notCheckedOutHere =
    branch.observationSource === 'client' && !canConfigureBranch && branch.worktreePath === null;
  const canRevertToBase =
    !branch.worktreeAutomationEnabled &&
    branch.worktreePreference !== null &&
    branch.status === 'pending';
  const parent = branch.baseBranch ?? 'main';
  const onMergeableBranch = branch.status === 'created' || branch.status === 'published';
  const showCommit = onMergeableBranch && branch.dirty;
  const showIntegrate = onMergeableBranch && !branch.dirty;
  const showPushParent = branch.status === 'merged_unpushed';
  const showPublish =
    branch.status === 'created' ||
    (branch.status === 'published' && branch.hasUnpushedCommits === true);
  const showCreatePr = branch.status === 'published';
  const gitUnavailable =
    (localTargetUnavailable && !isRemoteTarget && branch.status !== 'pending') ||
    pendingMutation ||
    notCheckedOutHere;

  return {
    actionLabels: {
      integrate: `Merge in ${parent}`,
      commit: 'Commit changes',
      push_parent: `Push ${parent}`,
      publish: 'Publish'
    },
    branch,
    canConfigureBranch,
    canRevertToBase,
    gitUnavailable,
    hasActions: (showIntegrate || showPushParent || showPublish) && !gitUnavailable,
    isExecuting,
    isMerged,
    isRemoteTarget,
    localTargetUnavailable,
    notCheckedOutHere,
    parent,
    pendingMutation,
    prCommand: `gh pr create --base ${parent} --head ${branch.name} --fill --web`,
    showBranchIdentity: !canConfigureBranch,
    showCommit,
    showCreatePr,
    showIntegrate,
    showPublish,
    showPushParent
  };
}

export function useBranchPanelView(mission: MissionDetailDto): BranchPanelView | null {
  const localTargetUnavailable = useLocalTargetUnavailable();
  const isRemoteTarget = useIsRemoteExecutionTargetForProject(
    mission.projectId,
    mission.workspaceId
  );
  const pendingMutation = hasPendingLocalTargetMutation(mission.executionRequests);
  const branch = mission.branch;

  return useMemo(() => {
    if (!branch) return null;
    return deriveBranchPanelView({
      branch,
      localTargetUnavailable,
      isRemoteTarget,
      pendingMutation,
      isExecuting: mission.executionRequests.length > 0
    });
  }, [
    branch,
    isRemoteTarget,
    localTargetUnavailable,
    mission.executionRequests.length,
    pendingMutation
  ]);
}
