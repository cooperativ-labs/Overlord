import { FeedList } from '@/components/features/feed/FeedList';
import { getExecutingFeedTicketsAction, getFeedPostsAction } from '@/lib/actions/feed';
import { getEditorSchemeAction } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { getEditorScheme } from '@/lib/env';

export default async function FeedPage() {
  const [posts, executingTickets, projects, preferredEditorScheme] = await Promise.all([
    getFeedPostsAction({ limit: 10 }),
    getExecutingFeedTicketsAction(),
    getProjectsForCurrentUser(),
    getEditorSchemeAction()
  ]);

  const projectList = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    localWorkingDirectory: p.localWorkingDirectory
  }));

  return (
    <FeedList
      posts={posts}
      executingTickets={executingTickets}
      projects={projectList}
      editorScheme={getEditorScheme(preferredEditorScheme)}
    />
  );
}
