import type { ReactNode } from 'react';

import { useMergedProjectRepository } from '@/components/projects/ProjectRepositoryContext.tsx';
import { groupMissionFileChanges } from '@/lib/group-mission-file-changes.ts';
import { resolveResourceForKey } from '@/lib/project-resources.ts';
import { useProfile, useProjectExecutionTarget, useProjectResources } from '@/lib/queries';

import type { FileChangeDto } from '../../shared/contract.ts';

import { FileChangeResourceGroupHeader } from './FileChangeResourceGroupHeader.tsx';
import { LiveFileChangeCard } from './LiveFileChangeCard.tsx';
import { Spinner } from './ui.tsx';

/**
 * The structured, mechanically observed per-file changes for one objective (or
 * the mission's unassigned remainder), each rendered as a collapsible
 * {@link LiveFileChangeCard} and grouped by resource when the project has more
 * than one. The caller owns the query: the mission-level file-change list is
 * fetched once and partitioned by objective (coo:879), and the query is
 * invalidated by the global SSE change feed, so rationales written by the
 * agent or CLI in another process stream in without a manual refresh.
 * `fileChanges` should already be newest first.
 */
export function LiveFileChangeList({
  projectId,
  fileChanges,
  emptyState
}: {
  projectId: string;
  fileChanges: readonly FileChangeDto[];
  /** Rendered instead of the list when there is nothing to show. */
  emptyState?: ReactNode;
}) {
  const profileQ = useProfile();
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const { repository } = useMergedProjectRepository(projectId);

  if (fileChanges.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  if (resourcesQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  const resources = resourcesQ.data ?? [];
  const selectedExecutionTargetId = executionTargetQ.data?.selectedExecutionTargetId ?? null;
  const fallbackRootPath = repository?.rootPath ?? null;
  const editorScheme = profileQ.data?.editorScheme ?? null;

  const { shouldGroup, groups } = groupMissionFileChanges({
    fileChanges: [...fileChanges],
    resources
  });

  const rootPathForResourceKey = (resourceKey: string): string | null => {
    const resource = resolveResourceForKey({
      resources,
      executionTargetId: selectedExecutionTargetId,
      resourceKey
    });
    return resource?.path ?? fallbackRootPath;
  };

  return (
    <div className="grid gap-3">
      {groups.map(group => (
        <section key={group.resourceKey} className="grid gap-3">
          {shouldGroup ? <FileChangeResourceGroupHeader label={group.resourceLabel} /> : null}
          {group.fileChanges.map(fileChange => (
            <LiveFileChangeCard
              key={fileChange.id}
              fileChange={fileChange}
              rootPath={rootPathForResourceKey(group.resourceKey)}
              editorScheme={editorScheme}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
