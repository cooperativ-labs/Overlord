'use client';

import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';

interface GraphTimeScrubberProps {
  bounds: { min: string; max: string } | null;
  value: string | null;
  onChange: (value: string | null) => void;
  isPlaying: boolean;
  onPlayToggle: () => void;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function GraphTimeScrubber({
  bounds,
  value,
  onChange,
  isPlaying,
  onPlayToggle
}: GraphTimeScrubberProps) {
  const minMs = bounds ? new Date(bounds.min).getTime() : 0;
  const maxMs = bounds ? new Date(bounds.max).getTime() : 1;
  const currentMs = value ? new Date(value).getTime() : maxMs;
  const span = Math.max(maxMs - minMs, 1);

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying || !bounds) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      onChange(new Date(maxMs).toISOString());
      onPlayToggle();
      return;
    }

    const playDurationMs = 6000;
    const startReal = performance.now();
    const startVirtual = currentMs >= maxMs ? minMs : currentMs;

    const step = (now: number) => {
      const elapsed = now - startReal;
      const progress = Math.min(elapsed / playDurationMs, 1);
      const newVirtual = startVirtual + progress * (maxMs - startVirtual);
      onChange(new Date(newVirtual).toISOString());
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        onPlayToggle();
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying, bounds?.min, bounds?.max, currentMs, maxMs, onChange, onPlayToggle]);

  if (!bounds) {
    return (
      <div className="px-3 py-2 border-b text-xs text-muted-foreground">
        No timestamped data to replay yet.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b bg-card/30">
      <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={onPlayToggle}>
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onChange(bounds.min)}
        title="Rewind"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatStamp(bounds.min)}
        </span>
        <input
          type="range"
          value={currentMs}
          min={minMs}
          max={maxMs}
          step={Math.max(span / 500, 1)}
          onChange={e => onChange(new Date(parseInt(e.target.value, 10)).toISOString())}
          className="flex-1 h-1 accent-primary cursor-pointer"
          aria-label="Time scrubber"
        />
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatStamp(bounds.max)}
        </span>
      </div>
      <div className="text-xs font-mono w-36 text-right">
        {value ? formatStamp(value) : formatStamp(bounds.max)}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange(null)}
        title="Clear scrubber"
      >
        Reset
      </Button>
    </div>
  );
}
