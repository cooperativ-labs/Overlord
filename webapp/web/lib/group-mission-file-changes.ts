import type { FileChangeDto, ProjectResourceDto } from '../../shared/contract.ts';

import {
  distinctProjectResourceKeys,
  primaryResourceConnection,
  projectResourceLabel
} from './project-resources.ts';

export type FileChangeResourceGroup = {
  resourceKey: string;
  resourceLabel: string;
  fileChanges: FileChangeDto[];
};

export function resolveFileChangeResourceKey({
  fileChange,
  fallbackResourceKey
}: {
  fileChange: FileChangeDto;
  fallbackResourceKey: string;
}): string {
  return fileChange.resourceKey?.trim() || fallbackResourceKey;
}

/**
 * Groups mission file changes by resource when a project has multiple resources
 * and the mission touched more than one of them. Otherwise returns a single flat
 * group so callers can render one list without section headers.
 */
export function groupMissionFileChanges({
  fileChanges,
  resources
}: {
  fileChanges: FileChangeDto[];
  resources: ProjectResourceDto[];
}): { shouldGroup: boolean; groups: FileChangeResourceGroup[] } {
  const resourceKeys = distinctProjectResourceKeys(resources);
  const fallbackResourceKey =
    primaryResourceConnection(resources).primary?.resourceKey ?? resourceKeys[0] ?? 'primary';

  if (fileChanges.length === 0) {
    return { shouldGroup: false, groups: [] };
  }

  const resolveKey = (fileChange: FileChangeDto) =>
    resolveFileChangeResourceKey({ fileChange, fallbackResourceKey });

  if (resourceKeys.length <= 1) {
    return {
      shouldGroup: false,
      groups: [
        {
          resourceKey: resolveKey(fileChanges[0]!),
          resourceLabel: projectResourceLabel({
            resources,
            resourceKey: resolveKey(fileChanges[0]!)
          }),
          fileChanges
        }
      ]
    };
  }

  const keysInChanges = new Set(fileChanges.map(resolveKey));
  if (keysInChanges.size <= 1) {
    const resourceKey = [...keysInChanges][0] ?? fallbackResourceKey;
    return {
      shouldGroup: false,
      groups: [
        {
          resourceKey,
          resourceLabel: projectResourceLabel({ resources, resourceKey }),
          fileChanges
        }
      ]
    };
  }

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
    shouldGroup: true,
    groups: groupOrder.map(resourceKey => ({
      resourceKey,
      resourceLabel: projectResourceLabel({ resources, resourceKey }),
      fileChanges: byKey.get(resourceKey) ?? []
    }))
  };
}
