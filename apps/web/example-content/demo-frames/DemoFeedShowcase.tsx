'use client';

import { FeedCard } from '@/components/features/feed/FeedCard';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';

import { DEMO_FEED_POSTS } from './mock-feed-data';

export function DemoFeedShowcase({ numberOfPosts = 3 }: { numberOfPosts?: number }) {
  return (
    <TerminalProvider>
      <div className="rounded-xl bg-background p-2 md:p-5 text-foreground shadow-inner">
        {DEMO_FEED_POSTS.slice(0, numberOfPosts).map(post => (
          <FeedCard key={post.id} post={post} editorScheme="vscode" workspaceRoot="" />
        ))}
      </div>
    </TerminalProvider>
  );
}
