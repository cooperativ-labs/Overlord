'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Newspaper
} from 'lucide-react';
import Image from 'next/image';
import { useMemo, useState } from 'react';

import { FeedProjectFilter } from '@/components/features/feed/FeedProjectFilter';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { getCollapsedFileMentionLabel } from '@/lib/helpers/file-mentions';
import { cn } from '@/lib/utils';

import { DEMO_FEED_POSTS, DEMO_FEED_PROJECTS, type DemoFeedPost } from './mock-data';

const impactConfig: Record<string, { label: string; className: string }> = {
  minor: { label: 'Minor', className: 'bg-muted text-muted-foreground' },
  notable: {
    label: 'Notable',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
  },
  significant: {
    label: 'Significant',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  }
};

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

function DemoFeedCard({ post }: { post: DemoFeedPost }) {
  const [expanded, setExpanded] = useState(false);
  const impact = impactConfig[post.impact_level] ?? impactConfig.notable;
  const agentType = getAgentTypeByIdentifier(post.agent_type);
  const tradeoffs = Array.isArray(post.tradeoffs) ? post.tradeoffs : [];
  const humanActions = Array.isArray(post.human_actions) ? post.human_actions : [];
  const filesTouched = Array.isArray(post.files_touched) ? post.files_touched : [];

  const timestamp = new Date(post.created_at);
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = timestamp.toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });

  return (
    <article className="group relative flex gap-3.5">
      <div className="flex flex-col items-center pt-1.5">
        <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary/60" />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="min-w-0 flex-1 pb-6">
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
          <span className="text-muted-foreground/40">&middot;</span>
          <span className="text-primary">
            {post.ticket_sequence ? `#${post.ticket_sequence} ` : ''}
            {post.ticket_title ?? 'Untitled ticket'}
          </span>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="mb-2.5 flex items-start gap-2.5">
            <button
              type="button"
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <h3
              className="flex-1 cursor-pointer text-base font-semibold leading-snug"
              onClick={() => setExpanded(!expanded)}
            >
              {post.title}
            </h3>
            <Badge
              className={cn('shrink-0 rounded-full px-2 text-xs font-medium', impact.className)}
              variant="secondary"
            >
              {impact.label}
            </Badge>
          </div>

          {!expanded && humanActions.length > 0 && (
            <div className="mt-2.5 ml-6 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 dark:border-blue-800/40 dark:bg-blue-950/20">
              <ul className="space-y-1">
                {humanActions.slice(0, 3).map((action, index) => (
                  <li
                    key={index}
                    className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                  >
                    <span className="shrink-0">&#8226;</span>
                    <span>{action}</span>
                  </li>
                ))}
                {humanActions.length > 3 && (
                  <li className="text-[13px] text-blue-600/60 dark:text-blue-400/50">
                    +{humanActions.length - 3} more...
                  </li>
                )}
              </ul>
            </div>
          )}

          {expanded && (
            <div className="mt-3.5 space-y-3.5">
              <MarkdownContent compact className="text-[15px] leading-6 text-muted-foreground">
                {post.body}
              </MarkdownContent>

              {humanActions.length > 0 && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-800/40 dark:bg-blue-950/20">
                  <div className="mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                      Action required
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {humanActions.map((action, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                      >
                        <span className="mt-0.5 shrink-0">&#8226;</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tradeoffs.length > 0 && (
                <div className="space-y-2">
                  {tradeoffs.map((tradeoff, index) => (
                    <div
                      key={index}
                      className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-800/40 dark:bg-amber-950/20"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="text-[13px]">
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          {tradeoff.decision}
                        </p>
                        {tradeoff.alternatives_considered && (
                          <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                            Alternatives: {tradeoff.alternatives_considered}
                          </p>
                        )}
                        {tradeoff.rationale && (
                          <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                            Rationale: {tradeoff.rationale}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filesTouched.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span className="font-medium">Files:</span>
                  {filesTouched.slice(0, 5).map(file => (
                    <code
                      key={file}
                      title={file}
                      className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
                    >
                      {getCollapsedFileMentionLabel(file)}
                    </code>
                  ))}
                  {filesTouched.length > 5 && (
                    <span className="text-muted-foreground/60">
                      +{filesTouched.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {agentType && (
              <span className="inline-flex items-center gap-1">
                <Image src={agentType.icon} alt={agentType.label} width={14} height={14} />
                {agentType.label}
              </span>
            )}
            {post.tags?.length > 0 && (
              <>
                <span className="text-muted-foreground/40">&middot;</span>
                {post.tags.slice(0, 4).map(tag => (
                  <Badge key={tag} variant="outline" className="rounded-full px-1.5 py-0 text-xs">
                    {tag}
                  </Badge>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function DemoFeedList({
  posts,
  projects
}: {
  posts: DemoFeedPost[];
  projects: { id: string; name: string; color: string }[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState('all');

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return posts;
    return posts.filter(post => post.project_id === selectedProjectId);
  }, [posts, selectedProjectId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Feed</h1>
          <p className="text-xs text-muted-foreground">Recent review-ready updates and handoffs.</p>
        </div>
        <FeedProjectFilter
          projects={projects}
          value={selectedProjectId}
          onChange={setSelectedProjectId}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Newspaper className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm">No feed posts for this project yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Mock posts are generated from recent demo activity.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl">
            {filteredPosts.map(post => (
              <DemoFeedCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DemoFeedPage() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="rounded-2xl bg-background/80 px-6 py-5 text-center">
        <p className="text-lg font-semibold tracking-tight text-foreground">
          See a feed that turns completed agent work into readable project updates.
        </p>
      </div>

      <WindowFrame title="Feed" className="mx-auto max-w-[1200px]">
        <div className="h-[680px] overflow-hidden bg-background">
          <DemoFeedList posts={DEMO_FEED_POSTS} projects={DEMO_FEED_PROJECTS} />
        </div>
      </WindowFrame>
    </div>
  );
}
