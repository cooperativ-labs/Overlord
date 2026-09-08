import { useState } from 'react';

import type { MissionDetailDto } from '../../shared/contract.ts';
import { ApiRequestError } from '../lib/api.ts';
import { useBranchAction, useGenerateCommitMessage } from '../lib/queries.ts';

import type { BranchActionName } from './use-branch-panel-view.ts';

export interface BranchErrorView {
  title: string;
  instruction: string;
  detail?: string;
}

export function shouldRequestBusyConfirmation(err: unknown, confirmBusy: boolean): boolean {
  return err instanceof ApiRequestError && err.code === 'BRANCH_BUSY_EXECUTING' && !confirmBusy;
}

export function describeBranchError(err: unknown, parent: string): BranchErrorView {
  if (!(err instanceof ApiRequestError)) {
    return {
      title: 'Branch action failed',
      instruction: err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    };
  }
  switch (err.code) {
    case 'BRANCH_MERGE_CONFLICT':
      return {
        title: 'Merge conflicts need resolving',
        instruction: `Open the branch's worktree, resolve the conflicting files, commit them, then run "Merge in ${parent}" again.`,
        detail: err.detail
      };
    case 'BRANCH_DIRTY':
      return {
        title: 'Uncommitted changes',
        instruction: 'Commit or discard the changes in the worktree, then try again.',
        detail: err.detail
      };
    case 'BRANCH_NOTHING_TO_COMMIT':
      return {
        title: 'Nothing to commit',
        instruction: 'The branch worktree has no changes to commit.',
        detail: err.detail
      };
    case 'BRANCH_PARENT_NOT_CHECKED_OUT':
      return {
        title: `${parent} isn't checked out`,
        instruction: `Check out ${parent} in the primary working directory, then try again.`,
        detail: err.detail
      };
    case 'BRANCH_PUSH_FAILED':
      return {
        title: 'Push to origin failed',
        instruction: 'Check your network and git remote credentials, then try again.',
        detail: err.detail
      };
    case 'BRANCH_NO_WORKTREE':
      return {
        title: 'Branch not checked out',
        instruction:
          'This branch is not checked out in any worktree on this device. Run the mission to check it out, or switch the mission to another branch.',
        detail: err.detail
      };
    case 'LOCAL_FILESYSTEM_UNAVAILABLE':
      return {
        title: 'Desktop required',
        instruction:
          'Git actions run on the device holding the checkout. Open Overlord Desktop on that machine, or select it as the execution target.',
        detail: err.detail
      };
    case 'BRANCH_NO_PRIMARY':
      return {
        title: 'No working directory',
        instruction:
          'Connect a primary working directory for this project on this device, then try again.',
        detail: err.detail
      };
    case 'LOCAL_TARGET_REQUIRED':
      return {
        title: 'Desktop required',
        instruction:
          'Open Overlord Desktop on this machine to run git branch actions against linked checkouts.',
        detail: err.detail
      };
    default:
      return { title: 'Branch action failed', instruction: err.message };
  }
}

export function useBranchActions({
  mission,
  parent,
  isExecuting
}: {
  mission: MissionDetailDto;
  parent: string;
  isExecuting: boolean;
}) {
  const branchAction = useBranchAction(mission);
  const generateCommitMessage = useGenerateCommitMessage(mission);
  const [actionError, setActionError] = useState<BranchErrorView | null>(null);
  const [confirmAction, setConfirmAction] = useState<BranchActionName | null>(null);
  const [commitMessage, setCommitMessage] = useState('');

  async function runAction(
    action: BranchActionName,
    confirmBusy: boolean,
    message?: string
  ): Promise<void> {
    setActionError(null);
    try {
      await branchAction.mutateAsync({ action, confirmBusy, message });
      setConfirmAction(null);
      if (action === 'commit') setCommitMessage('');
    } catch (err) {
      if (shouldRequestBusyConfirmation(err, confirmBusy)) {
        setConfirmAction(action);
        return;
      }
      setConfirmAction(null);
      setActionError(describeBranchError(err, parent));
    }
  }

  function handleAction(action: BranchActionName, message?: string): void {
    if (isExecuting) {
      setActionError(null);
      setConfirmAction(action);
      return;
    }
    void runAction(action, false, message);
  }

  function handleGenerateCommitMessage(): void {
    if (generateCommitMessage.isPending || branchAction.isPending) return;
    generateCommitMessage.mutate(undefined, {
      onSuccess: result => setCommitMessage(result.message)
    });
  }

  return {
    actionError,
    branchAction,
    commitMessage,
    commitMessageValid: commitMessage.trim().length > 0,
    confirmAction,
    generateCommitMessage,
    handleAction,
    handleGenerateCommitMessage,
    runAction,
    setActionError,
    setCommitMessage,
    setConfirmAction
  };
}
