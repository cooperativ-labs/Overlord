import { useMergedProjectRepository } from '@/components/projects/ProjectRepositoryContext.tsx';
import {
  useMissionFileChanges,
  useProfile,
  useProjectExecutionTarget,
  useProjectResources
} from '@/lib/queries';
import { groupMissionFileChanges } from '@/lib/group-mission-file-changes.ts';
import { resolveResourceForKey } from '@/lib/project-resources.ts';

import { FileChangeResourceGroupHeader } from './FileChangeResourceGroupHeader.tsx';
import { LiveFileChangeCard } from './LiveFileChangeCard.tsx';
import { Spinner } from './ui.tsx';

/**
 * Realtime File Changes section for the mission panel. Lists the structured
 * per-file change rationales (`change_rationales`) recorded for the mission,
 * newest-first, each rendered as a collapsible {@link LiveFileChangeCard}. The
 * query is invalidated by the global SSE change feed, so rationales written by
 * the agent or CLI in another process stream in without a manual refresh.
 * Adapted from the reference `LiveFileChanges` for this app's stack.
 */
export function LiveFileChanges({
  missionId,
  projectId
}: {
  missionId: string;
  projectId: string;
}) {
  const fileChangesQ = useMissionFileChanges(missionId);
  const profileQ = useProfile();
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const { repository } = useMergedProjectRepository(projectId);

  if (fileChangesQ.isLoading || resourcesQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  if (fileChangesQ.isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load file changes: {(fileChangesQ.error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const fileChanges = fileChangesQ.data ?? [];
  const resources = resourcesQ.data ?? [];
  const selectedExecutionTargetId = executionTargetQ.data?.selectedExecutionTargetId ?? null;
  const fallbackRootPath = repository?.rootPath ?? null;
  const editorScheme = profileQ.data?.editorScheme ?? null;
  if (fileChanges.length === 0) {
    return <p className="text-sm italic text-[var(--color-ink-dim)]">No file changes yet.</p>;
  }

  const { shouldGroup, groups } = groupMissionFileChanges({ fileChanges, resources });

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
