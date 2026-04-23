import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getSupabase } from './supabase';

export interface ProjectSummary {
  id: string;
  name: string;
  color: string;
}

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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, color')
      .order('name', { ascending: true });

    if (!error && data) {
      setProjects(data as ProjectSummary[]);
      setSelectedProjectId(current => {
        if (current && data.some(project => project.id === current)) return current;
        return data[0]?.id ?? null;
      });
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

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
