'use client';

import { ProjectStatusSettings } from '@/components/features/projects/ProjectStatusSettings';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type WorkflowPageProps = {
  projectId: string;
  organizationId: number;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
};

export function WorkflowPage({ projectId, organizationId, initialStatuses }: WorkflowPageProps) {
  return (
    <ProjectStatusSettings
      organizationId={organizationId}
      projectId={projectId}
      initialStatuses={initialStatuses}
      noCollapsible
    />
  );
}
