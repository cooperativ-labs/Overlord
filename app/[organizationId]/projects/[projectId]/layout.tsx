import { notFound } from 'next/navigation';

import { ProjectSettingsSection } from '@/components/features/projects/ProjectSettingsSection';
import { createClient } from '@/supabase/utils/server';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationId: string; projectId: string }>;
};

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { organizationId, projectId } = await params;

  const parsedOrganizationId = Number(organizationId);
  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [{ data: project, error }, { data: everhourIntegration }, { data: statuses }] =
    await Promise.all([
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
        .maybeSingle(),
      supabase
        .from('ticket_statuses')
        .select('name,position,status_type,is_default')
        .eq('organization_id', parsedOrganizationId)
        .order('position', { ascending: true })
    ]);

  if (error || !project) {
    notFound();
  }

  const everhourApiKey =
    typeof everhourIntegration?.api_key === 'string' ? everhourIntegration.api_key.trim() : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;

  return (
    <div className="flex flex-col">
      <ProjectSettingsSection
        projectId={project.id}
        organizationId={parsedOrganizationId}
        initialName={project.name}
        initialColor={project.color}
        initialWorkingDirectory={project.local_working_directory}
        initialStatuses={(statuses ?? []).map(status => ({
          name: status.name,
          position: status.position,
          statusType: status.status_type,
          isDefault: status.is_default
        }))}
        hasEverhourApiKey={hasEverhourApiKey}
      />
      {children}
    </div>
  );
}
