import { Bot, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ParsedUnifiedDiff } from '@/lib/git/unified-diff';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

import { buildHunkMatches, lineNumber } from './helpers';
import { HunkPopoverContent } from './HunkPopoverContent';
import type { EnrichedCurrentChangeFile } from './types';

type DiffPaneProps = {
  diff: ParsedUnifiedDiff | null;
  diffError: string | null;
  file: EnrichedCurrentChangeFile;
  isLoading: boolean;
  projectId: string;
  selectedFilePath: string | null;
};

function formatAgentName(agent: string | null | undefined) {
  if (agent === 'claude-code') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  if (agent === 'opencode') return 'OpenCode';
  if (agent === 'cursor') return 'Cursor';
  if (agent === 'gemini') return 'Gemini';
  return 'Agent';
}

export function DiffPane({
  diff,
  diffError,
  file,
  isLoading,
  projectId,
  selectedFilePath
}: DiffPaneProps) {
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);

  const secondaryTickets = useMemo(() => {
    if (!file.primaryTicket) return file.tickets;
    return file.tickets.filter(ticket => ticket.id !== file.primaryTicket?.id);
  }, [file.primaryTicket, file.tickets]);

  useEffect(() => {
    setOpenPopoverKey(null);
  }, [selectedFilePath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{file.path}</p>
            <p className="text-xs text-muted-foreground">
              Click a changed line to inspect linked rationale.
            </p>
          </div>
          {file.primaryTicket?.recent_agent ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              {formatAgentName(file.primaryTicket.recent_agent)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Review context</Badge>
              {file.primaryTicket ? (
                <Link
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  href={buildTicketPath({ projectId, ticketId: file.primaryTicket.id })}
                >
                  {file.primaryTicket.title?.trim() || `Ticket ${file.primaryTicket.id.slice(-8)}`}
                </Link>
              ) : (
                <p className="font-medium text-foreground">No linked ticket yet</p>
              )}
              {file.primaryTicket?.status ? (
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {file.primaryTicket.status}
                </Badge>
              ) : null}
            </div>

            <p className="mt-2 text-sm text-muted-foreground">
              {file.primaryTicket?.objective?.trim() || file.summary}
            </p>

            {secondaryTickets.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {secondaryTickets.map(ticket => (
                  <Badge
                    key={ticket.id}
                    variant="outline"
                    className="max-w-full truncate text-[10px]"
                  >
                    {ticket.title?.trim() || `Ticket ${ticket.id.slice(-8)}`}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-background p-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span>Change</span>
                  {file.primaryFileChange?.is_draft ? (
                    <Badge variant="outline" className="h-5 rounded-full px-2 text-[9px]">
                      Draft
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-foreground">
                  {file.primaryFileChange?.label || file.summary}
                </p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why</p>
                <p className="mt-1 text-sm text-foreground">
                  {file.primaryFileChange?.why || 'No rationale has been linked to this file yet.'}
                </p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Impact</p>
                <p className="mt-1 text-sm text-foreground">
                  {file.primaryFileChange?.impact ||
                    'Review the diff below to confirm the intended impact.'}
                </p>
              </div>
            </div>
          </div>

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
                <div key={hunk.id} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-3 bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{hunk.header}</span>
                    {matches.length > 0 ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                        {matches.length} linked
                      </span>
                    ) : file.tickets.length > 0 ? (
                      <span className="rounded-full border border-muted-foreground/20 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {file.tickets.length} {file.tickets.length === 1 ? 'ticket' : 'tickets'}
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-xs">
                    {hunk.lines.map(line => {
                      const isChanged = line.kind !== 'context';
                      const popoverKey = `${hunk.id}:${line.key}`;
                      const row = (
                        <div
                          className={cn(
                            'grid grid-cols-[56px_56px_minmax(0,1fr)] items-start gap-3 px-3 py-1.5 text-left',
                            line.kind === 'add' && 'bg-emerald-500/10',
                            line.kind === 'del' && 'bg-rose-500/10',
                            isChanged && 'hover:bg-muted/60'
                          )}
                        >
                          <span className="select-none text-right text-[11px] text-muted-foreground">
                            {lineNumber(line.oldLineNumber)}
                          </span>
                          <span className="select-none text-right text-[11px] text-muted-foreground">
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
                            />
                          </PopoverContent>
                        </Popover>
                      );
                    })}
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
