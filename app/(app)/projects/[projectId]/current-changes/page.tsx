import { notFound } from 'next/navigation';

import { CurrentChangesPage } from '@/components/features/projects/CurrentChangesPage';
import { createClient } from '@/supabase/utils/server';

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
};

export default async function ProjectCurrentChangesPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { file } = await searchParams;
  const initialFilePath = Array.isArray(file) ? file[0] : file;
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from('projects')
    .select('id,name,local_working_directory,ssh_command,remote_working_directory')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  return (
    <CurrentChangesPage
      projectId={project.id}
      projectName={project.name}
      workingDirectory={project.local_working_directory}
      sshCommand={project.ssh_command}
      remoteWorkingDirectory={project.remote_working_directory}
      initialFilePath={initialFilePath ?? null}
    />
  );
}
