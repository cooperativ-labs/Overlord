import { notFound } from 'next/navigation';

import { CurrentChangesPage } from '@/components/features/projects/CurrentChangesPage';
import { createClientForRequest } from '@/supabase/utils/server';

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ file?: string | string[]; ticket?: string | string[] }>;
};

function toStringList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(item => item.trim()).filter(Boolean))];
}

export default async function ProjectCurrentChangesPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { file, ticket } = await searchParams;
  const initialFilePath = Array.isArray(file) ? file[0] : file;
  const initialTicketIds = toStringList(ticket);
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: project, error } = await supabase
    .from('projects')
    .select('id,name')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  let workingDirectory: string | null = null;
  if (user?.id) {
    const { data: projectUser } = await supabase
      .from('project_user')
      .select('local_working_directory')
      .eq('user_id', user.id)
      .eq('project_id', project.id)
      .maybeSingle();
    workingDirectory = projectUser?.local_working_directory ?? null;
  }

  return (
    <CurrentChangesPage
      projectId={project.id}
      projectName={project.name}
      workingDirectory={workingDirectory}
      initialFilePath={initialFilePath ?? null}
      initialTicketIds={initialTicketIds}
    />
  );
}
