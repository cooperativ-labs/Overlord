'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CachedFeedPost } from '@/lib/offline/offline-feed-cache';
import { getCachedFeedPosts } from '@/lib/offline/offline-feed-cache';

import { OfflineTicketForm } from './OfflineTicketForm';

type Props = {
  onRetry: () => Promise<boolean>;
};

const impactColors: Record<string, string> = {
  minor: 'bg-muted text-muted-foreground',
  notable: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  significant: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
};

function FeedSection({ cachedPosts }: { cachedPosts: CachedFeedPost[] }) {
  if (cachedPosts.length === 0) {
    return (
      <div className="flex flex-col gap-1 text-left">
        <h2 className="text-sm font-medium">Recent feed</h2>
        <p className="text-xs text-muted-foreground">No cached posts available.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Recent feed</h2>
        <p className="text-xs text-muted-foreground">
          Showing the last {cachedPosts.length} posts from your last session.
        </p>
      </div>
      <div className="w-full space-y-3">
        {cachedPosts.map(post => {
          const timestamp = new Date(post.created_at);
          const timeStr = timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          });
          const dateStr = timestamp.toLocaleDateString([], {
            month: 'short',
            day: 'numeric'
          });
          const impactClass = impactColors[post.impact_level] ?? impactColors.notable;

          return (
            <div key={post.id} className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <span>{timeStr}</span>
                <span className="text-muted-foreground/40">&middot;</span>
                <span>{dateStr}</span>
                <span className="text-muted-foreground/40">&middot;</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: post.project_color }}
                  />
                  {post.project_name}
                </span>
                {post.ticket_sequence && (
                  <>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span>
                      #{post.ticket_sequence} {post.ticket_title ?? 'Untitled'}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{post.title}</p>
                <Badge
                  className={`shrink-0 rounded-full px-2 text-xs font-medium ${impactClass}`}
                  variant="secondary"
                >
                  {post.impact_level.charAt(0).toUpperCase() + post.impact_level.slice(1)}
                </Badge>
              </div>
              {post.human_actions.length > 0 && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800/40 dark:bg-blue-950/20">
                  <ul className="space-y-0.5">
                    {post.human_actions.slice(0, 2).map((action, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                      >
                        <span className="shrink-0">&#8226;</span>
                        <span>{action}</span>
                      </li>
                    ))}
                    {post.human_actions.length > 2 && (
                      <li className="text-[13px] text-blue-600/60 dark:text-blue-400/50">
                        +{post.human_actions.length - 2} more...
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TicketSection() {
  return (
    <div className="flex flex-col gap-3 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Create tickets while you wait</h2>
        <p className="text-xs text-muted-foreground">
          Queue tickets now and they&apos;ll be submitted automatically when you&apos;re back
          online.
        </p>
      </div>
      <OfflineTicketForm />
    </div>
  );
}

export function ElectronOfflineScreen({ onRetry }: Props) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const [cachedPosts, setCachedPosts] = useState<CachedFeedPost[]>([]);

  useEffect(() => {
    setCachedPosts(getCachedFeedPosts());
  }, []);

  async function handleRetry() {
    setIsRetrying(true);
    setRetryFailed(false);
    const connected = await onRetry();
    setIsRetrying(false);
    if (!connected) {
      setRetryFailed(true);
    }
  }

  return (
    <div className="flex h-full w-full max-w-[1500px] flex-col overflow-y-auto px-4 py-6 sm:px-6">
      {/* Header with offline indicator and retry */}
      <div className="mb-6 flex items-center gap-4 text-center justify-between bg-amber-600/20 p-3 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="text-left">
            <h1 className="text-lg font-semibold tracking-tight">No Internet Connection</h1>
            <p className="text-sm text-muted-foreground">
              Overlord will reconnect automatically when the network is available.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Button onClick={handleRetry} disabled={isRetrying} variant="outline" size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
            {isRetrying ? 'Checking...' : 'Try Again'}
          </Button>

          {retryFailed && (
            <p className="text-xs text-muted-foreground">Still no connection.</p>
          )}
        </div>
      </div>

      {/* Main content: Two-column layout on desktop, stacked on mobile */}
      {/* Mobile: Ticket section first, then feed */}
      {/* Desktop: Feed on left, tickets on right */}
      <div className="flex flex-1 flex-col gap-6 md:flex-row md:gap-12">
        {/* Ticket section - shows first on mobile (order-1), second on desktop (md:order-2) */}
        <div className="order-1 w-full md:order-2 md:w-1/2 lg:w-2/5">
          <TicketSection />
        </div>

        {/* Feed section - shows second on mobile (order-2), first on desktop (md:order-1) */}
        <div className="order-2 w-full md:order-1 md:w-1/2 lg:w-3/5">
          <FeedSection cachedPosts={cachedPosts} />
        </div>
      </div>
    </div>
  );
}
