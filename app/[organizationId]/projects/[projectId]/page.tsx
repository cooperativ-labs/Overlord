import { notFound } from 'next/navigation';

import { ProjectSettingsSection } from '@/components/features/projects/ProjectSettingsSection';
import { createClient } from '@/supabase/utils/server';

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
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [{ data: project, error }, { data: everhourIntegration }] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name,color,organization_id,local_working_directory')
      .eq('id', projectId)
      .eq('organization_id', parsedOrganizationId)
      .single(),
    supabase
      .from('user_integrations')
      .select('api_key')
      .eq('user_id', user?.id ?? '')
      .eq('provider', 'everhour')
      .limit(1)
      .maybeSingle()
  ]);

  if (error || !project) {
    notFound();
  }

  const everhourApiKey =
    typeof everhourIntegration?.api_key === 'string' ? everhourIntegration.api_key.trim() : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;

  return (
    <div className="flex flex-col ">
      <ProjectSettingsSection
        projectId={project.id}
        organizationId={parsedOrganizationId}
        initialName={project.name}
        initialColor={project.color}
        initialWorkingDirectory={project.local_working_directory}
        hasEverhourApiKey={hasEverhourApiKey}
      />
      <TicketsBoardContent
        view={view}
        organizationId={parsedOrganizationId}
        projectId={project.id}
      />
    </div>
  );
}
