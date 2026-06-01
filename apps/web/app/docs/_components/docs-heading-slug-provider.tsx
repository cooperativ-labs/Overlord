'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createHeadingSlugRegistry } from '@/lib/helpers/heading-slug';

type DocsHeadingSlugContextValue = {
  registerHeadingSlug: (text: string) => string;
};

const DocsHeadingSlugContext = createContext<DocsHeadingSlugContextValue | null>(null);

export function DocsHeadingSlugProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => {
    const registerHeadingSlug = createHeadingSlugRegistry();
    return { registerHeadingSlug };
  }, []);

  return (
    <DocsHeadingSlugContext.Provider value={value}>{children}</DocsHeadingSlugContext.Provider>
  );
}

export function useDocsHeadingSlug(): DocsHeadingSlugContextValue {
  const context = useContext(DocsHeadingSlugContext);
  if (!context) {
    throw new Error('useDocsHeadingSlug must be used within DocsHeadingSlugProvider');
  }
  return context;
}
