'use client';

import { createContext, useCallback, useContext, useState } from 'react';

import { ProjectCreatorModal } from '@/components/features/projects/ProjectCreatorModal';

type ProjectCreatorContextValue = {
  openProjectCreator: (options: { organizationId: number }) => void;
};

const ProjectCreatorContext = createContext<ProjectCreatorContextValue | null>(null);

type ProjectCreatorProviderProps = {
  children: React.ReactNode;
};

export function ProjectCreatorProvider({ children }: ProjectCreatorProviderProps) {
  const [open, setOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState<number | null>(null);

  const openProjectCreator = useCallback((options: { organizationId: number }) => {
    setOrganizationId(options.organizationId);
    setOpen(true);
  }, []);

  return (
    <ProjectCreatorContext.Provider value={{ openProjectCreator }}>
      {children}
      {organizationId !== null && (
        <ProjectCreatorModal
          open={open}
          onOpenChange={setOpen}
          organizationId={organizationId}
        />
      )}
    </ProjectCreatorContext.Provider>
  );
}

export function useProjectCreator(): ProjectCreatorContextValue {
  const ctx = useContext(ProjectCreatorContext);
  if (!ctx) {
    throw new Error('useProjectCreator must be used within a ProjectCreatorProvider');
  }
  return ctx;
}
