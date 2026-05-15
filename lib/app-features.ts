import { cache } from 'react';

import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export const APP_FEATURE_DEFAULTS = {
  'future-objectives': {
    name: 'Future objectives',
    description:
      'Shows multi-objective planning with future objective placeholders and promotion controls.',
    isEnabled: false
  },
  'objective-git-revert': {
    name: 'Objective git revert',
    description:
      'Shows per-objective checkpoint revert controls and local checkpoint cleanup actions.',
    isEnabled: false
  },
  ssh: {
    name: 'SSH remote workspaces',
    description:
      'Shows SSH configuration and remote workspace selection throughout the web and desktop apps.',
    isEnabled: true
  }
} as const;

export type KnownAppFeatureKey = keyof typeof APP_FEATURE_DEFAULTS;
export type AppFeatureKey = string;
export type AppFeatureRow = Database['public']['Tables']['app_features']['Row'];
export type AppFeatureDefinition = {
  key: AppFeatureKey;
  name: string;
  description: string;
  isEnabled: boolean;
  updatedAt: string | null;
};

const DEFAULT_FEATURE_KEYS = Object.keys(APP_FEATURE_DEFAULTS) as KnownAppFeatureKey[];

function normalizeFeature(
  row: Partial<AppFeatureRow> & { key: AppFeatureKey }
): AppFeatureDefinition {
  const defaults = APP_FEATURE_DEFAULTS[row.key as KnownAppFeatureKey];
  return {
    key: row.key,
    name:
      typeof row.name === 'string' && row.name.trim().length > 0
        ? row.name
        : (defaults?.name ?? row.key),
    description:
      typeof row.description === 'string' && row.description.trim().length > 0
        ? row.description
        : (defaults?.description ?? ''),
    isEnabled:
      typeof row.is_enabled === 'boolean' ? row.is_enabled : (defaults?.isEnabled ?? false),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
  };
}

export const getAppFeatures = cache(async (): Promise<AppFeatureDefinition[]> => {
  const service = createServiceRoleClient();
  const { data, error } = await service.from('app_features').select('*').order('key');

  if (error) {
    console.error('Failed to load app features:', error);
    return DEFAULT_FEATURE_KEYS.map(key => normalizeFeature({ key }));
  }

  const featuresByKey = new Map<string, AppFeatureDefinition>();

  for (const row of data ?? []) {
    featuresByKey.set(row.key, normalizeFeature(row));
  }

  for (const key of DEFAULT_FEATURE_KEYS) {
    if (!featuresByKey.has(key)) {
      featuresByKey.set(key, normalizeFeature({ key }));
    }
  }

  return Array.from(featuresByKey.values()).sort((left, right) =>
    left.key.localeCompare(right.key)
  );
});

export const getAppFeatureMap = cache(async (): Promise<Record<string, AppFeatureDefinition>> => {
  const features = await getAppFeatures();
  return Object.fromEntries(features.map(feature => [feature.key, feature]));
});

export async function isAppFeatureEnabled(key: AppFeatureKey): Promise<boolean> {
  const features = await getAppFeatureMap();
  return features[key]?.isEnabled ?? false;
}
