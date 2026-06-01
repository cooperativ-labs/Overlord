import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ParsedDiffHunk } from '@/lib/git/unified-diff';
import { cn } from '@/lib/utils';

import { lineNumber } from './helpers';
import { HunkPopoverContent } from './HunkPopoverContent';
import type { FileChangeRecord, TicketSummary } from './types';

type DiffHunkProps = {
  hunk: ParsedDiffHunk;
  matches: FileChangeRecord[];
  showSideBySide: boolean;
  openPopoverKey: string | null;
  setOpenPopoverKey: (key: string | null) => void;
  fileTickets: TicketSummary[];
  projectId: string;
  onFilterByTicket: (ticketId: string) => void;
};

export function DiffHunk({
  hunk,
  matches,
  showSideBySide,
  openPopoverKey,
  setOpenPopoverKey,
  fileTickets,
  projectId,
  onFilterByTicket
}: DiffHunkProps) {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
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
                        fileTickets={fileTickets}
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
                    fileTickets={fileTickets}
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
}
