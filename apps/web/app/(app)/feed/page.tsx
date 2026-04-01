import { FeedList } from '@/components/features/feed/FeedList';
import { getExecutingFeedTicketsAction } from '@/lib/actions/feed';
import { getEditorSchemeAction } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { getEditorScheme } from '@/lib/env';

export default async function FeedPage() {
  const [projects, preferredEditorScheme, executingTickets] = await Promise.all([
    getProjectsForCurrentUser(),
    getEditorSchemeAction(),
    getExecutingFeedTicketsAction().catch(() => [])
  ]);

  const projectList = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    localWorkingDirectory: p.localWorkingDirectory
  }));

  return (
    <FeedList
      projects={projectList}
      editorScheme={getEditorScheme(preferredEditorScheme)}
      initialExecutingTickets={executingTickets}
    />
  );
}
