import { GitCompare } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type { Database } from '@/types/database.types';

import { LiveFileChangeCard } from './LiveFileChangeCard';
import { parseTimestamp } from './utils';

type FileChange = Database['public']['Tables']['file_changes']['Row'];

export function LiveFileChanges({
  fileChanges,
  editorScheme,
  projectId,
  ticketId,
  workspaceRoot
}: {
  fileChanges: FileChange[];
  editorScheme: string;
  projectId: string | null;
  ticketId: string;
  workspaceRoot: string;
}) {
  const orderedFileChanges = [...fileChanges].sort(
    (left, right) => parseTimestamp(right.created_at) - parseTimestamp(left.created_at)
  );

  if (!orderedFileChanges.length) return null;

  const currentChangesHref = projectId
    ? `/projects/${projectId}/current-changes?ticket=${encodeURIComponent(ticketId)}`
    : null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          File Changes
        </h2>
        {currentChangesHref ? (
          <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-[11px]">
            <Link href={currentChangesHref}>
              <GitCompare className="h-3 w-3" />
              View in Current Changes
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4">
        {orderedFileChanges.map(fileChange => (
          <LiveFileChangeCard
            key={fileChange.id}
            editorScheme={editorScheme}
            fileChange={fileChange}
            projectId={projectId}
            ticketId={ticketId}
            workspaceRoot={workspaceRoot}
          />
        ))}
      </div>
    </section>
  );
}
