import { Bot, ChevronDown, Columns2, Filter, Info, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ParsedUnifiedDiff } from '@/lib/git/unified-diff';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { DiffViewMode } from '../CurrentChangesPage';

import { buildHunkMatches, formatStatus, lineNumber } from './helpers';
import { HunkPopoverContent } from './HunkPopoverContent';
import type { EnrichedCurrentChangeFile, TicketSummary } from './types';

type DiffPaneProps = {
  diff: ParsedUnifiedDiff | null;
  diffError: string | null;
  file: EnrichedCurrentChangeFile;
  isLoading: boolean;
  projectId: string;
  selectedFilePath: string | null;
  selectedTicketIds: Set<string>;
  viewMode: DiffViewMode;
  onFilterByTicket: (ticketId: string) => void;
  onToggleTicketFilter: (ticketId: string) => void;
  onViewModeChange: (mode: DiffViewMode) => void;
};

function formatAgentName(agent: string | null | undefined) {
  if (agent === 'claude-code') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  if (agent === 'opencode') return 'OpenCode';
  if (agent === 'cursor') return 'Cursor';
  if (agent === 'gemini') return 'Gemini';
  return 'Agent';
}

function SecondaryTicketBadge({
  isSelected,
  projectId,
  ticket,
  onFilter,
  onToggle
}: {
  isSelected: boolean;
  projectId: string;
  ticket: TicketSummary;
  onFilter: () => void;
  onToggle: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] hover:bg-muted',
            isSelected
              ? 'border-primary bg-primary/10 text-primary'
              : 'bg-background text-foreground'
          )}
          aria-pressed={isSelected}
        >
          <span className="truncate">
            {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
          </span>
          {ticket.status ? <span className="text-muted-foreground">· {ticket.status}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="space-y-1">
            <Link
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              href={buildTicketPath({ projectId, ticketId: ticket.id })}
            >
              {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
            </Link>
            <p className="text-xs text-muted-foreground">
              {ticket.objective?.trim() || 'No ticket objective yet.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={onFilter}
            >
              <Filter className="h-3 w-3" />
              Show only this ticket
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onToggle}
            >
              {isSelected ? 'Remove from filter' : 'Add to filter'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatSnapshotSummary(
  file: EnrichedCurrentChangeFile['primaryFileChange']
): string | null {
  if (!file) return null;
  const parts: string[] = [];

  const backend = file.checkpoint?.backend ?? file.snapshot_backend;
  const jjChangeId = file.checkpoint?.jj_change_id ?? file.jj_change_id;
  const jjCommitId = file.checkpoint?.jj_commit_id ?? file.jj_commit_id;
  const jjOperationId = file.checkpoint?.jj_operation_id ?? file.jj_operation_id;
  const gitCommitId = file.checkpoint?.git_commit_id ?? null;

  if (backend) {
    parts.push(backend === 'jj' ? 'JJ' : backend);
  }
  if (file.checkpoint_id) {
    parts.push('checkpointed');
  }
  if (jjChangeId) parts.push(`change ${jjChangeId.slice(0, 8)}`);
  if (jjCommitId) parts.push(`commit ${jjCommitId.slice(0, 8)}`);
  if (jjOperationId) parts.push(`op ${jjOperationId.slice(0, 8)}`);
  if (gitCommitId) parts.push(`git ${gitCommitId.slice(0, 8)}`);

  if (parts.length === 0 && file.snapshot_backend) {
    parts.push(file.snapshot_backend === 'jj' ? 'JJ' : file.snapshot_backend);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function DiffPane({
  diff,
  diffError,
  file,
  isLoading,
  projectId,
  selectedFilePath,
  selectedTicketIds,
  viewMode,
  onFilterByTicket,
  onToggleTicketFilter,
  onViewModeChange
}: DiffPaneProps) {
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);
  const [rationaleOpen, setRationaleOpen] = useState(true);
  const isFiltering = selectedTicketIds.size > 0;

  const secondaryTickets = useMemo(() => {
    if (!file.primaryTicket) return file.tickets;
    return file.tickets.filter(ticket => ticket.id !== file.primaryTicket?.id);
  }, [file.primaryTicket, file.tickets]);

  useEffect(() => {
    setOpenPopoverKey(null);
  }, [selectedFilePath]);

  const primaryTicketTitle =
    file.primaryTicket?.title?.trim() ||
    (file.primaryTicket ? `Ticket ${getTicketIdentifier(file.primaryTicket)}` : null);
  const changeLabel = file.primaryFileChange?.label || file.summary;
  const snapshotSummary = formatSnapshotSummary(file.primaryFileChange);
  const hasRationale = Boolean(file.primaryFileChange || file.primaryTicket);
  const linesAdded = file.file.linesAdded;
  const linesRemoved = file.file.linesRemoved;
  const showSideBySide = viewMode === 'side-by-side';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-foreground">{file.path}</p>
          {file.file.originalPath ? (
            <p className="truncate text-[10px] text-muted-foreground">
              from {file.file.originalPath}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px]">
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
                viewMode === 'inline'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onViewModeChange('inline')}
              aria-pressed={viewMode === 'inline'}
            >
              Inline
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
                viewMode === 'side-by-side'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onViewModeChange('side-by-side')}
              aria-pressed={viewMode === 'side-by-side'}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Side-by-side
            </button>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground">
            {formatStatus(file.file.status)}
          </span>
          {linesAdded !== null && linesAdded !== undefined ? (
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              +{linesAdded}
            </span>
          ) : null}
          {linesRemoved !== null && linesRemoved !== undefined ? (
            <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
              −{linesRemoved}
            </span>
          ) : null}
          {file.primaryTicket?.latest_objective_agent ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Bot className="h-3 w-3" />
              {formatAgentName(file.primaryTicket.latest_objective_agent)}
            </span>
          ) : null}
        </div>
      </div>

      {hasRationale ? (
        <Collapsible open={rationaleOpen} onOpenChange={setRationaleOpen} className="border-b">
          <div className="flex items-center gap-2 px-4 py-2">
            <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              {file.primaryTicket ? (
                <Link
                  className="truncate text-xs font-medium text-foreground underline-offset-4 hover:underline"
                  href={buildTicketPath({ projectId, ticketId: file.primaryTicket.id })}
                >
                  {primaryTicketTitle}
                </Link>
              ) : (
                <span className="text-xs font-medium text-foreground">No linked ticket</span>
              )}
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <span className="text-xs text-muted-foreground">{changeLabel}</span>
              {snapshotSummary ? (
                <>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="text-xs text-muted-foreground">{snapshotSummary}</span>
                </>
              ) : null}
            </div>
            {file.primaryTicket?.status ? (
              <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                {file.primaryTicket.status}
              </Badge>
            ) : null}
            {secondaryTickets.length > 0 ? (
              <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">
                +{secondaryTickets.length}
              </Badge>
            ) : null}
            {file.primaryTicket ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onFilterByTicket(file.primaryTicket!.id)}
                    aria-label="Show only files for this ticket"
                  >
                    <Filter className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Filter list to this ticket</TooltipContent>
              </Tooltip>
            ) : null}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={rationaleOpen ? 'Collapse rationale' : 'Expand rationale'}
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', rationaleOpen ? '' : '-rotate-90')}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-3 px-4 pb-3">
            {file.primaryTicket?.objective?.trim() ? (
              <p className="text-xs text-muted-foreground">{file.primaryTicket.objective}</p>
            ) : null}

            {file.primaryFileChange?.why || file.primaryFileChange?.impact ? (
              <div className="grid gap-3 md:grid-cols-2">
                {file.primaryFileChange?.why ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Why
                    </p>
                    <p className="mt-0.5 text-xs text-foreground">{file.primaryFileChange.why}</p>
                  </div>
                ) : null}
                {file.primaryFileChange?.impact ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Impact
                    </p>
                    <p className="mt-0.5 text-xs text-foreground">
                      {file.primaryFileChange.impact}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {secondaryTickets.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Other linked tickets
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {secondaryTickets.map(ticket => (
                    <SecondaryTicketBadge
                      key={ticket.id}
                      isSelected={selectedTicketIds.has(ticket.id)}
                      projectId={projectId}
                      ticket={ticket}
                      onFilter={() => onFilterByTicket(ticket.id)}
                      onToggle={() => onToggleTicketFilter(ticket.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {file.primaryTicket && file.tickets.length > 0 && !isFiltering ? (
              <p className="text-[10px] text-muted-foreground">
                Tip: use the filter icon to scope the file list to this ticket, or open the toolbar
                filter to combine tickets.
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-muted/10">
        <div className="space-y-3 p-3">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading diff…
            </div>
          ) : diffError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
              {diffError}
            </div>
          ) : !diff || diff.hunks.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-lg border p-6 text-sm text-muted-foreground">
              No diff preview is available for this file yet.
            </div>
          ) : (
            diff.hunks.map(hunk => {
              const matches = buildHunkMatches(file.rationales, file.file, hunk);

              return (
                <div key={hunk.id} className="overflow-hidden rounded-md border bg-background">
                  <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
                    <span className="truncate">{hunk.header}</span>
                    {matches.length > 0 ? (
                      <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        {matches.length} linked
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-xs">
                    {showSideBySide ? (
                      <div className="grid grid-cols-2">
                        <div className="border-r bg-muted/20">
                          <p className="border-b bg-muted/40 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Old
                          </p>
                          {hunk.lines.map(line => {
                            const isChanged = line.kind !== 'add';
                            return (
                              <div
                                key={`${line.key}-old`}
                                className={cn(
                                  'grid grid-cols-[44px_minmax(0,1fr)] items-start gap-2 px-3 py-0.5',
                                  line.kind === 'del' && 'bg-rose-500/10',
                                  line.kind === 'context' && 'text-muted-foreground',
                                  isChanged && 'hover:bg-muted/60'
                                )}
                              >
                                <span className="select-none text-right text-[10px] text-muted-foreground">
                                  {lineNumber(line.oldLineNumber)}
                                </span>
                                <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                                  {line.kind === 'add' ? '' : line.kind === 'del' ? '-' : ' '}
                                  {line.kind === 'add' ? '' : line.content}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div>
                          <p className="border-b bg-muted/40 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            New
                          </p>
                          {hunk.lines.map(line => {
                            const isChanged = line.kind !== 'del';
                            const popoverKey = `${hunk.id}:${line.key}`;
                            const row = (
                              <div
                                className={cn(
                                  'grid grid-cols-[44px_minmax(0,1fr)] items-start gap-2 px-3 py-0.5 text-left',
                                  line.kind === 'add' && 'bg-emerald-500/10',
                                  line.kind === 'context' && 'text-muted-foreground',
                                  isChanged && 'hover:bg-muted/60'
                                )}
                              >
                                <span className="select-none text-right text-[10px] text-muted-foreground">
                                  {lineNumber(line.newLineNumber)}
                                </span>
                                <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                                  {line.kind === 'del' ? '' : line.kind === 'add' ? '+' : ' '}
                                  {line.kind === 'del' ? '' : line.content}
                                </span>
                              </div>
                            );

                            if (!isChanged) {
                              return <div key={line.key}>{row}</div>;
                            }

                            return (
                              <Popover
                                key={line.key}
                                open={openPopoverKey === popoverKey}
                                onOpenChange={open => setOpenPopoverKey(open ? popoverKey : null)}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="w-full"
                                    onClick={() => setOpenPopoverKey(popoverKey)}
                                  >
                                    {row}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-[420px]">
                                  <HunkPopoverContent
                                    fileTickets={file.tickets}
                                    matches={matches}
                                    projectId={projectId}
                                    onFilterByTicket={onFilterByTicket}
                                  />
                                </PopoverContent>
                              </Popover>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      hunk.lines.map(line => {
                        const isChanged = line.kind !== 'context';
                        const popoverKey = `${hunk.id}:${line.key}`;
                        const row = (
                          <div
                            className={cn(
                              'grid grid-cols-[44px_44px_minmax(0,1fr)] items-start gap-2 px-3 py-0.5 text-left',
                              line.kind === 'add' && 'bg-emerald-500/10',
                              line.kind === 'del' && 'bg-rose-500/10',
                              isChanged && 'hover:bg-muted/60'
                            )}
                          >
                            <span className="select-none text-right text-[10px] text-muted-foreground">
                              {lineNumber(line.oldLineNumber)}
                            </span>
                            <span className="select-none text-right text-[10px] text-muted-foreground">
                              {lineNumber(line.newLineNumber)}
                            </span>
                            <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                              {line.content}
                            </span>
                          </div>
                        );

                        if (!isChanged) {
                          return <div key={line.key}>{row}</div>;
                        }

                        return (
                          <Popover
                            key={line.key}
                            open={openPopoverKey === popoverKey}
                            onOpenChange={open => setOpenPopoverKey(open ? popoverKey : null)}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="w-full"
                                onClick={() => setOpenPopoverKey(popoverKey)}
                              >
                                {row}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[420px]">
                              <HunkPopoverContent
                                fileTickets={file.tickets}
                                matches={matches}
                                projectId={projectId}
                                onFilterByTicket={onFilterByTicket}
                              />
                            </PopoverContent>
                          </Popover>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
