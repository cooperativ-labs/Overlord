import { executionTargetOptionLabel } from '@/lib/execution-target-selection';

import type {
  EligibleExecutionTargetDto,
  ProjectResourceAccessMode,
  ProjectResourceSourceDto
} from '../../../../../shared/contract.ts';

export const ACCESS_MODE_OPTIONS: { value: ProjectResourceAccessMode; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'read_write', label: 'Read & write' }
];

export function accessModeLabel(mode: ProjectResourceAccessMode): string {
  return mode === 'read' ? 'Read' : 'Read & write';
}

export function accessModeHelpText(mode: ProjectResourceAccessMode): string {
  return mode === 'read'
    ? 'Reference resource: agents can read/navigate it, but it is not offered in the resource picker and is not linked into .overlord/project.json.'
    : 'Full access: offered in the resource picker and linked as a working directory.';
}

export function resourceStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Linked';
    case 'missing':
      return 'Missing';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

export function sourceKindLabel(sourceKind: string): string {
  switch (sourceKind) {
    case 'local_checkout':
      return 'Local';
    case 'git':
      return 'Git';
    default:
      return sourceKind;
  }
}

export function sourceDescriptorValue(source: ProjectResourceSourceDto): string {
  if (source.sourceKind === 'local_checkout') {
    const path = source.descriptor.path;
    return typeof path === 'string' ? path : '';
  }
  if (source.sourceKind === 'git') {
    const url = source.descriptor.url;
    return typeof url === 'string' ? url : '';
  }
  return '';
}

export function targetLabelForId({
  executionTargetId,
  eligibleTargets,
  localExecutionTargetId,
  deviceLabel
}: {
  executionTargetId: string | null;
  eligibleTargets: EligibleExecutionTargetDto[];
  localExecutionTargetId: string | null;
  deviceLabel: string;
}): string {
  if (executionTargetId === null) return 'Any target';
  const match = eligibleTargets.find(target => target.executionTargetId === executionTargetId);
  if (match) return executionTargetOptionLabel(match);
  if (executionTargetId === localExecutionTargetId) {
    return `${deviceLabel} (this device)`;
  }
  return executionTargetId;
}
