import { useEffect, useState } from 'react';

import {
  useDeleteInboxItem,
  useLaunchObjective,
  usePromoteInboxItem,
  useUpdateInboxItem,
  useUpdateObjective
} from '@/lib/queries.ts';

import type { InboxItemDto, MissionDetailDto } from '../../../shared/contract.ts';

import { type InboxCardPendingAction, submitUnassignedInboxItem } from './inbox-card-actions.ts';
import { inboxCardShellStateProps, useInboxCardState } from './use-inbox-card-state.ts';

/**
 * Form state and mutation wiring for an unassigned Inbox capture. Returns the
 * props {@link InboxCardShell} needs, minus the variant-specific chrome.
 */
export function useUnassignedInboxCard({
  item,
  onPromoted,
  onSaved
}: {
  item: InboxItemDto;
  onPromoted: (mission: MissionDetailDto) => void;
  onSaved?: () => void;
}) {
  const updateInbox = useUpdateInboxItem();
  const promote = usePromoteInboxItem();
  const remove = useDeleteInboxItem();
  const launchObjective = useLaunchObjective();
  const updateObjective = useUpdateObjective();

  const [instruction, setInstruction] = useState(item.objectives[0] ?? item.title);
  const [dueDatetime, setDueDatetime] = useState<string | null>(item.dueDatetime);
  const [projectId, setProjectId] = useState('');
  const [resourceKey, setResourceKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<InboxCardPendingAction | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setInstruction(item.objectives[0] ?? item.title);
    setDueDatetime(item.dueDatetime);
  }, [item.id, item.objectives, item.title, item.dueDatetime]);

  const state = useInboxCardState({
    projectId,
    workspaceId: undefined,
    resourceKey,
    instruction,
    isBusy: pendingAction !== null
  });

  /**
   * The due date saves on its own rather than waiting for Save, so an unassigned
   * capture can be scheduled without also committing an in-progress text edit.
   * Promotion carries `due_datetime` onto the mission, so this survives Run too.
   */
  async function persistDueDatetime(next: string | null) {
    await updateInbox.mutateAsync({ id: item.id, body: { dueDatetime: next } });
    setDueDatetime(next);
  }

  async function submit(shouldLaunch: boolean) {
    const text = instruction.trim();
    if (!text || (projectId && !state.selectionLoaded) || state.isBusy) return;

    setPendingAction(shouldLaunch ? 'run' : 'save');
    setSubmitError(null);

    try {
      const mission = await submitUnassignedInboxItem(
        {
          itemId: item.id,
          text,
          projectId,
          resourceKey,
          shouldLaunch,
          gate: state,
          selection: state.selection,
          explicitLaunchConfigs: state.explicitLaunchConfigs
        },
        {
          updateInbox: updateInbox.mutateAsync,
          promote: promote.mutateAsync,
          updateObjective: updateObjective.mutateAsync,
          launchObjective: launchObjective.mutateAsync,
          persistSelectionPreference: state.persistSelectionPreference
        }
      );
      if (mission) {
        onPromoted(mission);
      } else {
        onSaved?.();
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update Inbox item.');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (state.isBusy) return;
    setPendingAction('delete');
    setSubmitError(null);
    try {
      await remove.mutateAsync(item.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to delete Inbox item.');
      setPendingAction(null);
    }
  }

  return {
    ...inboxCardShellStateProps(state),
    instruction,
    onInstructionChange: setInstruction,
    projectId,
    resourceKey,
    onSelectProject: (nextProjectId: string) => {
      setProjectId(nextProjectId);
      setResourceKey(null);
    },
    onSelectInbox: () => {
      setProjectId('');
      setResourceKey(null);
    },
    onResourceChange: setResourceKey,
    dueDatetime,
    onDueDatetimeChange: persistDueDatetime,
    pendingAction,
    submitError,
    onSave: () => void submit(false),
    onRun: () => void submit(true),
    onDelete: () => void handleDelete()
  };
}
