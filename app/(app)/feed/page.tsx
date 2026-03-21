import { FeedList } from '@/components/features/feed/FeedList';
import { getFeedPostsAction } from '@/lib/actions/feed';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';

export default async function FeedPage() {
  const [posts, projects] = await Promise.all([
    getFeedPostsAction({ daysBack: 3 }),
    getProjectsForCurrentUser()
  ]);

  const projectList = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color
  }));

  return <FeedList posts={posts} projects={projectList} />;
}
