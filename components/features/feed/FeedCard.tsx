'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import type { FeedPost } from '@/lib/actions/feed';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

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

export function FeedCard({ post }: { post: FeedPost }) {
  const [expanded, setExpanded] = useState(false);
  const impact = impactConfig[post.impact_level] ?? impactConfig.notable;
  const agentType = getAgentTypeByIdentifier(post.agent_type);
  const ticketPath = buildTicketPath({ projectId: post.project_id, ticketId: post.ticket_id });
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
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1.5">
        <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60 transition-colors" />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 min-w-0 pb-6">
        {/* Meta line */}
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
          <Link href={ticketPath} className="hover:underline underline-offset-2 text-primary">
            {post.ticket_sequence ? `#${post.ticket_sequence} ` : ''}
            {post.ticket_title ?? 'Untitled ticket'}
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-lg border bg-card p-5">
          {/* Title row */}
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
            {humanActions.length > 0 && (
              <Badge
                className="shrink-0 rounded-full px-2 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                variant="secondary"
              >
                {humanActions.length} action{humanActions.length > 1 ? 's' : ''}
              </Badge>
            )}
            <Badge
              className={cn('shrink-0 rounded-full px-2 text-xs font-medium', impact.className)}
              variant="secondary"
            >
              {impact.label}
            </Badge>
          </div>

          {/* Human actions always visible when collapsed */}
          {!expanded && humanActions.length > 0 && (
            <div className="mt-2.5 ml-6 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 dark:border-blue-800/40 dark:bg-blue-950/20">
              <ul className="space-y-1">
                {humanActions.slice(0, 3).map((action, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300">
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

          {/* Expanded body */}
          {expanded && (
            <div className="mt-3.5 space-y-3.5">
              <MarkdownContent compact className="text-[15px] leading-6 text-muted-foreground">
                {post.body}
              </MarkdownContent>

              {/* Human action items */}
              {humanActions.length > 0 && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-800/40 dark:bg-blue-950/20">
                  <div className="mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                      Action required
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {humanActions.map((action, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                      >
                        <span className="shrink-0 mt-0.5">&#8226;</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tradeoff callouts */}
              {tradeoffs.length > 0 && (
                <div className="space-y-2">
                  {tradeoffs.map((t, i) => (
                    <div
                      key={i}
                      className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-800/40 dark:bg-amber-950/20"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="text-[13px]">
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          {t.decision}
                        </p>
                        {t.alternatives_considered && (
                          <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                            Alternatives: {t.alternatives_considered}
                          </p>
                        )}
                        {t.rationale && (
                          <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                            Rationale: {t.rationale}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Files touched */}
              {filesTouched.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span className="font-medium">Files:</span>
                  {filesTouched.slice(0, 5).map(f => (
                    <code key={f} className="rounded bg-muted px-1 py-0.5 text-xs">
                      {f}
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

          {/* Tags and agent info */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {agentType && (
              <span className="inline-flex items-center gap-1">
                <Image src={agentType.icon} alt={agentType.label} width={14} height={14} />
                {agentType.label}
              </span>
            )}
            {post.source_event_ids?.length > 0 && (
              <>
                <span className="text-muted-foreground/40">&middot;</span>
                <span>{post.source_event_ids.length} events</span>
              </>
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
