'use client';

import type { Edge, Node } from '@xyflow/react';
import { File, FileText, GitBranch, Layers, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { CoChangeEdgeData, FileNodeData, RationaleEdgeData, TicketNodeData } from './types';
import type { GraphApiResponse, GraphFileChangeRecord } from './types';
import { CHANGE_KIND_COLORS, STATUS_TYPE_COLORS } from './types';

type SelectionTarget = { kind: 'node'; node: Node } | { kind: 'edge'; edge: Edge } | null;

interface GraphDetailsPanelProps {
  selection: SelectionTarget;
  apiData: GraphApiResponse | null;
  onClose: () => void;
  onExpandFile?: (filePath: string) => void;
}

function findFileChanges(
  apiData: GraphApiResponse | null,
  ticketId: string,
  filePath: string
): GraphFileChangeRecord[] {
  if (!apiData) return [];
  return apiData.fileChanges.filter(fc => fc.ticket_id === ticketId && fc.file_path === filePath);
}

function findFileChangesForFile(
  apiData: GraphApiResponse | null,
  filePath: string
): GraphFileChangeRecord[] {
  if (!apiData) return [];
  return apiData.fileChanges.filter(fc => fc.file_path === filePath);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 first:mt-0">
      {children}
    </dt>
  );
}

function SectionValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dd className={cn('text-sm mt-0.5', className)}>{children}</dd>;
}

function RationaleDetails({ fc }: { fc: GraphFileChangeRecord }) {
  return (
    <div className="border rounded-md p-2.5 space-y-1.5 bg-muted/30">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: CHANGE_KIND_COLORS[fc.change_kind] ?? '#64748b' }}
        />
        <span className="text-xs font-medium">{fc.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] h-4">
          {fc.change_kind}
        </Badge>
      </div>
      {fc.summary && <p className="text-xs text-muted-foreground">{fc.summary}</p>}
      {fc.why && (
        <div>
          <span className="text-[10px] text-muted-foreground uppercase">Why:</span>
          <p className="text-xs mt-0.5">{fc.why}</p>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>
          Impact: <strong className="text-foreground">{fc.impact}</strong>
        </span>
        <span>
          Confidence: <strong className="text-foreground">{fc.confidence}</strong>
        </span>
      </div>
      {fc.event && (
        <div className="text-[10px] text-muted-foreground">
          Event: {fc.event.event_type}
          {fc.event.summary && <span className="ml-1">— {fc.event.summary.slice(0, 100)}</span>}
        </div>
      )}
      {fc.session && (
        <div className="text-[10px] text-muted-foreground">
          Agent: {fc.session.agent_identifier}
        </div>
      )}
      {fc.objective && fc.objective.objective && (
        <div className="text-[10px] text-muted-foreground">
          Objective: {fc.objective.objective.slice(0, 100)}
        </div>
      )}
      {fc.checkpoint && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {fc.checkpoint.git_ref_name && <span>{fc.checkpoint.git_ref_name}</span>}
          {fc.checkpoint.head_sha && (
            <code className="ml-1">{fc.checkpoint.head_sha.slice(0, 7)}</code>
          )}
        </div>
      )}
    </div>
  );
}

function TicketNodeDetails({ node, apiData }: { node: Node; apiData: GraphApiResponse | null }) {
  const d = node.data as unknown as TicketNodeData;
  const borderColor = STATUS_TYPE_COLORS[d.statusType ?? ''] ?? '#64748b';
  const ticketUuid = node.id.replace('ticket-', '');

  const fileChanges = apiData?.fileChanges.filter(fc => fc.ticket_id === ticketUuid) ?? [];
  const uniqueFiles = [...new Set(fileChanges.map(fc => fc.file_path))];

  return (
    <dl>
      <SectionLabel>Ticket</SectionLabel>
      <SectionValue>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: borderColor }}
          />
          <span className="font-mono text-xs">{d.shortId}</span>
        </div>
        <p className="text-sm font-medium mt-1">{d.title}</p>
      </SectionValue>

      <SectionLabel>Status</SectionLabel>
      <SectionValue>
        <Badge variant="outline" className="text-[10px]">
          {d.status}
        </Badge>
      </SectionValue>

      <SectionLabel>Files changed ({uniqueFiles.length})</SectionLabel>
      <SectionValue>
        <ul className="space-y-0.5">
          {uniqueFiles.slice(0, 20).map(fp => (
            <li
              key={fp}
              className="text-xs font-mono text-muted-foreground truncate flex items-center gap-1"
            >
              <File className="h-3 w-3 flex-shrink-0" />
              {fp}
            </li>
          ))}
          {uniqueFiles.length > 20 && (
            <li className="text-[10px] text-muted-foreground">
              ...and {uniqueFiles.length - 20} more
            </li>
          )}
        </ul>
      </SectionValue>
    </dl>
  );
}

function FileNodeDetails({
  node,
  apiData,
  onExpandFile
}: {
  node: Node;
  apiData: GraphApiResponse | null;
  onExpandFile?: (filePath: string) => void;
}) {
  const d = node.data as unknown as FileNodeData;
  const filePath = d.filePath;
  const fileChanges = findFileChangesForFile(apiData, filePath);

  return (
    <dl>
      <SectionLabel>File</SectionLabel>
      <SectionValue>
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="font-mono text-xs break-all">{filePath}</span>
        </div>
      </SectionValue>

      <SectionLabel>Directory</SectionLabel>
      <SectionValue className="font-mono text-xs">{d.directory}</SectionValue>

      <SectionLabel>
        Touched by {d.ticketCount} ticket{d.ticketCount !== 1 ? 's' : ''}
      </SectionLabel>
      <SectionValue>
        <div className="flex flex-wrap gap-1">
          {d.changeKinds.map((k: string) => (
            <Badge key={k} variant="outline" className="text-[10px] h-4">
              {k}
            </Badge>
          ))}
        </div>
      </SectionValue>

      {onExpandFile && d.ticketCount > 1 && (
        <div className="mt-3">
          <button
            onClick={() => onExpandFile(filePath)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Layers className="h-3 w-3" />
            Add other tickets that touched this file
          </button>
        </div>
      )}

      {fileChanges.length > 0 && (
        <>
          <SectionLabel>Rationales ({fileChanges.length})</SectionLabel>
          <SectionValue>
            <div className="space-y-2">
              {fileChanges.slice(0, 10).map(fc => (
                <RationaleDetails key={fc.id} fc={fc} />
              ))}
              {fileChanges.length > 10 && (
                <p className="text-[10px] text-muted-foreground">
                  ...and {fileChanges.length - 10} more
                </p>
              )}
            </div>
          </SectionValue>
        </>
      )}
    </dl>
  );
}

function RationaleEdgeDetails({ edge, apiData }: { edge: Edge; apiData: GraphApiResponse | null }) {
  const d = edge.data as unknown as RationaleEdgeData | undefined;
  if (!d) return null;

  const ticketId = edge.source.replace('ticket-', '');
  const filePath = edge.target.replace('file-', '');
  const fileChanges = findFileChanges(apiData, ticketId, filePath);

  return (
    <dl>
      <SectionLabel>Rationale Edge</SectionLabel>
      <SectionValue>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: CHANGE_KIND_COLORS[d.changeKind] ?? '#64748b' }}
          />
          <span className="text-sm font-medium">{d.label}</span>
        </div>
      </SectionValue>

      {d.summary && (
        <>
          <SectionLabel>Summary</SectionLabel>
          <SectionValue className="text-xs">{d.summary}</SectionValue>
        </>
      )}

      {d.why && (
        <>
          <SectionLabel>Why</SectionLabel>
          <SectionValue className="text-xs">{d.why}</SectionValue>
        </>
      )}

      <SectionLabel>Attributes</SectionLabel>
      <SectionValue>
        <div className="flex items-center gap-3 text-xs">
          <span>
            Kind:{' '}
            <Badge variant="outline" className="text-[10px] h-4 ml-0.5">
              {d.changeKind}
            </Badge>
          </span>
          <span>
            Impact: <strong>{d.impact}</strong>
          </span>
          <span>
            Confidence: <strong>{d.confidence}</strong>
          </span>
        </div>
      </SectionValue>

      {fileChanges.length > 0 && (
        <>
          <SectionLabel>Full rationale records</SectionLabel>
          <SectionValue>
            <div className="space-y-2">
              {fileChanges.map(fc => (
                <RationaleDetails key={fc.id} fc={fc} />
              ))}
            </div>
          </SectionValue>
        </>
      )}
    </dl>
  );
}

function CoChangeEdgeDetails({ edge }: { edge: Edge }) {
  const d = edge.data as unknown as CoChangeEdgeData | undefined;
  if (!d) return null;

  return (
    <dl>
      <SectionLabel>Co-Change Relationship</SectionLabel>
      <SectionValue>
        <p className="text-sm">
          These two tickets touched <strong>{d.sharedFileCount}</strong> shared file
          {d.sharedFileCount !== 1 ? 's' : ''}.
        </p>
      </SectionValue>

      <SectionLabel>Shared files</SectionLabel>
      <SectionValue>
        <ul className="space-y-0.5">
          {d.sharedFiles.slice(0, 20).map(fp => (
            <li
              key={fp}
              className="text-xs font-mono text-muted-foreground truncate flex items-center gap-1"
            >
              <File className="h-3 w-3 flex-shrink-0" />
              {fp}
            </li>
          ))}
          {d.sharedFiles.length > 20 && (
            <li className="text-[10px] text-muted-foreground">
              ...and {d.sharedFiles.length - 20} more
            </li>
          )}
        </ul>
      </SectionValue>
    </dl>
  );
}

export function GraphDetailsPanel({
  selection,
  apiData,
  onClose,
  onExpandFile
}: GraphDetailsPanelProps) {
  if (!selection) return null;

  return (
    <div className="w-[320px] border-l bg-card flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Details
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label="Close details panel"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <ScrollArea className="flex-1 p-3">
        {selection.kind === 'node' && selection.node.type === 'ticket' && (
          <TicketNodeDetails node={selection.node} apiData={apiData} />
        )}
        {selection.kind === 'node' && selection.node.type === 'file' && (
          <FileNodeDetails node={selection.node} apiData={apiData} onExpandFile={onExpandFile} />
        )}
        {selection.kind === 'edge' && selection.edge.type === 'rationale' && (
          <RationaleEdgeDetails edge={selection.edge} apiData={apiData} />
        )}
        {selection.kind === 'edge' && selection.edge.type === 'cochange' && (
          <CoChangeEdgeDetails edge={selection.edge} />
        )}
      </ScrollArea>
    </div>
  );
}

export type { SelectionTarget };
