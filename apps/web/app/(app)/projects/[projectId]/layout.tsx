import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ProjectLayoutClient } from '@/components/features/projects/ProjectLayoutClient';
import { TicketsBoardLoadingSkeleton } from '@/components/features/TicketsBoardLoadingSkeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PROJECT_BASE_SELECT } from '@/lib/actions/project-selects';
import {
  resolveProjectUserSshSettings,
  resolveVisibleProjectSshSettings
} from '@/lib/actions/project-types';
import { getProjectUserSshSettingsByProjectId } from '@/lib/actions/projects';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { createClientForRequest } from '@/supabase/utils/server';

import TicketsBoardContent from '../../tickets/(components)/TicketsBoardContent';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
};

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { projectId } = await params;

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Fetch project first to get organization_id for subsequent queries
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select(`${PROJECT_BASE_SELECT},everhour_project_id`)
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  const sshByProject = await getProjectUserSshSettingsByProjectId(supabase, user?.id, [project.id]);
  const projectUser = sshByProject.get(project.id);
  const [sshEnabled, slackEnabled] = await Promise.all([
    isAppFeatureEnabled('ssh'),
    isAppFeatureEnabled('slack')
  ]);
  const sshSettings = resolveVisibleProjectSshSettings(resolveProjectUserSshSettings(projectUser), {
    sshEnabled
  });
  const projectWorkingDirectory = null;

  const [{ data: everhourIntegration }, { data: statuses }] = await Promise.all([
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
      .eq('organization_id', project.organization_id)
      .order('position', { ascending: true })
  ]);

  const everhourApiKey =
    typeof everhourIntegration?.api_key === 'string' ? everhourIntegration.api_key.trim() : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;

  return (
    <ErrorBoundary>
      <ProjectLayoutClient
        board={
          <Suspense fallback={<TicketsBoardLoadingSkeleton variant="project" />}>
            <TicketsBoardContent organizationId={project.organization_id} projectId={projectId} />
          </Suspense>
        }
        projectId={project.id}
        organizationId={project.organization_id}
        projectName={project.name}
        projectColor={project.color}
        projectWorkingDirectory={projectWorkingDirectory}
        projectSshCommand={sshSettings.sshCommand}
        projectRemoteWorkingDirectory={sshSettings.remoteWorkingDirectory}
        projectSshHost={sshSettings.sshHost}
        projectSshPort={sshSettings.sshPort}
        projectSshUser={sshSettings.sshUser}
        projectSshAuthMethod={sshSettings.sshAuthMethod}
        projectSshPrivateKeyPath={sshSettings.sshPrivateKeyPath}
        projectEverhourProjectId={project.everhour_project_id}
        statuses={statuses ?? []}
        hasEverhourApiKey={hasEverhourApiKey}
        sshFeatureEnabled={sshEnabled}
        slackEnabled={slackEnabled}
      >
        {children}
      </ProjectLayoutClient>
    </ErrorBoundary>
  );
}
