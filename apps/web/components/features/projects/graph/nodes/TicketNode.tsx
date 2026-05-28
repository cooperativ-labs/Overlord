'use client';

import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { FileText } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { TicketNodeData } from '../types';
import { STATUS_TYPE_COLORS } from '../types';

export function TicketNode({ data, selected }: NodeProps) {
  const d = data as unknown as TicketNodeData & { dimmed?: boolean; highlighted?: boolean };
  const borderColor = STATUS_TYPE_COLORS[d.statusType ?? ''] ?? '#64748b';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ticket ${d.shortId}: ${d.title}, ${d.fileCount} file${d.fileCount !== 1 ? 's' : ''}`}
      className={cn(
        'rounded-lg border-2 bg-card px-3 py-2 shadow-sm min-w-[180px] max-w-[260px] transition-opacity duration-200',
        d.dimmed && 'opacity-25',
        d.highlighted && 'ring-2 ring-primary/50',
        selected && 'ring-2 ring-primary'
      )}
      style={{ borderColor }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: borderColor }}
        />
        <span className="text-xs font-mono text-muted-foreground">{d.shortId}</span>
      </div>
      <div className="text-sm font-medium leading-tight line-clamp-2">{d.title}</div>
      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>
          {d.fileCount} file{d.fileCount !== 1 ? 's' : ''}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
    </div>
  );
}
