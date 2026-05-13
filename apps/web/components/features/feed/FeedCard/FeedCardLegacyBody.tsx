import { AlertTriangle, CheckCircle2, ChevronDown, TicketPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ExternalLink } from '@/components/features/ExternalLink';
import {
  FeedPostDiscussPanel,
  type FeedProjectWorkspace
} from '@/components/features/feed/FeedPostDiscussPanel';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import type { FeedPost } from '@/lib/actions/feed';
import { buildEditorHref } from '@/lib/helpers/file-changes';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

type FeedCardImpact = { label: string; className: string };

type FeedCardLegacyBodyProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
  impact: FeedCardImpact;
  humanActions: string[];
  tradeoffs: Array<{ decision: string; alternatives_considered?: string; rationale?: string }>;
  ticketsCreated: NonNullable<FeedPost['tickets_created']>;
  filesTouched: string[];
};

export function FeedCardLegacyBody({
  post,
  editorScheme,
  workspaceRoot,
  project,
  impact,
  humanActions,
  tradeoffs,
  ticketsCreated,
  filesTouched
}: FeedCardLegacyBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const fileLinks = filesTouched.map(path => ({
    path,
    href: workspaceRoot ? buildEditorHref(path, workspaceRoot, editorScheme) : null
  }));

  return (
    <div className="p-5">
      <div className="mb-2.5 flex items-start gap-2.5">
        <button
          type="button"
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpanded(prev => !prev)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', expanded ? '' : '-rotate-90')}
          />
        </button>
        <h3
          className="flex-1 cursor-pointer break-words text-base font-semibold leading-snug"
          onClick={() => setExpanded(prev => !prev)}
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

      {!expanded && humanActions.length > 0 ? (
        <div className="ml-6 mt-2.5 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 dark:border-blue-800/40 dark:bg-blue-950/20">
          <ul className="space-y-1">
            {humanActions.slice(0, 3).map((action, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300">
                <span className="shrink-0">&#8226;</span>
                <span>{action}</span>
              </li>
            ))}
            {humanActions.length > 3 ? (
              <li className="text-[13px] text-blue-600/60 dark:text-blue-400/50">
                +{humanActions.length - 3} more...
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3.5 space-y-3.5">
          <MarkdownContent
            compact
            className="text-[15px] leading-6 text-muted-foreground"
            editorScheme={editorScheme}
            workspaceRoot={workspaceRoot}
          >
            {post.body}
          </MarkdownContent>

          {humanActions.length > 0 ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-800/40 dark:bg-blue-950/20">
              <div className="mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  Action required
                </span>
              </div>
              <ul className="space-y-1.5">
                {humanActions.map((action, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300">
                    <span className="mt-0.5 shrink-0">&#8226;</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tradeoffs.length > 0 ? (
            <div className="space-y-2">
              {tradeoffs.map((t, i) => (
                <div
                  key={i}
                  className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-800/40 dark:bg-amber-950/20"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-[13px]">
                    <p className="font-medium text-amber-800 dark:text-amber-300">{t.decision}</p>
                    {t.alternatives_considered ? (
                      <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                        Alternatives: {t.alternatives_considered}
                      </p>
                    ) : null}
                    {t.rationale ? (
                      <p className="mt-1 text-amber-700/80 dark:text-amber-400/70">
                        Rationale: {t.rationale}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {ticketsCreated.length > 0 ? (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3.5 dark:border-violet-800/40 dark:bg-violet-950/20">
              <div className="mb-2 flex items-center gap-1.5">
                <TicketPlus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">
                  Tickets created
                </span>
              </div>
              <ul className="space-y-1.5">
                {ticketsCreated.map(t => (
                  <li
                    key={t.id}
                    className="flex gap-2 text-[13px] text-violet-800 dark:text-violet-300"
                  >
                    <span className="mt-0.5 shrink-0">&#8226;</span>
                    <Link
                      href={buildTicketPath({ projectId: post.project_id, ticketId: t.id })}
                      className="underline-offset-2 hover:underline"
                    >
                      {t.reference ?? t.sequence}: {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {filesTouched.length > 0 ? (
        <div className="ml-6 mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          {fileLinks.map(({ path, href }) => {
            const name = path.split('/').pop() ?? path;
            if (href) {
              return (
                <ExternalLink
                  key={path}
                  href={href}
                  title={path}
                  className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs underline-offset-4 transition-colors hover:bg-muted hover:underline"
                >
                  {name}
                </ExternalLink>
              );
            }

            return (
              <span
                key={path}
                title={path}
                className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
              >
                {name}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        {post.tags?.length ? (
          <>
            <span className="text-muted-foreground/40">&middot;</span>
            {post.tags.slice(0, 4).map(tag => (
              <Badge key={tag} variant="outline" className="rounded-full px-1.5 py-0 text-xs">
                {tag}
              </Badge>
            ))}
          </>
        ) : null}
      </div>

      {expanded ? <FeedPostDiscussPanel post={post} project={project} /> : null}
    </div>
  );
}
