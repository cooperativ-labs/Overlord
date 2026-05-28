'use client';

import { ChevronDown, ChevronRight, File, FileText, Layers } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

import type { GraphApiResponse, GraphFileChangeRecord } from './types';
import { CHANGE_KIND_COLORS, STATUS_TYPE_COLORS } from './types';
import type { GraphViewModel } from './view-model';

interface GraphMobileListProps {
  viewModel: GraphViewModel;
  apiData: GraphApiResponse | null;
  onExpandFile?: (filePath: string) => void;
}

function RationaleCard({ fc }: { fc: GraphFileChangeRecord }) {
  return (
    <div className="rounded-md border p-2 bg-muted/30 space-y-1">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: CHANGE_KIND_COLORS[fc.change_kind] ?? '#64748b' }}
        />
        <span className="text-xs font-medium truncate">{fc.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] h-4 flex-shrink-0">
          {fc.change_kind}
        </Badge>
      </div>
      {fc.why && <p className="text-xs text-muted-foreground line-clamp-2">{fc.why}</p>}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>
          Impact: <strong className="text-foreground">{fc.impact}</strong>
        </span>
        {fc.session && (
          <span>Agent: {(fc.session as { agent_identifier: string }).agent_identifier}</span>
        )}
      </div>
    </div>
  );
}

function TicketSection({
  ticketId,
  viewModel,
  apiData,
  onExpandFile
}: {
  ticketId: string;
  viewModel: GraphViewModel;
  apiData: GraphApiResponse | null;
  onExpandFile?: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const ticketNode = viewModel.ticketNodes.get(ticketId);
  if (!ticketNode) return null;
  const d = ticketNode.data as {
    shortId: string;
    title: string;
    statusType: string | null;
    fileCount: number;
  };
  const borderColor = STATUS_TYPE_COLORS[d.statusType ?? ''] ?? '#64748b';

  const files: { filePath: string; changes: GraphFileChangeRecord[] }[] = [];
  if (apiData) {
    const grouped = new Map<string, GraphFileChangeRecord[]>();
    for (const fc of apiData.fileChanges) {
      if (fc.ticket_id !== ticketId) continue;
      if (!grouped.has(fc.file_path)) grouped.set(fc.file_path, []);
      grouped.get(fc.file_path)!.push(fc);
    }
    for (const [fp, changes] of grouped) {
      files.push({ filePath: fp, changes });
    }
    files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        )}
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: borderColor }}
        />
        <span className="font-mono text-xs text-muted-foreground">{d.shortId}</span>
        <span className="text-sm font-medium truncate flex-1">{d.title}</span>
        <Badge variant="secondary" className="text-[10px] h-4 flex-shrink-0">
          {d.fileCount} file{d.fileCount !== 1 ? 's' : ''}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-3">
          {files.map(({ filePath, changes }) => {
            const ticketCount = viewModel.fileToTickets.get(filePath)?.size ?? 1;
            return (
              <div key={filePath} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="text-xs font-mono truncate flex-1">{filePath}</span>
                  {ticketCount > 1 && (
                    <Badge variant="outline" className="text-[10px] h-4 flex-shrink-0">
                      {ticketCount} tickets
                    </Badge>
                  )}
                </div>
                {onExpandFile && ticketCount > 1 && (
                  <button
                    onClick={() => onExpandFile(filePath)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-5"
                  >
                    <Layers className="h-3 w-3" />
                    Add related tickets
                  </button>
                )}
                <div className="space-y-1.5 ml-5">
                  {changes.slice(0, 5).map(fc => (
                    <RationaleCard key={fc.id} fc={fc} />
                  ))}
                  {changes.length > 5 && (
                    <p className="text-[10px] text-muted-foreground">
                      ...and {changes.length - 5} more rationale
                      {changes.length - 5 !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {files.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              No file change rationales recorded.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CoChangeSummary({ viewModel }: { viewModel: GraphViewModel }) {
  if (viewModel.coChangeEdges.length === 0) return null;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" />
        Co-change relationships
      </h3>
      {viewModel.coChangeEdges.map(edge => {
        const d = edge.data as { sharedFiles?: string[]; sharedFileCount?: number } | undefined;
        if (!d) return null;
        const sourceId = edge.source.replace('ticket-', '');
        const targetId = edge.target.replace('ticket-', '');
        const sourceNode = viewModel.ticketNodes.get(sourceId);
        const targetNode = viewModel.ticketNodes.get(targetId);
        const sourceLabel =
          (sourceNode?.data as { shortId?: string })?.shortId ?? sourceId.slice(0, 8);
        const targetLabel =
          (targetNode?.data as { shortId?: string })?.shortId ?? targetId.slice(0, 8);

        return (
          <div key={edge.id} className="text-xs space-y-1">
            <p>
              <span className="font-mono">{sourceLabel}</span>
              {' ↔ '}
              <span className="font-mono">{targetLabel}</span>
              {' — '}
              <strong>{d.sharedFileCount}</strong> shared file{d.sharedFileCount !== 1 ? 's' : ''}
            </p>
            {d.sharedFiles && d.sharedFiles.length > 0 && (
              <ul className="ml-4 space-y-0.5">
                {d.sharedFiles.slice(0, 10).map(fp => (
                  <li key={fp} className="text-[10px] font-mono text-muted-foreground truncate">
                    {fp}
                  </li>
                ))}
                {d.sharedFiles.length > 10 && (
                  <li className="text-[10px] text-muted-foreground">
                    ...and {d.sharedFiles.length - 10} more
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GraphMobileList({ viewModel, apiData, onExpandFile }: GraphMobileListProps) {
  const ticketIds = [...viewModel.ticketNodes.keys()];

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {viewModel.ticketNodes.size} ticket{viewModel.ticketNodes.size !== 1 ? 's' : ''}
          </span>
          <span className="text-border">·</span>
          <span>
            {viewModel.fileNodes.size} file{viewModel.fileNodes.size !== 1 ? 's' : ''}
          </span>
          <span className="text-border">·</span>
          <span>
            {viewModel.edges.length} edge{viewModel.edges.length !== 1 ? 's' : ''}
          </span>
        </div>

        {ticketIds.map(id => (
          <TicketSection
            key={id}
            ticketId={id}
            viewModel={viewModel}
            apiData={apiData}
            onExpandFile={onExpandFile}
          />
        ))}

        <CoChangeSummary viewModel={viewModel} />
      </div>
    </ScrollArea>
  );
}
