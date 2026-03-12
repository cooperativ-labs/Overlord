import { Loader2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { FileListItem } from './FileListItem';
import { countFileRationales } from './helpers';
import { TicketFilterPopover } from './TicketFilterPopover';
import type {
  ChangeRationaleRecord,
  GitStatusFile,
  GitStatusResponse,
  TicketSummary
} from './types';

type FileListPaneProps = {
  filteredFiles: GitStatusFile[];
  rationales: ChangeRationaleRecord[];
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
  rationales,
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
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Uncommitted files</p>
          <TicketFilterPopover
            selectedTicketIds={selectedTicketIds}
            tickets={tickets}
            onClear={onClearTicketFilter}
            onToggle={onToggleTicketFilter}
          />
        </div>
        <p className="text-xs text-muted-foreground">{workingDirectory}</p>
      </div>

      {selectedTicketIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
          {[...selectedTicketIds].map(id => {
            const ticket = tickets.find(candidate => candidate.id === id);
            return (
              <Badge key={id} variant="secondary" className="gap-1 text-[10px]">
                <span className="max-w-[140px] truncate">
                  {ticket?.title?.trim() || `Ticket ${id.slice(-8)}`}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleTicketFilter(id)}
                  className="ml-0.5 hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
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
                key={`${file.status}:${file.path}`}
                file={file}
                isSelected={selectedPath === file.path}
                onSelect={() => onSelectFile(file.path)}
                rationaleCount={countFileRationales(file, rationales)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
