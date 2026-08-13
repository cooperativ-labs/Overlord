import type { ProjectResourceDto } from '../../shared/contract.ts';

import { getDesktopBridge } from './desktop-chrome.ts';

export async function writeLocalProjectMetadata({
  directoryPath,
  projectId,
  projectName,
  resource
}: {
  directoryPath: string;
  projectId: string;
  projectName?: string | null;
  resource: ProjectResourceDto;
}): Promise<void> {
  const writeProjectMetadata = getDesktopBridge()?.writeProjectMetadata;
  if (!writeProjectMetadata) return;
  await writeProjectMetadata({
    directoryPath,
    projectId,
    projectName,
    resourceId: resource.id,
    resourceKey: resource.resourceKey,
    executionTargetId: resource.executionTargetId,
    isPrimary: resource.isPrimary
  });
}
