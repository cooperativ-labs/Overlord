import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  TicketPlus
} from 'lucide-react';
import Link from 'next/link';
import { type Dispatch, type SetStateAction } from 'react';

import {
  FeedPostDiscussPanel,
  type FeedProjectWorkspace
} from '@/components/features/feed/FeedPostDiscussPanel';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import type { FeedPost } from '@/lib/actions/feed';
import {
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '@/lib/helpers/feed-post-rollup';
import { buildEditorHref } from '@/lib/helpers/file-changes';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

import { FeedCardAgentBadge } from './FeedCardAgentBadge';
import { FeedCardFileChip } from './FeedCardFileChip';

type FeedCardImpact = { label: string; className: string };

type FeedCardRollupBodyProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
  impact: FeedCardImpact;
  rollupSections: ReturnType<typeof normalizeFeedRollupObjectiveSections>;
  orphanFiles: ReturnType<typeof normalizeFeedRollupOrphanFiles>;
  actionsRequiredFromObjectives: string[];
  tradeoffsFromObjectives: Array<{
    decision: string;
    alternatives_considered?: string;
    rationale?: string;
  }>;
  ticketsCreated: NonNullable<FeedPost['tickets_created']>;
  openObjectiveId: string | null;
  setOpenObjectiveId: Dispatch<SetStateAction<string | null>>;
  discussOpen: boolean;
  setDiscussOpen: Dispatch<SetStateAction<boolean>>;
};

export function FeedCardRollupBody({
  post,
  editorScheme,
  workspaceRoot,
  project,
  impact,
  rollupSections,
  orphanFiles,
  actionsRequiredFromObjectives,
  tradeoffsFromObjectives,
  ticketsCreated,
  openObjectiveId,
  setOpenObjectiveId,
  discussOpen,
  setDiscussOpen
}: FeedCardRollupBodyProps) {
  const hrefFor = (path: string) =>
    workspaceRoot ? buildEditorHref(path, workspaceRoot, editorScheme) : null;


  return (
    <>
      <div className="flex items-start gap-2.5 border-b border-border/60 px-5 pb-3 pt-4">
        <h3 className="flex-1 break-words text-base font-semibold leading-snug">{post.title}</h3>
        <Badge
          className={cn('shrink-0 rounded-full px-2 text-xs font-medium', impact.className)}
          variant="secondary"
        >
          {impact.label}
        </Badge>
      </div>

      {post.summary.trim() ? (
        <div className="border-b border-border/60 px-5 pb-4 pt-4">
          <div className="mb-1.5 flex items-center gap-2">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
              Ticket summary
            </div>
          </div>
          <MarkdownContent
            compact
            className="text-[14.5px] leading-relaxed text-foreground/90"
            editorScheme={editorScheme}
            workspaceRoot={workspaceRoot}
          >
            {post.summary}
          </MarkdownContent>
          {post.total_events || post.total_files || post.pending_actions || post.tags?.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {post.total_events ? (
                <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {post.total_events} event{post.total_events === 1 ? '' : 's'}
                </span>
              ) : null}
              {post.total_files ? (
                <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {post.total_files} file{post.total_files === 1 ? '' : 's'}
                </span>
              ) : null}
              {post.pending_actions ? (
                <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {post.pending_actions} action{post.pending_actions === 1 ? '' : 's'}
                </span>
              ) : null}
              {post.tags?.slice(0, 6).map(tag => (
                <span
                  key={tag}
                  className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b border-border/60 bg-muted/40 px-5 py-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <div className="w-10">#</div>
        <div>Objective</div>
        <div className="text-right">Files</div>
        <div className="text-right">Time</div>
      </div>

      <div>
        {rollupSections.map((section, idx) => {
          const isOpen = openObjectiveId === section.id;
          const isLast = idx === rollupSections.length - 1;
          const sectionTime = section.updated_at
            ? new Date(section.updated_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit'
              })
            : '';

          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => setOpenObjectiveId(isOpen ? null : section.id)}
                className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-5 py-3 text-left hover:bg-muted/40"
              >
                <div className="flex w-10 items-center gap-1.5">
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground/70">
                    {String(section.index).padStart(2, '0')}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium leading-snug text-foreground">
                      {section.title}
                    </span>
                    <FeedCardAgentBadge
                      agentIdentifier={section.agent_identifier}
                      state={section.state}
                    />
                  </div>
                  {section.takeaway ? (
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {section.takeaway}
                    </div>
                  ) : null}
                </div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-foreground/80">
                  {section.file_changes.length}
                </div>
                <div className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                  {sectionTime}
                </div>
              </button>

              {isOpen ? (
                <div
                  className={cn(
                    'border-t border-border/60 bg-muted/20 px-5 py-4',
                    !isLast ? 'border-b' : ''
                  )}
                >
                  <div className="ml-[3.25rem] space-y-3.5">
                    {section.body.trim() ? (
                      <MarkdownContent
                        compact
                        className="text-[13px] leading-relaxed text-foreground/85"
                        editorScheme={editorScheme}
                        workspaceRoot={workspaceRoot}
                      >
                        {section.body}
                      </MarkdownContent>
                    ) : null}
                    <div>
                      <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/80">
                        Files &middot; this objective
                      </div>
                      {section.file_changes.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {section.file_changes.map(change => (
                            <FeedCardFileChip
                              key={change.path}
                              change={change}
                              href={hrefFor(change.path)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-[12px] italic text-muted-foreground/70">
                          No file changes recorded.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {!isLast && !isOpen ? <div className="border-b border-border/60" /> : null}
            </div>
          );
        })}

        {orphanFiles.length > 0 ? (
          <div className="border-t border-dashed border-border bg-muted/20 px-5 py-3">
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Ticket-level changes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {orphanFiles.map(change => (
                <FeedCardFileChip key={change.path} change={change} href={hrefFor(change.path)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {actionsRequiredFromObjectives.length > 0 ||
        tradeoffsFromObjectives.length > 0 ||
        ticketsCreated.length > 0 ? (
        <div className="space-y-3 border-t border-border/60 px-5 py-4">
          {actionsRequiredFromObjectives.length > 0 ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-950/20">
              <div className="mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  Action required
                </span>
              </div>
              <ul className="space-y-1">
                {actionsRequiredFromObjectives.map((action, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300">
                    <span className="mt-0.5 shrink-0">&#8226;</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {tradeoffsFromObjectives.length > 0 ? (
            <div className="space-y-2">
              {tradeoffsFromObjectives.map((t, i) => (
                <div
                  key={i}
                  className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20"
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
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-800/40 dark:bg-violet-950/20">
              <div className="mb-1.5 flex items-center gap-1.5">
                <TicketPlus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">
                  Tickets created
                </span>
              </div>
              <ul className="space-y-1">
                {ticketsCreated.map(t => (
                  <li
                    key={t.id}
                    className="flex gap-2 text-[13px] text-violet-800 dark:text-violet-300"
                  >
                    <span className="mt-0.5 shrink-0">&#8226;</span>
                    <Link
                      href={buildTicketPath({
                        projectId: post.project_id,
                        ticketId: t.id
                      })}
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

      <div className="border-t border-border/60">
        <button
          type="button"
          onClick={() => setDiscussOpen(prev => !prev)}
          className="flex w-full items-center justify-between px-5 py-2.5 text-[12.5px] hover:bg-muted/40"
        >
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" size={16} />
            <span className="font-medium text-foreground/80">Discuss this update</span>
          </div>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform',
              discussOpen ? 'rotate-180' : ''
            )}
          />
        </button>
        {discussOpen ? <FeedPostDiscussPanel post={post} project={project} /> : null}
      </div>
    </>
  );
}
