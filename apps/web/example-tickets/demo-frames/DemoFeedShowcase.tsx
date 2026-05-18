'use client';

import { FeedCard } from '@/components/features/feed/FeedCard';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';

import { DEMO_FEED_POSTS } from './mock-feed-data';

export function DemoFeedShowcase({ numberOfPosts = 3 }: { numberOfPosts?: number }) {
  return (
    <TerminalProvider>
      <div className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="mt-1 text-lg font-semibold text-white">The Feed</h3>
            <p className="mt-1 text-sm text-slate-400">
              Each ticket becomes a feed post that lets you explore the objectives, file changes,
              and delivery summaries.
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-background p-5 text-foreground shadow-inner">
          {DEMO_FEED_POSTS.slice(0, numberOfPosts).map(post => (
            <FeedCard key={post.id} post={post} editorScheme="vscode" workspaceRoot="" />
          ))}
        </div>
      </div>
    </TerminalProvider>
  );
}
