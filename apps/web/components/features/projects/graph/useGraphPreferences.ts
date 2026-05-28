'use client';

import { useCallback, useEffect, useState } from 'react';

import type { GraphFilters, GraphMode, GraphPreferences } from './types';
import { DEFAULT_HOTSPOT_WINDOW_DAYS, emptyFilters } from './types';

const STORAGE_PREFIX = 'overlord.project-graph.prefs';

function defaults(): GraphPreferences {
  return {
    mode: 'compare',
    hotspotWindowDays: DEFAULT_HOTSPOT_WINDOW_DAYS,
    filters: {
      changeKinds: [],
      impacts: [],
      directories: [],
      statusTypes: []
    }
  };
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

function loadPrefs(projectId: string): GraphPreferences {
  if (typeof window === 'undefined') return defaults();
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<GraphPreferences>;
    return {
      ...defaults(),
      ...parsed,
      filters: { ...defaults().filters, ...(parsed.filters ?? {}) }
    };
  } catch {
    return defaults();
  }
}

function persist(projectId: string, prefs: GraphPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(prefs));
  } catch {
    // Quota / private-mode failures are non-fatal.
  }
}

export function filtersFromPrefs(filters: GraphPreferences['filters']): GraphFilters {
  const base = emptyFilters();
  return {
    ...base,
    changeKinds: new Set(filters.changeKinds),
    impacts: new Set(filters.impacts),
    directories: new Set(filters.directories),
    statusTypes: new Set(filters.statusTypes)
  };
}

export function filtersToPrefs(filters: GraphFilters): GraphPreferences['filters'] {
  return {
    changeKinds: [...filters.changeKinds],
    impacts: [...filters.impacts],
    directories: [...filters.directories],
    statusTypes: [...filters.statusTypes]
  };
}

export function useGraphPreferences(projectId: string) {
  const [prefs, setPrefs] = useState<GraphPreferences>(defaults);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs(projectId));
    setHydrated(true);
  }, [projectId]);

  const update = useCallback(
    (patch: Partial<GraphPreferences>) => {
      setPrefs(prev => {
        const next = { ...prev, ...patch };
        persist(projectId, next);
        return next;
      });
    },
    [projectId]
  );

  const setMode = useCallback((mode: GraphMode) => update({ mode }), [update]);
  const setHotspotWindowDays = useCallback(
    (hotspotWindowDays: number) => update({ hotspotWindowDays }),
    [update]
  );
  const setFiltersPref = useCallback(
    (filters: GraphFilters) => update({ filters: filtersToPrefs(filters) }),
    [update]
  );

  return {
    prefs,
    hydrated,
    setMode,
    setHotspotWindowDays,
    setFiltersPref
  };
}
