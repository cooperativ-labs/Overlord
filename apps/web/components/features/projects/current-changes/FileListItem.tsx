import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import { getStatusClasses, getStatusInitial, getStatusTooltipLabel } from './helpers';
import type { EnrichedCurrentChangeFile } from './types';

type FileListItemProps = {
  file: EnrichedCurrentChangeFile;
  isSelected: boolean;
  onSelect: () => void;
};

export function FileListItem({ file, isSelected, onSelect }: FileListItemProps) {
  const lastSlash = file.path.lastIndexOf('/');
  const directory = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : '';
  const fileName = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
  const linesAdded = file.file.linesAdded;
  const linesRemoved = file.file.linesRemoved;
  const hasStats = linesAdded !== null || linesRemoved !== null;
  const ticketCount = file.tickets.length;
  const primaryTicketTitle =
    file.primaryTicket?.title?.trim() ||
    (file.primaryTicket ? `Ticket ${getTicketIdentifier(file.primaryTicket)}` : null);

  const tooltipBody = (
    <div className="space-y-1">
      <p className="font-medium">{file.path}</p>
      <p className="text-xs text-muted-foreground">{getStatusTooltipLabel(file.file.status)}</p>
      {primaryTicketTitle ? (
        <p className="text-xs">
          <span className="text-muted-foreground">Ticket:</span> {primaryTicketTitle}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{file.summary}</p>
    </div>
  );

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            isSelected ? 'bg-primary/10 text-foreground' : 'text-foreground/90 hover:bg-muted/60'
          )}
        >
          <span
            aria-label={getStatusTooltipLabel(file.file.status)}
            className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-semibold uppercase leading-none',
              getStatusClasses(file.file.status)
            )}
          >
            {getStatusInitial(file.file.status)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {directory ? <span className="text-muted-foreground/80">{directory}</span> : null}
            <span className="font-medium">{fileName}</span>
          </span>
          {ticketCount > 0 ? (
            <span
              className={cn(
                'shrink-0 text-[10px]',
                ticketCount > 1 ? 'text-muted-foreground' : 'text-primary/80'
              )}
              aria-label={`${ticketCount} linked ticket${ticketCount === 1 ? '' : 's'}`}
            >
              {ticketCount > 1 ? `${ticketCount}◆` : '◆'}
            </span>
          ) : null}
          {hasStats ? (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
              {linesAdded !== null && linesAdded !== undefined ? (
                <span className="text-emerald-600 dark:text-emerald-400">+{linesAdded}</span>
              ) : null}
              {linesRemoved !== null && linesRemoved !== undefined ? (
                <span className="text-rose-600 dark:text-rose-400">−{linesRemoved}</span>
              ) : null}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-xs">
        {tooltipBody}
      </TooltipContent>
    </Tooltip>
  );
}
