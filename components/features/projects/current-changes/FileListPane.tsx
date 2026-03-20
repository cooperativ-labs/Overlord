import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
  onToggleTicketFilter: (ticketId: string) => void;
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
  onSelectFile,
  onToggleTicketFilter
}: FileListPaneProps) {
  return (
    <div className="flex min-h-0 flex-col border-r">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium text-foreground">Uncommitted files</p>
        <p className="text-xs text-muted-foreground">{workingDirectory}</p>
      </div>

      {tickets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {tickets.map(ticket => {
            const isActive = selectedTicketIds.has(ticket.id);
            return (
              <Button
                key={ticket.id}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className="h-7 max-w-full rounded-full px-3 text-xs"
                onClick={() => onToggleTicketFilter(ticket.id)}
              >
                <span className="truncate">
                  {ticket.title?.trim() || `Ticket ${ticket.id.slice(-8)}`}
                </span>
              </Button>
            );
          })}
          {selectedTicketIds.size > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2 text-xs"
              onClick={onClearTicketFilter}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repository changes…
          </div>
        ) : statusResponse?.error ? (
          <p className="text-sm text-destructive">{statusResponse.error}</p>
        ) : !statusResponse?.files.length ? (
          <p className="text-sm text-muted-foreground">No uncommitted changes found.</p>
        ) : filteredFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No files match the selected ticket filter.
          </p>
        ) : (
          <div className="space-y-2">
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
