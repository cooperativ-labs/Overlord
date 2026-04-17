'use client';

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react';

import { saveDefaultProjectAction } from '@/lib/actions/profile-settings';
import type { SidebarProject } from '@/lib/actions/projects';
import { useProjects } from '@/lib/client-data/tickets/hooks';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { cacheProjectsForOffline } from '@/lib/offline/offline-projects-cache';

type DefaultProjectContextValue = {
  defaultProject: SidebarProject | null;
  defaultProjectId: string | null;
  projects: SidebarProject[];
  setDefaultProjectId: (projectId: string) => void;
  isPending: boolean;
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
  const projectsQuery = useProjects(projects);
  const cachedProjects = projectsQuery.data ?? projects;
  const [defaultProjectId, setDefaultProjectIdState] = useState<string | null>(() =>
    resolveInitialDefaultProjectId(cachedProjects, initialDefaultProjectId)
  );
  const [isPending, startTransition] = useTransition();

  const setDefaultProjectId = (projectId: string) => {
    setDefaultProjectIdState(projectId);
    startTransition(async () => {
      try {
        await saveDefaultProjectAction(projectId);
      } catch (error) {
        console.error('Failed to save default project:', error);
      }
    });
  };

  useEffect(() => {
    const resolved = resolveInitialDefaultProjectId(cachedProjects, defaultProjectId);
    if (resolved !== defaultProjectId) {
      setDefaultProjectIdState(resolved);
    }
  }, [cachedProjects, defaultProjectId]);

  useEffect(() => {
    persistDefaultProjectCookie(defaultProjectId);
  }, [defaultProjectId]);

  // Cache projects for offline ticket creation
  useEffect(() => {
    if (cachedProjects.length > 0) {
      cacheProjectsForOffline(cachedProjects);
    }
  }, [cachedProjects]);

  const defaultProject = useMemo(
    () => cachedProjects.find(project => project.id === defaultProjectId) ?? null,
    [cachedProjects, defaultProjectId]
  );

  return (
    <DefaultProjectContext.Provider
      value={{
        defaultProject,
        defaultProjectId,
        projects: cachedProjects,
        setDefaultProjectId,
        isPending
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
