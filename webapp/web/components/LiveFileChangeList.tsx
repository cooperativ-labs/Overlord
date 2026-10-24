import {
  groupMissionFileChanges,
  UNRESOLVED_RESOURCE_KEY
} from '@/lib/group-mission-file-changes.ts';
import { resolveResourceForKey } from '@/lib/project-resources.ts';
import { useProfile, useProjectExecutionTarget, useProjectResources } from '@/lib/queries';

import type { FileChangeDto } from '../../shared/contract.ts';

import { FileChangeResourceGroupHeader } from './FileChangeResourceGroupHeader.tsx';
import { FileChangeRow } from './FileChangeRow.tsx';
import { Spinner } from './ui.tsx';

/**
 * Compact path evidence rendered as one {@link FileChangeRow} per path, grouped
 * by resource when the rows span more than one. Equal relative paths in
 * different resources stay distinct rows under their own headers. The caller
 * owns the query and the empty/unavailable states; this renders nothing for an
 * empty list.
 */
export function LiveFileChangeList({
  projectId,
  fileChanges
}: {
  projectId: string;
  fileChanges: readonly FileChangeDto[];
}) {
  const profileQ = useProfile();
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);

  if (fileChanges.length === 0) return null;

  if (resourcesQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  const resources = resourcesQ.data ?? [];
  const selectedExecutionTargetId = executionTargetQ.data?.selectedExecutionTargetId ?? null;
  const editorScheme = profileQ.data?.editorScheme ?? null;

  const { shouldGroup, groups } = groupMissionFileChanges({
    fileChanges: [...fileChanges],
    resources
  });

  const rootPathForResourceKey = (resourceKey: string): string | null => {
    // No editor link is better than one into a guessed resource.
    if (resourceKey === UNRESOLVED_RESOURCE_KEY) return null;
    const resource = resolveResourceForKey({
      resources,
      executionTargetId: selectedExecutionTargetId,
      resourceKey
    });
    // This helper falls back to primary for repository browsing. Evidence rows
    // must never use that fallback for a different or unlinked resource.
    return resource?.resourceKey === resourceKey ? resource.path : null;
  };

  return (
    <div className="grid min-w-0 gap-2">
      {groups.map(group => (
        <section key={group.resourceKey} className="grid min-w-0 gap-1">
          {shouldGroup ? <FileChangeResourceGroupHeader label={group.resourceLabel} /> : null}
          <ul className="grid min-w-0">
            {group.fileChanges.map(fileChange => (
              <FileChangeRow
                key={fileChange.id}
                fileChange={fileChange}
                rootPath={rootPathForResourceKey(group.resourceKey)}
                editorScheme={editorScheme}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
