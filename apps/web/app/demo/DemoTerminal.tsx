'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import type { TerminalLine } from './mock-data';

type DemoTerminalProps = {
  lines: TerminalLine[];
  isRunning: boolean;
  onComplete?: () => void;
};

export function DemoTerminal({ lines, isRunning, onComplete }: DemoTerminalProps) {
  const [visibleLines, setVisibleLines] = useState<TerminalLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    setVisibleLines([]);
    clearTimers();

    let maxDelay = 0;
    for (const line of lines) {
      const timer = setTimeout(() => {
        setVisibleLines(prev => [...prev, line]);
      }, line.delay);
      timersRef.current.push(timer);
      if (line.delay > maxDelay) maxDelay = line.delay;
    }

    if (onComplete) {
      const completeTimer = setTimeout(onComplete, maxDelay + 500);
      timersRef.current.push(completeTimer);
    }

    return clearTimers;
  }, [isRunning, lines, onComplete, clearTimers]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLines]);

  function getLineColor(type: TerminalLine['type']) {
    switch (type) {
      case 'command':
        return 'text-sky-400';
      case 'agent':
        return 'text-slate-300';
      case 'info':
        return 'text-amber-400';
      case 'success':
        return 'text-emerald-400';
      case 'system':
      default:
        return 'text-slate-500';
    }
  }

  return (
    <div
      ref={scrollRef}
      className="h-[240px] overflow-y-auto p-4 font-mono text-sm leading-relaxed"
    >
      {visibleLines.length === 0 && !isRunning && (
        <p className="text-slate-600">
          Click <span className="text-slate-400">Discuss</span> or{' '}
          <span className="text-slate-400">Run</span> to see agent output here.
        </p>
      )}
      {visibleLines.map((line, i) => (
        <div
          key={i}
          className={cn('animate-in fade-in slide-in-from-bottom-1', getLineColor(line.type))}
        >
          {line.text === '' ? <br /> : line.text}
        </div>
      ))}
      {isRunning && visibleLines.length < lines.length && (
        <span className="inline-block h-4 w-1.5 animate-pulse bg-slate-400" />
      )}
    </div>
  );
}
