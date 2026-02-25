'use client';

import type { ReactNode } from 'react';

import { ProjectSettingsProvider } from '@/components/features/projects/ProjectSettingsContext';
import { ProjectSettingsSection } from '@/components/features/projects/ProjectSettingsSection';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type ProjectLayoutClientProps = {
  children: ReactNode;
  projectId: string;
  organizationId: number;
  projectName: string;
  projectColor: string;
  projectWorkingDirectory: string | null;
  statuses: Array<{
    name: string;
    position: number;
    status_type: TicketStatusType;
    is_default: boolean;
  }>;
  hasEverhourApiKey: boolean;
};

export function ProjectLayoutClient({
  children,
  projectId,
  organizationId,
  projectName,
  projectColor,
  projectWorkingDirectory,
  statuses,
  hasEverhourApiKey
}: ProjectLayoutClientProps) {
  const initialStatuses = statuses.map(s => ({
    name: s.name,
    position: s.position,
    statusType: s.status_type,
    isDefault: s.is_default
  }));

  return (
    <ProjectSettingsProvider
      projectId={projectId}
      organizationId={organizationId}
      initialName={projectName}
      initialColor={projectColor}
      initialWorkingDirectory={projectWorkingDirectory}
      initialStatuses={initialStatuses}
      hasEverhourApiKey={hasEverhourApiKey}
    >
      <div className="flex flex-col">
        <ProjectSettingsSection
          projectId={projectId}
          organizationId={organizationId}
          initialName={projectName}
          initialColor={projectColor}
          initialWorkingDirectory={projectWorkingDirectory}
          hasEverhourApiKey={hasEverhourApiKey}
        />
        {children}
      </div>
    </ProjectSettingsProvider>
  );
}
