import { FeedList } from '@/components/features/feed/FeedList';
import { getExecutingFeedTicketsAction } from '@/lib/actions/feed';
import { getEditorSchemeAction } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { getEditorScheme } from '@/lib/env';

export default async function FeedPage() {
  const [projects, preferredEditorScheme, executingTickets, sshEnabled] = await Promise.all([
    getProjectsForCurrentUser(),
    getEditorSchemeAction(),
    getExecutingFeedTicketsAction().catch(() => []),
    isAppFeatureEnabled('ssh')
  ]);

  const projectList = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    organizationId: p.organizationId,
    localWorkingDirectory: p.localWorkingDirectory,
    sshCommand: p.sshCommand,
    remoteWorkingDirectory: p.remoteWorkingDirectory,
    sshEnabled
  }));

  return (
    <FeedList
      projects={projectList}
      editorScheme={getEditorScheme(preferredEditorScheme)}
      initialExecutingTickets={executingTickets}
    />
  );
}
