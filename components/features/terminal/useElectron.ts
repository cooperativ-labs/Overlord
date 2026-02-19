'use client';

import { useMemo } from 'react';

export function useElectron() {
  const api = useMemo(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI;
    }
    return null;
  }, []);

  return {
    isElectron: api !== null,
    api
  };
}
