'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

import { ProjectSettingsModal } from '@/components/modals/ProjectSettingsModal';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type ProjectSettingsContextValue = {
  openProjectSettings: () => void;
};

const ProjectSettingsContext = createContext<ProjectSettingsContextValue | null>(null);

export function useProjectSettings() {
  const ctx = useContext(ProjectSettingsContext);
  return ctx;
}

type ProjectSettingsProviderProps = {
  children: ReactNode;
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
};

export function ProjectSettingsProvider({
  children,
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  initialStatuses,
  hasEverhourApiKey
}: ProjectSettingsProviderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const openProjectSettings = useCallback(() => {
    setModalOpen(true);
  }, []);

  const value: ProjectSettingsContextValue = {
    openProjectSettings
  };

  return (
    <ProjectSettingsContext.Provider value={value}>
      {children}
      <ProjectSettingsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        projectId={projectId}
        organizationId={organizationId}
        initialName={initialName}
        initialColor={initialColor}
        initialWorkingDirectory={initialWorkingDirectory}
        initialStatuses={initialStatuses}
        hasEverhourApiKey={hasEverhourApiKey}
      />
    </ProjectSettingsContext.Provider>
  );
}
