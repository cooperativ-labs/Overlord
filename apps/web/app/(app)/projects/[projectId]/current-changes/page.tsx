import { notFound } from 'next/navigation';

import { CurrentChangesPage } from '@/components/features/projects/CurrentChangesPage';
import { getPrimaryProjectResourceDirectoriesByProjectId } from '@/lib/resource-directories/primary-resource';
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
    const primaryResources = await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
      userId: user.id,
      projectIds: [project.id]
    });
    workingDirectory = primaryResources.get(project.id)?.directoryPath ?? null;
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
