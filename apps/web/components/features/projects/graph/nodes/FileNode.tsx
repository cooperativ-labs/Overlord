'use client';

import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { File } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { FileNodeData } from '../types';
import { CHANGE_KIND_COLORS } from '../types';

export function FileNode({ data, selected }: NodeProps) {
  const d = data as unknown as FileNodeData & { dimmed?: boolean; highlighted?: boolean };
  const primaryKind = d.changeKinds[0] ?? 'modify';
  const dotColor = CHANGE_KIND_COLORS[primaryKind] ?? '#64748b';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`File ${d.fileName} in ${d.directory}, ${d.ticketCount} ticket${d.ticketCount !== 1 ? 's' : ''}, ${d.changeKinds.join(', ')}`}
      className={cn(
        'rounded-md border bg-card/80 px-2.5 py-1.5 shadow-sm max-w-[220px] transition-opacity duration-200',
        d.dimmed && 'opacity-25',
        d.highlighted && 'ring-2 ring-primary/50',
        selected && 'ring-2 ring-primary'
      )}
    >
      <div className="flex items-center gap-1.5">
        <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-mono truncate">{d.fileName}</span>
        <span
          className="inline-block h-2 w-2 rounded-full flex-shrink-0 ml-auto"
          style={{ backgroundColor: dotColor }}
        />
      </div>
      {d.directory !== '(root)' && (
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{d.directory}/</div>
      )}
      {d.ticketCount > 1 && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{d.ticketCount} tickets</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
    </div>
  );
}
