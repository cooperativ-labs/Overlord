'use client';

import type { NodeProps } from '@xyflow/react';
import { Flame } from 'lucide-react';

import { cn } from '@/lib/utils';

interface HotspotNodeData {
  type: 'hotspot';
  filePath: string;
  fileName: string;
  directory: string;
  ticketCount: number;
  rationaleCount: number;
  impactScore: number;
  lastActivity: string;
  heatColor: string;
  sizeMultiplier: number;
}

export function HotspotNode({ data, selected }: NodeProps) {
  const d = data as unknown as HotspotNodeData;
  const fontSize = 10 + d.sizeMultiplier * 2;
  const padX = 6 + d.sizeMultiplier * 4;
  const padY = 4 + d.sizeMultiplier * 2;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Hotspot ${d.fileName}: ${d.ticketCount} ticket${d.ticketCount !== 1 ? 's' : ''}, ${d.rationaleCount} change${d.rationaleCount !== 1 ? 's' : ''}`}
      className={cn(
        'rounded-md border-2 shadow-sm transition-all',
        selected && 'ring-2 ring-primary'
      )}
      style={{
        backgroundColor: d.heatColor,
        borderColor: d.heatColor,
        padding: `${padY}px ${padX}px`,
        maxWidth: 220
      }}
    >
      <div className="flex items-center gap-1.5">
        <Flame className="h-3.5 w-3.5 text-foreground/80 flex-shrink-0" />
        <span className="font-mono truncate text-foreground" style={{ fontSize: `${fontSize}px` }}>
          {d.fileName}
        </span>
      </div>
      <div className="text-[10px] text-foreground/80 mt-0.5">
        {d.ticketCount} ticket{d.ticketCount !== 1 ? 's' : ''} · {d.rationaleCount} change
        {d.rationaleCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export type { HotspotNodeData };
