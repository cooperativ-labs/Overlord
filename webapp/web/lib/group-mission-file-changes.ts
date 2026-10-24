import type { FileChangeDto, ProjectResourceDto } from '../../shared/contract.ts';

import { projectResourceLabel } from './project-resources.ts';

/**
 * Group key for rows whose resource was never resolved (sessionless
 * record-work). In a multi-resource project they are not attributed to the
 * primary resource by guesswork; they get their own group.
 */
export const UNRESOLVED_RESOURCE_KEY = '__unresolved__';
const UNRESOLVED_RESOURCE_LABEL = 'Unresolved resource';

export type FileChangeResourceGroup = {
  resourceKey: string;
  resourceLabel: string;
  fileChanges: FileChangeDto[];
};

function groupLabel(resources: ProjectResourceDto[], resourceKey: string): string {
  return resourceKey === UNRESOLVED_RESOURCE_KEY
    ? UNRESOLVED_RESOURCE_LABEL
    : projectResourceLabel({ resources, resourceKey });
}

/**
 * Groups objective path evidence by its recorded resource, even if that resource
 * is no longer linked on this device (null counts as its own group).
 * A single evidence group is flat so callers render one
 * list without headers. Row order within a group is preserved; the server read
 * already sorts by resource then path.
 */
export function groupMissionFileChanges({
  fileChanges,
  resources
}: {
  fileChanges: FileChangeDto[];
  resources: ProjectResourceDto[];
}): { shouldGroup: boolean; groups: FileChangeResourceGroup[] } {
  if (fileChanges.length === 0) {
    return { shouldGroup: false, groups: [] };
  }

  const resolveKey = (fileChange: FileChangeDto) =>
    fileChange.resourceKey?.trim() || UNRESOLVED_RESOURCE_KEY;

  const groupOrder: string[] = [];
  const byKey = new Map<string, FileChangeDto[]>();
  for (const fileChange of fileChanges) {
    const resourceKey = resolveKey(fileChange);
    if (!byKey.has(resourceKey)) {
      byKey.set(resourceKey, []);
      groupOrder.push(resourceKey);
    }
    byKey.get(resourceKey)!.push(fileChange);
  }

  return {
    shouldGroup: groupOrder.length > 1,
    groups: groupOrder.map(resourceKey => ({
      resourceKey,
      resourceLabel: groupLabel(resources, resourceKey),
      fileChanges: byKey.get(resourceKey) ?? []
    }))
  };
}
