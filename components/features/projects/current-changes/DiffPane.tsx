import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ParsedUnifiedDiff } from '@/lib/git/unified-diff';
import { cn } from '@/lib/utils';

import { buildHunkMatches, lineNumber } from './helpers';
import { HunkPopoverContent } from './HunkPopoverContent';
import type { ChangeRationaleRecord, FileAttribution, GitStatusFile, TicketSummary } from './types';

type DiffPaneProps = {
  diff: ParsedUnifiedDiff | null;
  diffError: string | null;
  file: GitStatusFile;
  fileAttributions: FileAttribution[];
  isLoading: boolean;
  projectId: string;
  rationales: ChangeRationaleRecord[];
  selectedFilePath: string | null;
};

export function DiffPane({
  diff,
  diffError,
  file,
  fileAttributions,
  isLoading,
  projectId,
  rationales,
  selectedFilePath
}: DiffPaneProps) {
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);

  const fileTickets = useMemo(() => {
    const candidatePaths = new Set([file.path, file.originalPath].filter(Boolean));
    const ticketMap = new Map<string, TicketSummary>();
    // From rationales (hunk-level, may not exist)
    for (const r of rationales) {
      if (candidatePaths.has(r.file_path) && r.ticket && !ticketMap.has(r.ticket.id)) {
        ticketMap.set(r.ticket.id, r.ticket);
      }
    }
    // From file attributions (deterministic, from agent delivery artifacts)
    for (const a of fileAttributions) {
      if (candidatePaths.has(a.file_path) && !ticketMap.has(a.ticket_id)) {
        ticketMap.set(a.ticket_id, { id: a.ticket_id, status: null, title: a.ticket_title });
      }
    }
    return [...ticketMap.values()];
  }, [rationales, fileAttributions, file.path, file.originalPath]);

  useEffect(() => {
    setOpenPopoverKey(null);
  }, [selectedFilePath]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (diffError) {
    return <div className="p-6 text-sm text-destructive">{diffError}</div>;
  }

  if (!diff || diff.hunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        No diff preview is available for this file yet.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="border-b px-4 py-3">
        <p className="font-medium text-foreground">
          {diff.newPath ?? diff.oldPath ?? selectedFilePath}
        </p>
        <p className="text-xs text-muted-foreground">
          Click a changed line to inspect linked rationale.
        </p>
      </div>
      <div className="space-y-4 p-4">
        {diff.hunks.map(hunk => {
          const matches = buildHunkMatches(rationales, file, hunk);

          return (
            <div key={hunk.id} className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between gap-3 bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                <span className="truncate">{hunk.header}</span>
                {matches.length > 0 ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    {matches.length} linked
                  </span>
                ) : fileTickets.length > 0 ? (
                  <span className="rounded-full border border-muted-foreground/20 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {fileTickets.length} {fileTickets.length === 1 ? 'ticket' : 'tickets'}
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
                          fileTickets={fileTickets}
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
        })}
      </div>
    </div>
  );
}
