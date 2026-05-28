import { notFound } from 'next/navigation';

import { ProjectGraphPage } from '@/components/features/projects/graph/ProjectGraphPage';
import { createClientForRequest } from '@/supabase/utils/server';

type PageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectGraphRoute({ params }: PageProps) {
  const { projectId } = await params;
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('id,name')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  return <ProjectGraphPage projectId={project.id} projectName={project.name} />;
}
