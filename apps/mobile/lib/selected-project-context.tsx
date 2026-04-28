import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from './auth-context';
import { loadProjectSummaries, type ProjectSummary } from './projects';

interface SelectedProjectContextValue {
  projects: ProjectSummary[];
  loading: boolean;
  selectedProjectId: string | null;
  selectedProject: ProjectSummary | null;
  selectProject: (projectId: string | null) => void;
  refresh: () => Promise<void>;
}

const SelectedProjectContext = createContext<SelectedProjectContextValue | undefined>(undefined);

export function SelectedProjectProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setSelectedProjectId(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const data = await loadProjectSummaries();
      setProjects(data);
      setSelectedProjectId(current => {
        if (current && data.some(project => project.id === current)) return current;
        return null;
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const value = useMemo<SelectedProjectContextValue>(
    () => ({
      projects,
      loading,
      selectedProjectId,
      selectedProject,
      selectProject: setSelectedProjectId,
      refresh
    }),
    [projects, loading, selectedProjectId, selectedProject, refresh]
  );

  return (
    <SelectedProjectContext.Provider value={value}>{children}</SelectedProjectContext.Provider>
  );
}

export function useSelectedProject() {
  const context = useContext(SelectedProjectContext);
  if (!context) {
    throw new Error('useSelectedProject must be used within a SelectedProjectProvider');
  }
  return context;
}
