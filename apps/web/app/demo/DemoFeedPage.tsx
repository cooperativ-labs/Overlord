'use client';

import { Newspaper } from 'lucide-react';

import { FeedCard } from '@/components/features/feed/FeedCard';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';
import { cn } from '@/lib/utils';

import { DEMO_FEED_POSTS } from '../../example-tickets/demo-frames/mock-feed-data';

function WindowFrame({
  children,
  title = 'Overlord',
  className
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-[#1a1a1a] shadow-2xl transition-shadow duration-500 dark:border-border/40">
        <div className="flex items-center gap-2 bg-[#2a2a2a] px-4 py-2.5 dark:bg-[#1e1e1e]">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs text-[#999]">{title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DemoFeedPage() {
  return (
    <TerminalProvider>
      <div className="mx-auto max-w-[1200px] space-y-4">
        <div className="rounded-2xl bg-background/80 px-6 py-5 text-center">
          <p className="text-lg font-semibold tracking-tight text-foreground">
            See a feed that turns completed agent work into readable project updates.
          </p>
        </div>

        <WindowFrame title="Feed" className="mx-auto max-w-[1200px]">
          <div className="h-[680px] overflow-hidden bg-background">
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
                <div>
                  <h1 className="text-lg font-semibold">Feed</h1>
                  <p className="text-xs text-muted-foreground">
                    Recent review-ready updates and handoffs.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {DEMO_FEED_POSTS.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                    <Newspaper className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm">No feed posts yet.</p>
                  </div>
                ) : (
                  <div className="mx-auto max-w-2xl">
                    {DEMO_FEED_POSTS.map(post => (
                      <FeedCard key={post.id} post={post} editorScheme="vscode" workspaceRoot="" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </WindowFrame>
      </div>
    </TerminalProvider>
  );
}
