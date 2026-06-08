'use client';

import { Archive, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ArchivedProject } from '@/lib/actions/projects';
import { getArchivedProjectsForOrganizationAction } from '@/lib/actions/projects';
import { useUnarchiveProjectMutation } from '@/lib/client-data/projects/mutations';

type ArchivedProjectsPageProps = {
  open: boolean;
  organizationId: number;
};

export function ArchivedProjectsPage({ open, organizationId }: ArchivedProjectsPageProps) {
  const [projects, setProjects] = useState<ArchivedProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);
  const unarchiveMutation = useUnarchiveProjectMutation();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getArchivedProjectsForOrganizationAction(organizationId);
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archived projects.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!open) return;
    loadProjects();
  }, [open, organizationId, loadProjects]);

  async function handleUnarchive(projectId: string) {
    setUnarchivingId(projectId);
    try {
      await unarchiveMutation.mutateAsync({ projectId });
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch {
      setError('Failed to unarchive project.');
    } finally {
      setUnarchivingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h3 className="text-sm font-medium">Archived projects</h3>
        <p className="text-xs text-muted-foreground">
          Projects that have been archived. Unarchive a project to restore it to the sidebar.
          Resources will need to be reconnected.
        </p>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading…
        </div>
      ) : null}

      {!loading && projects.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-left font-medium">Archived</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {projects.map(project => (
                <tr key={project.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="text-sm">{project.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(project.archivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={unarchivingId !== null}
                      onClick={() => handleUnarchive(project.id)}
                    >
                      {unarchivingId === project.id ? (
                        <Loader2 className="size-3 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="size-3 mr-1" />
                      )}
                      Unarchive
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <Archive className="size-8 opacity-40" />
          <p className="text-sm">No archived projects</p>
        </div>
      ) : null}
    </div>
  );
}
