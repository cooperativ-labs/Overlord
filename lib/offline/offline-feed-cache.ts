const STORAGE_KEY = 'overlord:offline:feed-posts';
const MAX_POSTS = 20;

export type CachedFeedPost = {
  id: string;
  title: string;
  body: string;
  project_name: string;
  project_color: string;
  ticket_title: string | null;
  ticket_sequence: number | null;
  impact_level: string;
  human_actions: string[];
  created_at: string;
};

export function cacheFeedPostsForOffline(posts: CachedFeedPost[]) {
  try {
    const toStore = posts.slice(0, MAX_POSTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function getCachedFeedPosts(): CachedFeedPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CachedFeedPost[];
  } catch {
    return [];
  }
}
