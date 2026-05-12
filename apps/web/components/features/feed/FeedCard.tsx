'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  TicketPlus
} from 'lucide-react';
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
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import {
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '@/lib/helpers/feed-post-rollup';
import { buildEditorHref } from '@/lib/helpers/file-changes';
import { getCollapsedFileMentionLabel } from '@/lib/helpers/file-mentions';
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

type FeedCardProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
};

export function FeedCard({ post, editorScheme, workspaceRoot, project }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [openObjectiveIds, setOpenObjectiveIds] = useState<Record<string, boolean>>({});
  const rollupSections = useMemo(
    () => normalizeFeedRollupObjectiveSections(post.objective_sections),
    [post.objective_sections]
  );
  const orphanFiles = useMemo(
    () => normalizeFeedRollupOrphanFiles(post.orphan_file_changes),
    [post.orphan_file_changes]
  );
  const useRollupUi = rollupSections.length > 0;
  const impact = impactConfig[post.impact_level] ?? impactConfig.notable;
  const agentType = getAgentTypeByIdentifier(post.agent_type);
  const ticketPath = buildTicketPath({ projectId: post.project_id, ticketId: post.ticket_id });
  const tradeoffs = Array.isArray(post.tradeoffs) ? post.tradeoffs : [];
  const humanActions = Array.isArray(post.human_actions) ? post.human_actions : [];
  const filesTouched = Array.isArray(post.files_touched) ? post.files_touched : [];
  const ticketsCreated = Array.isArray(post.tickets_created) ? post.tickets_created : [];
  const fileLinks = filesTouched.map(path => ({
    path,
    href: workspaceRoot ? buildEditorHref(path, workspaceRoot, editorScheme) : null
  }));

  const timestamp = new Date(post.updated_at);
  const wasUpdated = post.updated_at !== post.created_at;
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = timestamp.toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });

  const scanChipRow =
    useRollupUi && (post.total_events > 0 || post.total_files > 0 || post.pending_actions > 0) ? (
      <div className="mt-2 ml-6 flex flex-wrap gap-2">
        {post.total_events > 0 ? (
          <Badge variant="outline" className="rounded-full px-2 py-0 text-xs font-normal">
            {post.total_events} event{post.total_events === 1 ? '' : 's'}
          </Badge>
        ) : null}
        {post.total_files > 0 ? (
          <Badge variant="outline" className="rounded-full px-2 py-0 text-xs font-normal">
            {post.total_files} file{post.total_files === 1 ? '' : 's'}
          </Badge>
        ) : null}
        {post.pending_actions > 0 ? (
          <Badge variant="outline" className="rounded-full px-2 py-0 text-xs font-normal">
            {post.pending_actions} action{post.pending_actions === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>
    ) : null;

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
          <Link href={ticketPath} className="hover:underline underline-offset-2 text-primary">
            {post.ticket_identifier ? `${post.ticket_identifier} ` : ''}
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
              className="flex-1 cursor-pointer text-base font-semibold leading-snug break-words"
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

          {useRollupUi ? scanChipRow : null}

          {useRollupUi && post.summary.trim() && !expanded ? (
            <div className="mt-2 ml-6 max-h-[5.5rem] overflow-hidden text-[15px] leading-6 text-muted-foreground">
              <MarkdownContent
                compact
                className="line-clamp-4"
                editorScheme={editorScheme}
                workspaceRoot={workspaceRoot}
              >
                {post.summary}
              </MarkdownContent>
            </div>
          ) : null}

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
          {expanded && useRollupUi && (
            <div className="mt-3.5 space-y-4">
              {post.summary.trim() ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Summary
                  </p>
                  <MarkdownContent
                    compact
                    className="text-[15px] leading-6 text-muted-foreground"
                    editorScheme={editorScheme}
                    workspaceRoot={workspaceRoot}
                  >
                    {post.summary}
                  </MarkdownContent>
                </div>
              ) : null}

              {orphanFiles.length > 0 ? (
                <div className="rounded-md border border-border/60 bg-muted/30 p-3.5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ticket-wide changes
                  </p>
                  <ul className="space-y-1 text-[13px] text-muted-foreground">
                    {orphanFiles.map(change => {
                      const href = workspaceRoot
                        ? buildEditorHref(change.path, workspaceRoot, editorScheme)
                        : null;
                      return (
                        <li key={change.path} className="flex flex-wrap gap-x-2">
                          {href ? (
                            <ExternalLink
                              href={href}
                              title={change.path}
                              className="font-mono text-xs text-primary hover:underline underline-offset-2"
                            >
                              {getCollapsedFileMentionLabel(change.path)}
                            </ExternalLink>
                          ) : (
                            <span className="font-mono text-xs">
                              {getCollapsedFileMentionLabel(change.path)}
                            </span>
                          )}
                          <span className="text-muted-foreground/70">· {change.status}</span>
                          {change.note ? (
                            <span className="text-muted-foreground/60">({change.note})</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-3">
                {rollupSections.map(section => {
                  const isOpen = !!openObjectiveIds[section.id];
                  return (
                    <div key={section.id} className="border-l-2 border-primary/25 pl-3.5">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Objective {section.index}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-5 rounded px-1.5 text-[10px] font-normal"
                        >
                          {section.state}
                        </Badge>
                        {section.time ? (
                          <span className="text-[11px] text-muted-foreground">{section.time}</span>
                        ) : null}
                        {section.duration ? (
                          <span className="text-[11px] text-muted-foreground">
                            &middot; {section.duration}
                          </span>
                        ) : null}
                        {section.events > 0 ? (
                          <span className="text-[11px] text-muted-foreground">
                            &middot; {section.events} event{section.events === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm font-medium leading-snug text-foreground">
                        {section.title}
                      </p>
                      {section.takeaway ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                          {section.takeaway}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                        onClick={() =>
                          setOpenObjectiveIds(prev => ({
                            ...prev,
                            [section.id]: !prev[section.id]
                          }))
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {isOpen ? 'Hide detail' : 'Show detail'}
                      </button>
                      {isOpen ? (
                        <div className="mt-2 space-y-3">
                          {section.body.trim() ? (
                            <MarkdownContent
                              compact
                              className="text-[14px] leading-6 text-muted-foreground"
                              editorScheme={editorScheme}
                              workspaceRoot={workspaceRoot}
                            >
                              {section.body}
                            </MarkdownContent>
                          ) : null}
                          {section.file_changes.length > 0 ? (
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">
                                Files
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {section.file_changes.map(change => {
                                  const href = workspaceRoot
                                    ? buildEditorHref(change.path, workspaceRoot, editorScheme)
                                    : null;
                                  return href ? (
                                    <ExternalLink
                                      key={`${section.id}-${change.path}`}
                                      href={href}
                                      title={change.path}
                                      className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs underline-offset-4 transition-colors hover:bg-muted hover:underline"
                                    >
                                      {getCollapsedFileMentionLabel(change.path)}
                                    </ExternalLink>
                                  ) : (
                                    <span
                                      key={`${section.id}-${change.path}`}
                                      title={change.path}
                                      className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
                                    >
                                      {getCollapsedFileMentionLabel(change.path)}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          {section.action_required.length > 0 ? (
                            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-950/20">
                              <p className="mb-1 text-xs font-semibold text-blue-800 dark:text-blue-300">
                                Action required (objective)
                              </p>
                              <ul className="space-y-1">
                                {section.action_required.map((action, i) => (
                                  <li
                                    key={i}
                                    className="flex gap-2 text-[13px] text-blue-800 dark:text-blue-300"
                                  >
                                    <span className="shrink-0">&#8226;</span>
                                    <span>{action}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {section.tradeoffs.length > 0 ? (
                            <div className="space-y-2">
                              {section.tradeoffs.map((t, i) => (
                                <div
                                  key={i}
                                  className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20"
                                >
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                  <div className="text-[12px]">
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
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {expanded && !useRollupUi && (
            <div className="mt-3.5 space-y-3.5">
              <MarkdownContent
                compact
                className="text-[15px] leading-6 text-muted-foreground"
                editorScheme={editorScheme}
                workspaceRoot={workspaceRoot}
              >
                {post.body}
              </MarkdownContent>
            </div>
          )}

          {expanded && (
            <div className="mt-3.5 space-y-3.5">
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

              {/* Tickets created by agent */}
              {ticketsCreated.length > 0 && (
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
                        <span className="shrink-0 mt-0.5">&#8226;</span>
                        <Link
                          href={buildTicketPath({ projectId: post.project_id, ticketId: t.id })}
                          className="hover:underline underline-offset-2"
                        >
                          {t.reference ?? t.sequence}: {t.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Files touched — always visible (legacy layout; rollup lists files per objective) */}
          {filesTouched.length > 0 && !useRollupUi && (
            <div className="mt-2.5 ml-6 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              {fileLinks.map(({ path, href }) => {
                if (href) {
                  return (
                    <ExternalLink
                      key={path}
                      href={href}
                      title={path}
                      className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs underline-offset-4 transition-colors hover:bg-muted hover:underline"
                    >
                      {getCollapsedFileMentionLabel(path)}
                    </ExternalLink>
                  );
                }

                return (
                  <span
                    key={path}
                    title={path}
                    className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
                  >
                    {getCollapsedFileMentionLabel(path)}
                  </span>
                );
              })}
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
            {post.source_event_ids?.length > 0 && !useRollupUi && (
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
          {expanded && <FeedPostDiscussPanel post={post} project={project} />}
        </div>
      </div>
    </article>
  );
}
