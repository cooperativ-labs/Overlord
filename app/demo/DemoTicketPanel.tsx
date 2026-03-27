'use client';

import { ArrowRightToLine, Bot, ChevronDown, MessageSquare } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { DEMO_ACTIVITY, type DemoTicket } from './mock-data';

type DemoTicketPanelProps = {
  ticket: DemoTicket;
  onClose: () => void;
  onDiscuss: () => void;
  onRun: () => void;
};

function StatusBadge({ state }: { state: DemoTicket['agent_session_state'] }) {
  if (!state) return null;

  const styles: Record<string, string> = {
    attached: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    idle: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
    completed: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
  };

  return (
    <Badge variant="outline" className={cn('gap-1 rounded-full text-[11px]', styles[state])}>
      {state === 'attached' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      {state}
    </Badge>
  );
}

function PhaseIndicator({ phase }: { phase: string }) {
  const colors: Record<string, string> = {
    execute: 'bg-amber-500',
    deliver: 'bg-emerald-500',
    review: 'bg-sky-500'
  };
  return <span className={cn('h-2 w-2 rounded-full', colors[phase] ?? 'bg-slate-400')} />;
}

export function DemoTicketPanel({ ticket, onClose, onDiscuss, onRun }: DemoTicketPanelProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [visibleActivityCount, setVisibleActivityCount] = useState(0);

  const agentIcon =
    ticket.latest_objective_agent === 'codex'
      ? '/images/icons/codex.svg'
      : '/images/icons/claude-code.svg';
  const agentLabel = ticket.latest_objective_agent === 'codex' ? 'Codex' : 'Claude Code';

  // Animate activity cards appearing one by one
  useEffect(() => {
    if (ticket.status !== 'draft' && visibleActivityCount < DEMO_ACTIVITY.length) {
      const timer = setTimeout(() => {
        setVisibleActivityCount(prev => prev + 1);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [visibleActivityCount, ticket.status]);

  // Reset animation when ticket changes
  useEffect(() => {
    setVisibleActivityCount(0);
  }, [ticket.id]);

  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-background">
      {/* Header with agent controls */}
      <div className="flex items-center justify-end gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-1.5">
          {/* Model chooser */}
          <Button
            className="h-7 gap-1.5 px-2 text-xs"
            size="sm"
            variant="outline"
            onClick={() => setModelOpen(!modelOpen)}
          >
            <Image
              src={agentIcon}
              alt={`${agentLabel} icon`}
              width={14}
              height={14}
              className="h-3.5 w-3.5"
            />
            <span className="hidden sm:inline">Sonnet 4</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>

          {/* Discuss button */}
          <Button
            className="h-7 gap-1 px-2 text-xs"
            size="sm"
            variant="outline"
            onClick={onDiscuss}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Discuss
          </Button>

          {/* Run button (split-style) */}
          <div className="inline-flex items-stretch rounded-md border border-input bg-background text-sm shadow-sm">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded-l-md px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-7"
              onClick={onRun}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>Run</span>
            </button>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center rounded-r-md border-l px-1.5 transition-colors hover:bg-accent hover:text-accent-foreground h-7"
              onClick={onRun}
            >
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>

          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <ArrowRightToLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Model selector dropdown - appears below header */}
      {modelOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 border-b bg-popover p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Choose agent & model</p>
          <div className="space-y-1">
            {[
              {
                agent: 'Claude Code',
                model: 'Claude Sonnet 4',
                icon: '/images/icons/claude-code.svg',
                selected: true
              },
              {
                agent: 'Claude Code',
                model: 'Claude Opus 4',
                icon: '/images/icons/claude-code.svg',
                selected: false
              },
              { agent: 'Codex', model: 'o3', icon: '/images/icons/codex.svg', selected: false },
              { agent: 'Cursor', model: 'Auto', icon: '/images/icons/cursor.svg', selected: false },
              {
                agent: 'Gemini CLI',
                model: 'Gemini 2.5 Pro',
                icon: '/images/icons/gemini.svg',
                selected: false
              }
            ].map(item => (
              <button
                key={`${item.agent}-${item.model}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                  item.selected && 'bg-accent'
                )}
                onClick={() => setModelOpen(false)}
              >
                <Image
                  src={item.icon}
                  alt={item.agent}
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5"
                />
                <span className="font-medium">{item.agent}</span>
                <span className="text-muted-foreground">{item.model}</span>
                {item.selected && <span className="ml-auto text-emerald-500">&#10003;</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 p-4">
          {/* Title */}
          <h2 className="text-lg font-semibold leading-snug">{ticket.title}</h2>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 rounded-full text-[11px]"
              style={{ borderColor: ticket.project_color + '60' }}
            >
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: ticket.project_color }}
              />
              {ticket.project_name}
            </Badge>
            <Badge variant="secondary" className="rounded-full text-[11px] capitalize">
              {ticket.status}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'gap-1 rounded-full text-[11px]',
                ticket.execution_target === 'agent'
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
              )}
            >
              {ticket.execution_target === 'agent' ? <Bot className="h-3 w-3" /> : null}
              {ticket.execution_target}
            </Badge>
            <StatusBadge state={ticket.agent_session_state} />
          </div>

          {/* Objective */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Objective
            </p>
            <p className="text-sm leading-relaxed text-foreground/90">{ticket.objective}</p>
          </div>

          <Separator />

          {/* Activity feed */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Activity
            </p>
            {ticket.status === 'draft' || visibleActivityCount === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {[...DEMO_ACTIVITY]
                  .reverse()
                  .slice(-visibleActivityCount)
                  .map((event, index) => {
                    // Only animate the newest (top) card
                    const isNewest = index === 0;
                    return (
                      <div
                        key={event.id}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2.5',
                          isNewest && 'animate-in fade-in slide-in-from-top-2 duration-300'
                        )}
                        style={{
                          animationDelay: '0ms',
                          animationFillMode: 'backwards'
                        }}
                      >
                        <PhaseIndicator phase={event.phase} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm leading-snug">{event.summary}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {event.timestamp}
                            </span>
                            <Badge
                              variant="outline"
                              className="h-4 rounded-full px-1.5 text-[10px]"
                            >
                              {event.phase}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
