import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { FileListItem } from './FileListItem';
import type { EnrichedCurrentChangeFile, GitStatusResponse, TicketSummary } from './types';

type FileListPaneProps = {
  filteredFiles: EnrichedCurrentChangeFile[];
  selectedPath: string | null;
  selectedTicketIds: Set<string>;
  statusLoading: boolean;
  statusResponse: GitStatusResponse | null;
  tickets: TicketSummary[];
  workingDirectory: string;
  onClearTicketFilter: () => void;
  onSelectFile: (path: string) => void;
};

export function FileListPane({
  filteredFiles,
  selectedPath,
  selectedTicketIds,
  statusLoading,
  statusResponse,
  tickets,
  workingDirectory,
  onClearTicketFilter,
  onSelectFile
}: FileListPaneProps) {
  const totalFiles = statusResponse?.files.length ?? 0;
  const filterActive = selectedTicketIds.size > 0;
  const activeFilterTickets = tickets.filter(ticket => selectedTicketIds.has(ticket.id));

  return (
    <div className="flex min-h-0 flex-col border-r">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {totalFiles} {totalFiles === 1 ? 'file' : 'files'} changed
            {filterActive ? (
              <span className="text-muted-foreground"> · {filteredFiles.length} shown</span>
            ) : null}
          </p>
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <p className="truncate text-[10px] text-muted-foreground">{workingDirectory}</p>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {workingDirectory}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {filterActive ? (
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
          {activeFilterTickets.map(ticket => (
            <span
              key={ticket.id}
              className="inline-flex max-w-[180px] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
            >
              <span className="truncate">
                {ticket.title?.trim() || `Ticket ${ticket.id.slice(-8)}`}
              </span>
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-5 rounded-full px-2 text-[10px] text-muted-foreground"
            onClick={onClearTicketFilter}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {statusLoading ? (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading changes…
          </div>
        ) : statusResponse?.error ? (
          <p className="p-3 text-xs text-destructive">{statusResponse.error}</p>
        ) : !statusResponse?.files.length ? (
          <p className="p-3 text-xs text-muted-foreground">No uncommitted changes.</p>
        ) : filteredFiles.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No files match the selected ticket filter.
          </p>
        ) : (
          <div className="space-y-0.5">
            {filteredFiles.map(file => (
              <FileListItem
                key={`${file.file.status}:${file.path}`}
                file={file}
                isSelected={selectedPath === file.path}
                onSelect={() => onSelectFile(file.path)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
