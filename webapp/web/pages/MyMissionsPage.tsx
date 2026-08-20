import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useQueries } from '@tanstack/react-query';
import { useMatch, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { NewMissionModal } from '@/components/NewMissionModal.tsx';

import type {
  MyMissionDto,
  MyMissionsColumnType,
  ProjectStatusDto,
  WorkspaceMemberDto
} from '../../shared/contract.ts';
import { Button, EmptyState, Spinner } from '../components/ui.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog.tsx';
import { api } from '../lib/api.ts';
import {
  readMyMissionsProjectFilter,
  writeMyMissionsProjectFilter
} from '../lib/org-preferences.ts';
import { firstObjectiveCreatePayload } from '../lib/project-resources.ts';
import {
  keys,
  useAllProjects,
  useCreateMission,
  useMeta,
  useReorderMyMissions,
  useSetMissionStatus,
  useWorkspaceMyMissions
} from '../lib/queries.ts';

import type { BlankMissionCreateOptions } from './BlankMissionCard.tsx';
import {
  type BoardView,
  buildMissionProjectFilterOptions,
  type ColumnMap,
  getMissionTags,
  resolveColumnMissions
} from './board-shared.ts';
import type { BoardColumnStatus } from './BoardColumn.tsx';
import { MissionCalendarView } from './MissionCalendarView.tsx';
import { MissionListView } from './MissionListView.tsx';
import { MissionProjectFilterDropdown } from './MissionProjectFilterDropdown.tsx';
import { MissionStatusFilterDropdown } from './MissionStatusFilterDropdown.tsx';
import { MissionsViewToggle } from './MissionsViewToggle.tsx';
import { MissionTagFilterDropdown } from './MissionTagFilterDropdown.tsx';
import {
  groupMissionsByStatusType,
  isMyMissionsColumnKey,
  MY_MISSIONS_BOARD_COLUMNS,
  projectsMissingColumnType,
  resolveProjectStatusForColumn
} from './my-missions-columns.ts';
import { MyMissionsColumn } from './MyMissionsColumn.tsx';
import { SortableMissionCard } from './SortableMissionCard.tsx';
import { type MyMissionsDropTarget, useMyMissionsDnd } from './useMyMissionsDnd.ts';

const VIEW_STORAGE_KEY = 'overlord:my-missions-view';
const MY_MISSIONS_VIEWS: BoardView[] = ['board', 'list', 'calendar'];

function readStoredView(): BoardView {
  if (typeof window === 'undefined') return 'board';
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return MY_MISSIONS_VIEWS.includes(value as BoardView) ? (value as BoardView) : 'board';
  } catch {
    return 'board';
  }
}

function storeView(view: BoardView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore private-mode/quota failures; the toggle still works in memory.
  }
}

/**
 * The aggregate My Missions board. Columns are the four shared status *types*
 * (Next / Executing / Review / Completed) rather than project status names,
 * which are project-defined and inconsistent across the organization. A card
 * therefore always has a home column, and a drag resolves to the concrete
 * status of that type inside the card's own project — server-side, in one call
 * that can span several projects and workspaces at once.
 */
export function MyMissionsPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const myMissionsQ = useWorkspaceMyMissions();
  // My Missions spans every workspace of the active organization, so the project
  // filter is gated on the cross-workspace list, which already excludes archived
  // projects (lifecycle defaults to 'active').
  const activeProjectsQ = useAllProjects();
  const createMission = useCreateMission();
  const setMissionStatus = useSetMissionStatus();
  const reorder = useReorderMyMissions();

  const missionMatch = useMatch({ from: '/user/missions/$missionId', shouldThrow: false });
  const selectedMissionId = missionMatch?.params.missionId;

  const workspaces = useMemo(() => meta.data?.workspaces ?? [], [meta.data]);
  const workspaceIds = useMemo(() => workspaces.map(workspace => workspace.id), [workspaces]);
  const activeOrganizationId = meta.data?.organization?.id ?? null;

  // Statuses no longer shape the columns — they are only needed to resolve a
  // status *type* back to a concrete status when creating or completing a
  // mission in a specific project, so the board never waits on them.
  const statusQueries = useQueries({
    queries: workspaceIds.map(id => ({
      queryKey: keys.workspaceProjectStatuses(id),
      queryFn: () => api.listWorkspaceProjectStatuses(id),
      enabled: Boolean(id)
    }))
  });
  const memberQueries = useQueries({
    queries: workspaceIds.map(id => ({
      queryKey: keys.workspaceMembers(id),
      queryFn: () => api.listWorkspaceMembers(id),
      enabled: Boolean(id)
    }))
  });

  const [view, setView] = useState<BoardView>(() => readStoredView());
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedStatusTypes, setSelectedStatusTypes] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectFilterOrganizationId, setProjectFilterOrganizationId] = useState<string | null>(
    null
  );
  const [dropError, setDropError] = useState<{
    columnName: string;
    projectNames: string[];
  } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultDueDate, setDefaultDueDate] = useState<Date | null>(null);

  // Only missions whose status type is one of the four board columns belong on
  // My Missions; draft/blocked/cancelled work stays on its project board.
  const missions = useMemo(
    () => (myMissionsQ.data?.missions ?? []).filter(m => isMyMissionsColumnKey(m.statusType)),
    [myMissionsQ.data]
  );
  const projects = useMemo(() => activeProjectsQ.data ?? [], [activeProjectsQ.data]);

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

  const membersByWorkspaceUserId = useMemo(() => {
    const map = new Map<string, WorkspaceMemberDto>();
    for (const query of memberQueries) {
      for (const member of query.data ?? []) map.set(member.workspaceUserId, member);
    }
    return map;
  }, [memberQueries]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  const missionById = useMemo(() => {
    const map = new Map<string, MyMissionDto>();
    for (const t of missions) map.set(t.id, t);
    return map;
  }, [missions]);

  const activeProjectIds = useMemo(
    () => new Set((activeProjectsQ.data ?? []).map(project => project.id)),
    [activeProjectsQ.data]
  );

  // Only projects the caller actually has missions in are worth filtering by.
  // Derived from the unfiltered set so the option list is stable as filters change.
  const projectFilterOptions = useMemo(
    () => buildMissionProjectFilterOptions(missions, activeProjectIds),
    [missions, activeProjectIds]
  );

  const statusFilterOptions = useMemo(
    () =>
      MY_MISSIONS_BOARD_COLUMNS.map(column => ({
        id: column.key,
        name: column.name,
        type: column.type
      })),
    []
  );

  const tagOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; color: string | null }>();
    for (const mission of missions) {
      for (const tag of getMissionTags(mission)) {
        if (!byId.has(tag.id)) byId.set(tag.id, tag);
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [missions]);

  useEffect(() => {
    if (selectedTagIds.length === 0) return;
    const validIds = new Set(tagOptions.map(tag => tag.id));
    const next = selectedTagIds.filter(id => validIds.has(id));
    if (next.length !== selectedTagIds.length) setSelectedTagIds(next);
  }, [selectedTagIds, tagOptions]);

  useEffect(() => {
    setSelectedProjectIds(
      activeOrganizationId ? readMyMissionsProjectFilter(activeOrganizationId) : []
    );
    setProjectFilterOrganizationId(activeOrganizationId);
  }, [activeOrganizationId]);

  useEffect(() => {
    if (
      projectFilterOrganizationId !== activeOrganizationId ||
      !myMissionsQ.data ||
      activeProjectsQ.isLoading ||
      selectedProjectIds.length === 0
    ) {
      return;
    }
    const validIds = new Set(projectFilterOptions.map(project => project.id));
    const next = selectedProjectIds.filter(id => validIds.has(id));
    if (next.length !== selectedProjectIds.length) {
      setSelectedProjectIds(next);
      if (activeOrganizationId) writeMyMissionsProjectFilter(activeOrganizationId, next);
    }
  }, [
    activeOrganizationId,
    myMissionsQ.data,
    activeProjectsQ.isLoading,
    selectedProjectIds,
    projectFilterOptions,
    projectFilterOrganizationId
  ]);

  const updateSelectedProjectIds = useCallback(
    (update: (current: string[]) => string[]) => {
      setSelectedProjectIds(current => {
        const next = update(current);
        if (activeOrganizationId && projectFilterOrganizationId === activeOrganizationId) {
          writeMyMissionsProjectFilter(activeOrganizationId, next);
        }
        return next;
      });
    },
    [activeOrganizationId, projectFilterOrganizationId]
  );

  const selectedTagIdSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const selectedStatusTypeSet = useMemo(() => new Set(selectedStatusTypes), [selectedStatusTypes]);
  const selectedProjectIdSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);

  const filteredMissions = useMemo(() => {
    let result = missions;
    if (selectedProjectIds.length > 0) {
      result = result.filter(mission => selectedProjectIdSet.has(mission.projectId));
    }
    if (selectedStatusTypes.length > 0) {
      result = result.filter(mission => selectedStatusTypeSet.has(mission.statusType));
    }
    if (selectedTagIds.length > 0) {
      result = result.filter(mission =>
        getMissionTags(mission).some(tag => selectedTagIdSet.has(tag.id))
      );
    }
    return result;
  }, [
    missions,
    selectedProjectIds.length,
    selectedProjectIdSet,
    selectedStatusTypes.length,
    selectedStatusTypeSet,
    selectedTagIds.length,
    selectedTagIdSet
  ]);

  const isTagFilterActive = selectedTagIds.length > 0;
  const isStatusFilterActive = selectedStatusTypes.length > 0;
  const isProjectFilterActive = selectedProjectIds.length > 0;
  const isFilterActive = isTagFilterActive || isStatusFilterActive || isProjectFilterActive;

  const visibleStatusColumns = useMemo(
    () =>
      isStatusFilterActive
        ? MY_MISSIONS_BOARD_COLUMNS.filter(column => selectedStatusTypeSet.has(column.key))
        : MY_MISSIONS_BOARD_COLUMNS,
    [isStatusFilterActive, selectedStatusTypeSet]
  );

  const clearFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedStatusTypes([]);
    updateSelectedProjectIds(() => []);
  }, [updateSelectedProjectIds]);

  // Every board column always exists (even when empty) so a card can be dropped
  // into it, and every mission has a home column because the column key *is* its
  // status type.
  const columnsForDnd = useMemo<ColumnMap>(() => groupMissionsByStatusType(missions), [missions]);

  const defaultCreateProjectId = useMemo(() => {
    const defaultProjectId = meta.data?.defaultProjectId;
    if (defaultProjectId && projects.some(project => project.id === defaultProjectId)) {
      return defaultProjectId;
    }
    return projects[0]?.id ?? '';
  }, [meta.data?.defaultProjectId, projects]);

  // Persist a drop. The column is a status type, so the whole column — across
  // every project and workspace it aggregates — is sent in one call and the
  // server resolves each moved mission's target status inside its own project.
  const onDrop = useCallback(
    async ({ dropColumnKey, orderedMissionIds }: MyMissionsDropTarget) => {
      if (!isMyMissionsColumnKey(dropColumnKey)) throw new Error('drop-noop');
      const statusType: MyMissionsColumnType = dropColumnKey;
      const columnName =
        MY_MISSIONS_BOARD_COLUMNS.find(column => column.key === statusType)?.name ?? statusType;

      const moved = orderedMissionIds
        .map(id => missionById.get(id))
        .filter((mission): mission is MyMissionDto => mission !== undefined);

      // Fail before writing anything when a project cannot represent this column,
      // so a multi-project reorder is never half-applied.
      const missingProjectIds = projectsMissingColumnType(moved, statusType, statusesByProject);
      if (missingProjectIds.length > 0) {
        setDropError({
          columnName,
          projectNames: missingProjectIds.map(id => projectNameById.get(id) ?? 'that project')
        });
        throw new Error('status-unavailable-for-project');
      }

      try {
        await reorder.mutateAsync({ statusType, orderedMissionIds });
      } catch (error) {
        // Defensive: the server can still reject a status removed mid-drag.
        setDropError({ columnName, projectNames: [] });
        throw error;
      }
    },
    [missionById, projectNameById, reorder, statusesByProject]
  );

  const myMissionsDnd = useMyMissionsDnd({ columns: columnsForDnd, onDrop });
  const { activeId, displayColumns, dndContextProps } = myMissionsDnd;

  // Filters only hide cards; the hook always owns the full column so a drop
  // still persists hidden missions' slots. Drag stays enabled with filters on.
  const visibleColumns = useMemo<ColumnMap>(() => {
    if (!isFilterActive) return displayColumns;
    const visibleMissionIds = new Set(filteredMissions.map(mission => mission.id));
    const map: ColumnMap = {};
    for (const column of MY_MISSIONS_BOARD_COLUMNS) {
      map[column.key] = (displayColumns[column.key] ?? []).filter(id => visibleMissionIds.has(id));
    }
    return map;
  }, [displayColumns, filteredMissions, isFilterActive]);

  const listDnd = { ...myMissionsDnd, displayColumns: visibleColumns };

  // The list view groups by the same four status-type columns as the board.
  const listStatuses = useMemo<BoardColumnStatus[]>(
    () =>
      visibleStatusColumns.map(column => ({
        id: column.key,
        name: column.name,
        type: column.type
      })),
    [visibleStatusColumns]
  );

  const handleViewChange = (next: BoardView) => {
    setView(next);
    storeView(next);
  };

  const handleCalendarDayClick = useCallback((day: Date) => {
    setDefaultDueDate(day);
    setModalOpen(true);
  }, []);

  const handleCloseNewMissionModal = useCallback(() => {
    setModalOpen(false);
    setDefaultDueDate(null);
  }, []);

  const openMission = useCallback(
    (missionId: string) => {
      void navigate({ to: '/user/missions/$missionId', params: { missionId } });
    },
    [navigate]
  );

  // The list-row checkbox marks a mission complete by moving it into the
  // `complete`-type status of that mission's *own* project, mirroring the board.
  const handleCompleteMission = useCallback(
    (missionId: string) => {
      const mission = missionById.get(missionId);
      if (!mission) return;
      const completeStatusId = resolveProjectStatusForColumn(
        statusesByProject.get(mission.projectId) ?? [],
        'complete'
      );
      if (!completeStatusId) return;
      void setMissionStatus.mutateAsync({ missionId, statusId: completeStatusId });
    },
    [missionById, statusesByProject, setMissionStatus]
  );

  const getMissionCardContext = useCallback(
    (mission: MyMissionDto) => ({
      projectId: mission.projectId,
      projectName: mission.projectName,
      projectColor: mission.projectColor,
      onOpen: () => openMission(mission.id)
    }),
    [openMission]
  );

  // Board columns are status types; resolve back to the concrete status of that
  // type in the target project before creating. When that project lacks one, the
  // mission lands in its default status.
  const createMissionInColumn = useCallback(
    async (
      columnKey: string,
      objective: string,
      options?: BlankMissionCreateOptions
    ): Promise<{ missionId: string }> => {
      const targetProjectId = options?.projectId ?? defaultCreateProjectId;
      if (!targetProjectId) throw new Error('Choose a project before creating a mission.');

      const statusId = isMyMissionsColumnKey(columnKey)
        ? resolveProjectStatusForColumn(statusesByProject.get(targetProjectId) ?? [], columnKey)
        : null;

      const tagIds = options?.tagIds ?? [];
      const detail = await createMission.mutateAsync({
        projectId: targetProjectId,
        ...firstObjectiveCreatePayload(objective, options?.resourceKey),
        ...(statusId ? { statusId } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {})
      });
      return { missionId: detail.id };
    },
    [createMission, defaultCreateProjectId, statusesByProject]
  );

  const handleCreateMissionFromColumn = useCallback(
    async (
      statusId: string,
      objective: string,
      _position: 'top' | 'bottom',
      options?: BlankMissionCreateOptions
    ) => {
      await createMissionInColumn(statusId, objective, options);
    },
    [createMissionInColumn]
  );

  const handleCreateAndOpenMissionFromColumn = useCallback(
    async (
      statusId: string,
      objective: string,
      _position: 'top' | 'bottom',
      options?: BlankMissionCreateOptions
    ) => {
      const { missionId } = await createMissionInColumn(statusId, objective, options);
      void navigate({ to: '/user/missions/$missionId', params: { missionId } });
    },
    [createMissionInColumn, navigate]
  );

  if (meta.isLoading || myMissionsQ.isLoading || activeProjectsQ.isLoading) {
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );
  }
  if (myMissionsQ.isError) {
    return (
      <div className="p-8 text-sm text-red-400">
        Could not load your missions: {(myMissionsQ.error as Error).message}
      </div>
    );
  }

  const activeMission = activeId ? missionById.get(activeId) : undefined;

  const renderColumns = () => (
    <>
      {visibleStatusColumns.map(column => {
        const colMissions = resolveColumnMissions(visibleColumns[column.key] ?? [], missionById);
        return (
          <MyMissionsColumn
            key={column.key}
            droppableId={column.key}
            title={column.name}
            type={column.type}
            missions={colMissions}
            count={colMissions.length}
            defaultProjectId={defaultCreateProjectId}
            membersByWorkspaceUserId={membersByWorkspaceUserId}
            selectedMissionId={selectedMissionId}
            draggable
            onOpenMission={openMission}
            onCreateMission={handleCreateMissionFromColumn}
            onCreateAndOpenMission={handleCreateAndOpenMissionFromColumn}
          />
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 min-w-0">
        <div className="border-b border-(--color-border) px-5 py-3">
          <h1 className="text-sm font-semibold">My Missions</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-(--color-border) px-5 mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <MissionsViewToggle value={view} onChange={handleViewChange} />
            <MissionProjectFilterDropdown
              projects={projectFilterOptions}
              selectedProjectIds={selectedProjectIds}
              onClear={() => updateSelectedProjectIds(() => [])}
              onToggle={projectId =>
                updateSelectedProjectIds(current =>
                  current.includes(projectId)
                    ? current.filter(id => id !== projectId)
                    : [...current, projectId]
                )
              }
            />
            <MissionStatusFilterDropdown
              statuses={statusFilterOptions}
              selectedStatusIds={selectedStatusTypes}
              onClear={() => setSelectedStatusTypes([])}
              onToggle={statusType =>
                setSelectedStatusTypes(current =>
                  current.includes(statusType)
                    ? current.filter(key => key !== statusType)
                    : [...current, statusType]
                )
              }
            />
            <MissionTagFilterDropdown
              tagOptions={tagOptions}
              selectedTagIds={selectedTagIds}
              onClear={() => setSelectedTagIds([])}
              onToggle={tagId =>
                setSelectedTagIds(current =>
                  current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId]
                )
              }
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto pt-3 px-5">
        {missions.length === 0 ? (
          <EmptyState
            title="No missions are assigned to you"
            hint="Missions assigned to you across your workspaces show up here, grouped by status."
          />
        ) : filteredMissions.length === 0 ? (
          <EmptyState
            title="No missions match these filters"
            hint="Clear the active filters to show every mission assigned to you."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : view === 'board' ? (
          <DndContext {...dndContextProps}>
            <div className="flex h-full min-h-0 items-stretch gap-2">
              {renderColumns()}
            </div>
            <DragOverlay>
              {activeMission ? (
                <SortableMissionCard
                  mission={activeMission}
                  projectId={activeMission.projectId}
                  projectName={activeMission.projectName}
                  projectColor={activeMission.projectColor}
                  assignee={
                    activeMission.assignedWorkspaceUserId
                      ? membersByWorkspaceUserId.get(activeMission.assignedWorkspaceUserId)
                      : undefined
                  }
                  selected={activeMission.id === selectedMissionId}
                  isDragOverlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : view === 'calendar' ? (
          <MissionCalendarView
            missions={filteredMissions}
            projectId={defaultCreateProjectId}
            projectColor={null}
            selectedMissionId={selectedMissionId}
            onCompleteMission={handleCompleteMission}
            onDayClick={handleCalendarDayClick}
            getMissionCardContext={getMissionCardContext}
          />
        ) : (
          <MissionListView
            statuses={listStatuses}
            dnd={listDnd}
            missionById={missionById}
            projectId={defaultCreateProjectId}
            projectName=""
            projectColor={null}
            createProjectId={defaultCreateProjectId}
            createStatusScope="aggregate"
            membersByWorkspaceUserId={membersByWorkspaceUserId}
            selectedMissionId={selectedMissionId}
            getMissionCardContext={getMissionCardContext}
            onCreateMission={handleCreateMissionFromColumn}
            onCreateAndOpenMission={handleCreateAndOpenMissionFromColumn}
            onCompleteMission={handleCompleteMission}
          />
        )}
      </div>

      <NewMissionModal
        open={modalOpen}
        onClose={handleCloseNewMissionModal}
        defaultProjectId={defaultCreateProjectId || null}
        defaultDueDate={defaultDueDate}
      />

      <Dialog
        open={dropError !== null}
        onOpenChange={open => {
          if (!open) setDropError(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Can’t move this mission</DialogTitle>
            <DialogDescription>
              {dropError && dropError.projectNames.length > 0
                ? `The ${dropError.projectNames.join(', ')} project has no “${dropError.columnName}” status, so this move can’t be saved. Add one to that project, then try again.`
                : `This move couldn’t be saved to the “${dropError?.columnName}” column. Try again in a moment.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDropError(null)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
