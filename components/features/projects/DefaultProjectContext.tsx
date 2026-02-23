'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { SidebarProject } from '@/lib/actions/projects';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';

type DefaultProjectContextValue = {
  defaultProject: SidebarProject | null;
  defaultProjectId: string | null;
  projects: SidebarProject[];
  setDefaultProjectId: (projectId: string) => void;
};

const DefaultProjectContext = createContext<DefaultProjectContextValue | null>(null);

type DefaultProjectProviderProps = {
  children: React.ReactNode;
  initialDefaultProjectId: string | null;
  projects: SidebarProject[];
};

function resolveInitialDefaultProjectId(
  projects: SidebarProject[],
  initialDefaultProjectId: string | null
): string | null {
  if (!projects.length) {
    return null;
  }

  const hasInitial =
    typeof initialDefaultProjectId === 'string' &&
    projects.some(project => project.id === initialDefaultProjectId);
  if (hasInitial) {
    return initialDefaultProjectId;
  }

  return projects[0].id;
}

function persistDefaultProjectCookie(projectId: string | null) {
  if (typeof document === 'undefined') {
    return;
  }

  if (!projectId) {
    document.cookie = `${DEFAULT_PROJECT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }

  document.cookie = `${DEFAULT_PROJECT_COOKIE}=${projectId}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function DefaultProjectProvider({
  children,
  initialDefaultProjectId,
  projects
}: DefaultProjectProviderProps) {
  const [defaultProjectId, setDefaultProjectIdState] = useState<string | null>(() =>
    resolveInitialDefaultProjectId(projects, initialDefaultProjectId)
  );

  useEffect(() => {
    const resolved = resolveInitialDefaultProjectId(projects, defaultProjectId);
    if (resolved !== defaultProjectId) {
      setDefaultProjectIdState(resolved);
    }
  }, [defaultProjectId, projects]);

  useEffect(() => {
    persistDefaultProjectCookie(defaultProjectId);
  }, [defaultProjectId]);

  const defaultProject = useMemo(
    () => projects.find(project => project.id === defaultProjectId) ?? null,
    [defaultProjectId, projects]
  );

  return (
    <DefaultProjectContext.Provider
      value={{
        defaultProject,
        defaultProjectId,
        projects,
        setDefaultProjectId: setDefaultProjectIdState
      }}
    >
      {children}
    </DefaultProjectContext.Provider>
  );
}

export function useDefaultProject() {
  const context = useContext(DefaultProjectContext);
  if (!context) {
    throw new Error('useDefaultProject must be used within a DefaultProjectProvider.');
  }
  return context;
}
