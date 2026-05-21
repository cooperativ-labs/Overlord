import { QuickTaskBar } from '@/components/features/QuickTaskBar';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { createClientForRequest, getRequestDefaultProjectId } from '@/supabase/utils/server';

export const dynamic = 'force-dynamic';

export default async function QuickTaskPage() {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [projects, profileSettings, sshEnabled] = await Promise.all([
    getProjectsForCurrentUser(),
    user ? fetchProfileSettings(supabase, user.id) : Promise.resolve(null),
    isAppFeatureEnabled('ssh')
  ]);
  const defaultProjectId = await getRequestDefaultProjectId({
    profileDefaultProjectId: profileSettings?.default_project_id ?? null
  });

  return (
    <QuickTaskBar
      defaultProjectId={defaultProjectId}
      sshEnabled={sshEnabled}
      projects={projects.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        everhour_project_id: p.everhourProjectId ?? null,
        organization_id: p.organizationId,
        local_working_directory: p.localWorkingDirectory ?? null,
        ssh_command: p.sshCommand ?? null,
        remote_working_directory: p.remoteWorkingDirectory ?? null
      }))}
    />
  );
}
