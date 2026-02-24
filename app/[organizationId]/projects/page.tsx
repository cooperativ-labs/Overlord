import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/supabase/utils/server';

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function ProjectsPage({ params }: PageProps) {
  const { organizationId } = await params;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id,name,color')
    .eq('organization_id', parsedOrganizationId)
    .order('name', { ascending: true });

  if (error) {
    notFound();
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-semibold">Projects</h1>
      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map(project => (
            <Link
              key={project.id}
              href={`/${organizationId}/projects/${project.id}`}
              className="block transition-opacity hover:opacity-80"
            >
              <Card className="h-full cursor-pointer">
                <CardHeader className="gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <CardTitle>{project.name}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No projects yet.</p>
      )}
    </div>
  );
}
