'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, TicketPlus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ExternalLink } from '@/components/features/ExternalLink';
import {
  FeedPostDiscussPanel,
  type FeedProjectWorkspace
} from '@/components/features/feed/FeedPostDiscussPanel';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import type { FeedPost } from '@/lib/actions/feed';
import {
  type FeedRollupFileChange,
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '@/lib/helpers/feed-post-rollup';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildEditorHref } from '@/lib/helpers/file-changes';
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

const FILE_STATUS_GLYPH: Record<string, { ch: string; cls: string }> = {
  added: {
    ch: 'A',
    cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40'
  },
  modified: {
    ch: 'M',
    cls: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40'
  },
  deleted: {
    ch: 'D',
    cls: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40'
  },
  renamed: {
    ch: 'R',
    cls: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40'
  }
};

type FileChipProps = {
  change: FeedRollupFileChange;
  href: string | null;
};

function FileChip({ change, href }: FileChipProps) {
  const glyph = FILE_STATUS_GLYPH[change.status] ?? FILE_STATUS_GLYPH.modified;
  const name = change.path.split('/').pop() ?? change.path;
  const dir = change.path.slice(0, change.path.length - name.length).replace(/\/$/, '');
  const body = (
    <>
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold font-mono',
          glyph.cls
        )}
      >
        {glyph.ch}
      </span>
      {dir ? (
        <span className="font-mono text-[11px] text-muted-foreground/70 truncate max-w-[160px]">
          {dir}/
        </span>
      ) : null}
      <span className="font-mono text-[12px] text-foreground">{name}</span>
      {change.additions || change.deletions ? (
        <span className="font-mono text-[11px] text-muted-foreground/70">
          {change.additions ? (
            <span className="text-emerald-600 dark:text-emerald-400">+{change.additions}</span>
          ) : null}
          {change.additions && change.deletions ? ' ' : ''}
          {change.deletions ? (
            <span className="text-red-500 dark:text-red-400">−{change.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] hover:bg-muted/60 transition-colors';
  if (href) {
    return (
      <ExternalLink href={href} title={change.path} className={className}>
        {body}
      </ExternalLink>
    );
  }
  return (
    <span title={change.path} className={className}>
      {body}
    </span>
  );
}

function StatusBadge({ state }: { state: string }) {
  const lower = state.toLowerCase();
  if (lower === 'executing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        RUN
      </span>
    );
  }
  if (lower === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        DONE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      {state.toUpperCase()}
    </span>
  );
}

type FeedCardProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
};

export function FeedCard({ post, editorScheme, workspaceRoot, project }: FeedCardProps) {
  const [openObjectiveId, setOpenObjectiveId] = useState<string | null>(null);
  const [discussOpen, setDiscussOpen] = useState(false);
  const rollupSections = useMemo(
    () => normalizeFeedRollupObjectiveSections(post.objective_sections),
    [post.objective_sections]
  );
  const orphanFiles = useMemo(
    () => normalizeFeedRollupOrphanFiles(post.orphan_file_changes),
    [post.orphan_file_changes]
  );
  const actionsRequiredFromObjectives = useMemo(
    () => rollupSections.flatMap(s => s.action_required),
    [rollupSections]
  );
  const tradeoffsFromObjectives = useMemo(
    () => rollupSections.flatMap(s => s.tradeoffs),
    [rollupSections]
  );
  const useRollupUi = rollupSections.length > 0;
  const impact = impactConfig[post.impact_level] ?? impactConfig.notable;
  const agentType = getAgentTypeByIdentifier(post.agent_type);
  const ticketPath = buildTicketPath({ projectId: post.project_id, ticketId: post.ticket_id });
  const tradeoffs = Array.isArray(post.tradeoffs) ? post.tradeoffs : [];
  const humanActions = Array.isArray(post.human_actions) ? post.human_actions : [];
  const allActionsRequired = useMemo(
    () => [...actionsRequiredFromObjectives, ...humanActions],
    [actionsRequiredFromObjectives, humanActions]
  );
  const allTradeoffsMerged = useMemo(
    () => [...tradeoffsFromObjectives, ...tradeoffs],
    [tradeoffsFromObjectives, tradeoffs]
  );
  const filesTouched = Array.isArray(post.files_touched) ? post.files_touched : [];
  const ticketsCreated = Array.isArray(post.tickets_created) ? post.tickets_created : [];

  const timestamp = new Date(post.updated_at);
  const wasUpdated = post.updated_at !== post.created_at;
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const hrefFor = (path: string) =>
    workspaceRoot ? buildEditorHref(path, workspaceRoot, editorScheme) : null;

  const totalEvents = post.total_events ?? 0;
  const totalFiles = post.total_files ?? 0;
  const pendingActions = post.pending_actions ?? 0;

  return (
    <article className="group relative flex gap-3.5">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1.5">
        <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary/60" />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 min-w-0 pb-6">
        {/* Meta line */}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>
            {wasUpdated ? 'Updated ' : ''}
            {timeStr}
          </span>
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
          <Link href={ticketPath} className="text-primary underline-offset-2 hover:underline">
            {post.ticket_identifier ? `${post.ticket_identifier} ` : ''}
            {post.ticket_title ?? 'Untitled ticket'}
          </Link>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          {useRollupUi ? (
            <>
              {/* Title + impact */}
              <div className="flex items-start gap-2.5 border-b border-border/60 px-5 pb-3 pt-4">
                <h3 className="flex-1 break-words text-base font-semibold leading-snug">
                  {post.title}
                </h3>
                <Badge
                  className={cn(
                    'shrink-0 rounded-full px-2 text-xs font-medium',
                    impact.className
                  )}
                  variant="secondary"
                >
                  {impact.label}
                </Badge>
              </div>

              {/* Summary */}
              {post.summary.trim() ? (
                <div className="border-b border-border/60 px-5 pb-4 pt-4">
                  <div className="mb-1.5 flex items-center gap-2">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                      Summary
                    </div>
                    <div className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      live
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
                  {(totalEvents > 0 || totalFiles > 0 || pendingActions > 0 || post.tags?.length) ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {totalEvents > 0 ? (
                        <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {totalEvents} event{totalEvents === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {totalFiles > 0 ? (
                        <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {totalFiles} file{totalFiles === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {pendingActions > 0 ? (
                        <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {pendingActions} action{pendingActions === 1 ? '' : 's'}
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

              {/* Table header */}
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b border-border/60 bg-muted/40 px-5 py-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <div className="w-10">#</div>
                <div>Objective</div>
                <div className="text-right">Files</div>
                <div className="text-right">Time</div>
              </div>

              {/* Rows */}
              <div>
                {rollupSections.map((section, idx) => {
                  const isOpen = openObjectiveId === section.id;
                  const isLast = idx === rollupSections.length - 1;
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
                            <StatusBadge state={section.state} />
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
                          {section.time ?? ''}
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
                                    <FileChip
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
                        <FileChip
                          key={change.path}
                          change={change}
                          href={hrefFor(change.path)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Actions, tradeoffs, and tickets (objective-level items aggregated here) */}
              {allActionsRequired.length > 0 ||
              allTradeoffsMerged.length > 0 ||
              ticketsCreated.length > 0 ? (
                <div className="space-y-3 border-t border-border/60 px-5 py-4">
                  {allActionsRequired.length > 0 ? (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-950/20">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                          Action required
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {allActionsRequired.map((action, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                          >
                            <span className="mt-0.5 shrink-0">&#8226;</span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {allTradeoffsMerged.length > 0 ? (
                    <div className="space-y-2">
                      {allTradeoffsMerged.map((t, i) => (
                        <div
                          key={i}
                          className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <div className="text-[13px]">
                            <p className="font-medium text-amber-800 dark:text-amber-300">
                              {t.decision}
                            </p>
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

              {/* Agent footer */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-2 text-[12.5px] text-muted-foreground">
                {agentType ? (
                  <span className="inline-flex items-center gap-1">
                    <Image src={agentType.icon} alt={agentType.label} width={14} height={14} />
                    {agentType.label}
                  </span>
                ) : null}
              </div>

              {/* Discuss accordion */}
              <div className="border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setDiscussOpen(prev => !prev)}
                  className="flex w-full items-center justify-between px-5 py-2.5 text-[12.5px] hover:bg-muted/40"
                >
                  <span className="font-medium text-foreground/80">Discuss this update</span>
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
          ) : (
            <LegacyFeedBody
              post={post}
              editorScheme={editorScheme}
              workspaceRoot={workspaceRoot}
              project={project}
              impact={impact}
              humanActions={humanActions}
              tradeoffs={tradeoffs}
              ticketsCreated={ticketsCreated}
              filesTouched={filesTouched}
              agentType={agentType}
            />
          )}
        </div>
      </div>
    </article>
  );
}

type LegacyFeedBodyProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
  impact: { label: string; className: string };
  humanActions: string[];
  tradeoffs: Array<{ decision: string; alternatives_considered?: string; rationale?: string }>;
  ticketsCreated: FeedPost['tickets_created'];
  filesTouched: string[];
  agentType: ReturnType<typeof getAgentTypeByIdentifier>;
};

function LegacyFeedBody({
  post,
  editorScheme,
  workspaceRoot,
  project,
  impact,
  humanActions,
  tradeoffs,
  ticketsCreated,
  filesTouched,
  agentType
}: LegacyFeedBodyProps) {
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
                  <li
                    key={i}
                    className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                  >
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
        {agentType ? (
          <span className="inline-flex items-center gap-1">
            <Image src={agentType.icon} alt={agentType.label} width={14} height={14} />
            {agentType.label}
          </span>
        ) : null}
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
