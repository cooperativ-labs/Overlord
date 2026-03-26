import type { Database } from '@/types/database.types';

import { LiveFileChangeCard } from './LiveFileChangeCard';
import { parseTimestamp } from './utils';

type FileChange = Database['public']['Tables']['file_changes']['Row'];

export function LiveFileChanges({
  fileChanges,
  editorScheme,
  workspaceRoot
}: {
  fileChanges: FileChange[];
  editorScheme: string;
  workspaceRoot: string;
}) {
  const orderedFileChanges = [...fileChanges].sort(
    (left, right) => parseTimestamp(right.created_at) - parseTimestamp(left.created_at)
  );

  if (!orderedFileChanges.length) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        File Changes
      </h2>
      <div className="grid gap-4">
        {orderedFileChanges.map(fileChange => (
          <LiveFileChangeCard
            key={fileChange.id}
            editorScheme={editorScheme}
            fileChange={fileChange}
            workspaceRoot={workspaceRoot}
          />
        ))}
      </div>
    </section>
  );
}
