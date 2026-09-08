import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { api } from '@/lib/api.ts';
import {
  useAccessibleWorkspaces,
  useAllProjects,
  useDeleteInboxItem,
  useInboxItems,
  useInboxMissions,
  useSetMissionStatus
} from '@/lib/queries.ts';
import { keys } from '@/lib/query-keys.ts';

import type { MissionDetailDto, ProjectStatusDto } from '../../../shared/contract.ts';
import { resolveProjectStatusForColumn } from '../../pages/my-missions-columns.ts';

import { INBOX_TASK_GROUP_STYLES } from './inbox-task-group-styles.ts';
import {
  dueDatetimeForDayOffset,
  groupInboxTasks,
  type InboxTaskGroupKey
} from './inbox-task-groups.ts';
import { InboxPromotedMissionRow, InboxTriageMissionRow } from './InboxMissionRow.tsx';
import { InboxQuickAdd } from './InboxQuickAdd.tsx';
import { InboxTaskGroup } from './InboxTaskGroup.tsx';
import { InboxTaskRow } from './InboxTaskRow.tsx';

/** How long a checked-off task lingers with Undo before it is deleted. */
const COMPLETE_UNDO_MS = 5000;

/**
 * The Inbox as a task list. Private captures and cross-workspace triage
 * missions share one set of due-state buckets, each row is a single line,
 * and the heavier capture editor (project, agent, resource, Run) opens
 * inline only for the row you click. The data model is unchanged: captures
 * are still `inbox_items` and become ordinary missions on promotion.
 */
export function InboxTaskList() {
  const inbox = useInboxItems();
  const inboxMissions = useInboxMissions();
  const projectsQ = useAllProjects();
  const workspaces = useAccessibleWorkspaces();
  const remove = useDeleteInboxItem();
  const setMissionStatus = useSetMissionStatus();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<InboxTaskGroupKey>>(() => new Set());
  // Promoted captures stay mounted for this visit so assigning a project
  // unlocks agent/run controls in place instead of yanking the row away.
  const [promotedByInboxId, setPromotedByInboxId] = useState<Map<string, MissionDetailDto>>(
    () => new Map()
  );
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set());
  const completeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [quickAddDue, setQuickAddDue] = useState<string | null>(null);
  const [quickAddHint, setQuickAddHint] = useState<string | null>(null);
  const [quickAddFocus, setQuickAddFocus] = useState(0);

  const workspaceIds = useMemo(() => workspaces.map(workspace => workspace.id), [workspaces]);
  const statusQueries = useQueries({
    queries: workspaceIds.map(id => ({
      queryKey: keys.workspaceProjectStatuses(id),
      queryFn: () => api.listWorkspaceProjectStatuses(id),
      enabled: Boolean(id)
    }))
  });
  const statusesByProject = useMemo(() => {
    const map = new Map<string, ProjectStatusDto[]>();
    for (const query of statusQueries) {
      for (const status of query.data ?? []) {
        const statuses = map.get(status.projectId) ?? [];
        statuses.push(status);
        map.set(status.projectId, statuses);
      }
    }
    return map;
  }, [statusQueries]);

  const projectById = useMemo(
    () => new Map(projectsQ.data.map(project => [project.id, project])),
    [projectsQ.data]
  );

  // A capture promoted on this visit may immediately qualify for triage (due
  // today, say); its sticky row already shows it, so keep it out of the buckets.
  const missions = useMemo(() => {
    const promotedMissionIds = new Set([...promotedByInboxId.values()].map(mission => mission.id));
    return (inboxMissions.data?.missions ?? []).filter(
      mission => !promotedMissionIds.has(mission.id)
    );
  }, [inboxMissions.data, promotedByInboxId]);
  const groups = useMemo(
    () =>
      groupInboxTasks({
        items: inbox.data ?? [],
        missions,
        excludeItemIds: new Set(promotedByInboxId.keys())
      }),
    [inbox.data, missions, promotedByInboxId]
  );
  const promotedRows = useMemo(() => [...promotedByInboxId.entries()], [promotedByInboxId]);

  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0) + promotedRows.length;
  const isLoading = inbox.isLoading || inboxMissions.isLoading;
  const isEmpty = !isLoading && rowCount === 0;

  const toggleCollapse = useCallback((key: InboxTaskGroupKey) => {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId(current => (current === id ? null : id));
  }, []);

  const openQuickAdd = useCallback((key: InboxTaskGroupKey) => {
    const style = INBOX_TASK_GROUP_STYLES[key];
    setQuickAddDue(
      style.quickAddDayOffset === null ? null : dueDatetimeForDayOffset(style.quickAddDayOffset)
    );
    setQuickAddHint(style.quickAddHint);
    setQuickAddFocus(count => count + 1);
  }, []);

  /**
   * Checking a capture off removes it — there is no "done" state on a private
   * capture, and finished work that should be remembered belongs on a project
   * as a mission. The row lingers with Undo for a few seconds first.
   */
  const completeTask = useCallback(
    (id: string) => {
      if (completeTimers.current.has(id)) return;
      setCompletingIds(previous => new Set(previous).add(id));
      setExpandedId(current => (current === id ? null : current));
      const timer = setTimeout(() => {
        completeTimers.current.delete(id);
        remove.mutate(id, {
          onSettled: () => {
            setCompletingIds(previous => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            });
          }
        });
      }, COMPLETE_UNDO_MS);
      completeTimers.current.set(id, timer);
    },
    [remove]
  );

  const undoComplete = useCallback((id: string) => {
    const timer = completeTimers.current.get(id);
    if (timer) clearTimeout(timer);
    completeTimers.current.delete(id);
    setCompletingIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  // Leaving the page flushes pending completions rather than silently
  // forgetting them: the user checked the box and saw it strike through.
  const removeRef = useRef(remove);
  removeRef.current = remove;
  useEffect(() => {
    const timers = completeTimers.current;
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        removeRef.current.mutate(id);
      }
      timers.clear();
    };
  }, []);

  const handlePromoted = useCallback((inboxId: string, mission: MissionDetailDto) => {
    setPromotedByInboxId(current => {
      const next = new Map(current);
      next.set(inboxId, mission);
      return next;
    });
    setExpandedId(current => (current === inboxId ? mission.id : current));
  }, []);

  const completeTriageMission = useCallback(
    (missionId: string) => {
      const mission = missions.find(candidate => candidate.id === missionId);
      if (!mission) return;
      const completeStatusId = resolveProjectStatusForColumn(
        statusesByProject.get(mission.projectId) ?? [],
        'complete'
      );
      if (!completeStatusId) return;
      void setMissionStatus.mutateAsync({ missionId, statusId: completeStatusId });
    },
    [missions, statusesByProject, setMissionStatus]
  );

  return (
    <div className="flex flex-col gap-3">
      <InboxQuickAdd
        dueDatetime={quickAddDue}
        onDueDatetimeChange={next => {
          setQuickAddDue(next);
          setQuickAddHint(null);
        }}
        hint={quickAddHint}
        focusTrigger={quickAddFocus}
      />

      {isLoading ? <p className="px-1 text-sm text-(--color-ink-dim)">Loading tasks…</p> : null}

      {promotedRows.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          {promotedRows.map(([inboxId, mission]) => {
            const project = projectById.get(mission.projectId);
            const completeStatusId = resolveProjectStatusForColumn(mission.statuses, 'complete');
            return (
              <InboxPromotedMissionRow
                key={inboxId}
                mission={mission}
                projectName={project?.name ?? 'project'}
                projectColor={project?.color ?? null}
                isExpanded={expandedId === mission.id}
                onToggleExpanded={() => toggleExpanded(mission.id)}
                onComplete={
                  completeStatusId
                    ? () =>
                        void setMissionStatus.mutateAsync({
                          missionId: mission.id,
                          statusId: completeStatusId
                        })
                    : undefined
                }
                expanded={<InboxMissionCard variant="mission" mission={mission} />}
              />
            );
          })}
        </section>
      ) : null}

      {groups.map(group => (
        <InboxTaskGroup
          key={group.key}
          groupKey={group.key}
          count={group.rows.length}
          isCollapsed={collapsed.has(group.key)}
          onToggleCollapse={toggleCollapse}
          onQuickAdd={
            group.key === 'overdue' || group.key === 'agent_next' ? undefined : openQuickAdd
          }
        >
          {group.rows.map(row =>
            row.kind === 'task' ? (
              <InboxTaskRow
                key={row.id}
                item={row.item}
                isExpanded={expandedId === row.id}
                onToggleExpanded={() => toggleExpanded(row.id)}
                isCompleting={completingIds.has(row.id)}
                onComplete={() => completeTask(row.id)}
                onUndoComplete={() => undoComplete(row.id)}
                onDelete={() => remove.mutate(row.id)}
                onPromoted={mission => handlePromoted(row.id, mission)}
              />
            ) : (
              <InboxTriageMissionRow
                key={row.id}
                mission={row.mission}
                onComplete={completeTriageMission}
              />
            )
          )}
        </InboxTaskGroup>
      ))}

      {isEmpty ? (
        <p className="px-1 text-sm text-(--color-ink-dim) text-pretty">
          Nothing to do. Add a task above to capture it privately, or wait for agent-filed Next
          missions and work that is overdue or due today or tomorrow to appear.
        </p>
      ) : null}
    </div>
  );
}
