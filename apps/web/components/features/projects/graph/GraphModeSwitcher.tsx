'use client';

import { Clock, Columns, Flame, Network } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { GraphMode } from './types';

interface GraphModeSwitcherProps {
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  /** Disable diff mode when not exactly two tickets are pinned. */
  canDiff: boolean;
  /** Disable compare/replay/diff when there are zero pinned tickets. */
  hasTickets: boolean;
}

const MODES: { value: GraphMode; label: string; icon: React.ReactNode; disabledHint?: string }[] = [
  { value: 'compare', label: 'Compare', icon: <Network className="h-3.5 w-3.5" /> },
  { value: 'hotspot', label: 'Hotspots', icon: <Flame className="h-3.5 w-3.5" /> },
  { value: 'replay', label: 'Replay', icon: <Clock className="h-3.5 w-3.5" /> },
  { value: 'diff', label: 'Diff lanes', icon: <Columns className="h-3.5 w-3.5" /> }
];

export function GraphModeSwitcher({
  mode,
  onModeChange,
  canDiff,
  hasTickets
}: GraphModeSwitcherProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card/40 p-0.5">
      {MODES.map(m => {
        const disabled = (m.value === 'diff' && !canDiff) || (m.value !== 'hotspot' && !hasTickets);
        const active = mode === m.value;
        return (
          <Button
            key={m.value}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onModeChange(m.value)}
            className={cn(
              'h-7 px-2 gap-1 text-xs',
              active && 'bg-primary/10 text-primary hover:bg-primary/15'
            )}
            title={
              disabled
                ? m.value === 'diff'
                  ? 'Pin exactly two tickets to compare'
                  : 'Add at least one ticket'
                : m.label
            }
          >
            {m.icon}
            <span>{m.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
