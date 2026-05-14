import { Newspaper } from 'lucide-react';

import { FeedList } from '@/components/features/feed/FeedList';
import { getExecutingFeedTicketsAction } from '@/lib/actions/feed';
import { getEditorSchemeAction } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { getEditorScheme } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function FeedWindowPage() {
  const [projects, preferredEditorScheme, executingTickets] = await Promise.all([
    getProjectsForCurrentUser(),
    getEditorSchemeAction(),
    getExecutingFeedTicketsAction().catch(() => [])
  ]);

  const projectList = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    organizationId: p.organizationId,
    localWorkingDirectory: p.localWorkingDirectory,
    sshCommand: p.sshCommand,
    remoteWorkingDirectory: p.remoteWorkingDirectory
  }));

  return (
    <div className="h-full flex flex-col">
      {/* Draggable titlebar strip — gives users a handle to move the window */}
      <div className="electron-drag-region h-9 w-full shrink-0 pl-20 flex items-center">
        <span className="mt-1.5 ml-2 electron-no-drag text-lg font-medium text-muted-foreground select-none flex items-center gap-2">
          <Newspaper className="h-4 w-4" size={16} />
          Feed
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <FeedList
          projects={projectList}
          editorScheme={getEditorScheme(preferredEditorScheme)}
          initialExecutingTickets={executingTickets}
        />
      </div>
    </div>
  );
}
