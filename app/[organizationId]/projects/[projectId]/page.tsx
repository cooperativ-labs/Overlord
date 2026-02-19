import { notFound } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';

import { ProjectSettingsSection } from '@/components/features/projects/ProjectSettingsSection';

import TicketsBoardContent from '../../../tickets/(components)/TicketsBoardContent';

type PageProps = {
  params: Promise<{ organizationId: string; projectId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function ProjectTicketsPage({ params, searchParams }: PageProps) {
  const { organizationId, projectId } = await params;
  const { view = 'board' } = await searchParams;

  const parsedOrganizationId = Number(organizationId);
  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from('projects')
    .select('id,name,color,organization_id,everhour_project_id')
    .eq('id', projectId)
    .eq('organization_id', parsedOrganizationId)
    .single();

  if (error || !project) {
    notFound();
  }

  return (
    <div className="flex flex-col ">
      <ProjectSettingsSection
        projectId={project.id}
        organizationId={parsedOrganizationId}
        initialName={project.name}
        initialColor={project.color}
        everhourProjectId={project.everhour_project_id}
      />
      <TicketsBoardContent
        view={view}
        organizationId={parsedOrganizationId}
        projectId={project.id}
      />
    </div>
  );
}
