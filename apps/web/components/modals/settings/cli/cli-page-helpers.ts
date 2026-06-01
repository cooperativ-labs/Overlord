import type { CustomAgentPlaceholder } from '@/lib/schemas/agent-config';

import type {
  BundleStatusEntry,
  CustomAgentDraft,
  PluginActionMeta,
  SlashStatusEntry
} from './cli-page-types';

export function getBundleActionMeta(
  status: BundleStatusEntry['status'] | undefined
): PluginActionMeta {
  const label =
    status === 'installed'
      ? 'Remove'
      : status === 'partial' || status === 'error'
        ? 'Repair'
        : status === 'stale'
          ? 'Update'
          : 'Install';

  return {
    label,
    loadingText:
      label === 'Remove'
        ? 'Removing...'
        : label === 'Install'
          ? 'Installing...'
          : label === 'Update'
            ? 'Updating...'
            : 'Repairing...',
    successText:
      label === 'Remove'
        ? 'Removed'
        : label === 'Install'
          ? 'Installed'
          : label === 'Update'
            ? 'Updated'
            : 'Repaired',
    errorText: `${label} failed`
  };
}

export function getSlashActionMeta(
  status: SlashStatusEntry['status'] | undefined
): PluginActionMeta {
  const label = status === 'installed' || status === 'partial' ? 'Remove' : 'Install';

  return {
    label,
    loadingText: label === 'Remove' ? 'Removing...' : 'Installing...',
    successText: label === 'Remove' ? 'Removed' : 'Installed',
    errorText: `${label} failed`
  };
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-agent'
  );
}

export function parseOptionsText(text: string): { value: string; label: string }[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [value, ...rest] = line.split('|');
      const trimmedValue = value.trim();
      const label = rest.join('|').trim();
      return { value: trimmedValue, label: label || trimmedValue };
    })
    .filter(option => option.value.length > 0);
}

export function placeholdersToOptionsText(placeholder: CustomAgentPlaceholder): string {
  return placeholder.options
    .map(option =>
      option.label && option.label !== option.value
        ? `${option.value} | ${option.label}`
        : option.value
    )
    .join('\n');
}

export function emptyDraft(): CustomAgentDraft {
  return { id: '', name: '', commandTemplate: '', placeholders: {} };
}
