import { QuickTaskBar } from '@/components/features/QuickTaskBar';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';

export const dynamic = 'force-dynamic';

export default async function QuickTaskPage() {
  const projects = await getProjectsForCurrentUser();

  return (
    <QuickTaskBar
      projects={projects.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        everhour_project_id: p.everhourProjectId ?? null,
        organization_id: p.organizationId
      }))}
    />
  );
}
