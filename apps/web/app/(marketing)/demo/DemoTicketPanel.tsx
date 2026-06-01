'use client';

import { ArrowRightToLine, Bot, ChevronDown, Copy, EllipsisVertical, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ProjectColorDot } from '@/components/features/projects/ProjectColorDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { DemoObjectivesSection } from '../../../example-content/demo-frames/DemoObjectivesSection';

import { DEMO_ACTIVITY, type DemoTicket } from './mock-data';

type DemoTicketPanelProps = {
  ticket: DemoTicket;
  onClose: () => void;
  onRun: () => void;
};

function toTicketIdentifier(ticketId: string) {
  return ticketId.replace('demo-', '1:');
}

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

function DemoTicketPanelHeader({ ticket, onClose }: { ticket: DemoTicket; onClose: () => void }) {
  const ticketIdentifier = toTicketIdentifier(ticket.id);

  return (
    <div className="relative flex items-center justify-between gap-2 overflow-hidden border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Ticket actions" className="h-7 w-7" size="icon" variant="ghost">
              <EllipsisVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span>
                Ticket ID: <strong>{ticketIdentifier}</strong>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Copy full ticket identifier"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <span>Delete ticket</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Delete ticket"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs tabular-nums text-muted-foreground">{ticketIdentifier}</span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
          >
            <ProjectColorDot color={ticket.project_color} className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-medium">{ticket.project_name}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-input bg-background px-2.5 text-[11px] capitalize shadow-sm"
          >
            {ticket.status}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <ArrowRightToLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function DemoTicketPanel({ ticket, onClose, onRun }: DemoTicketPanelProps) {
  const [visibleActivityCount, setVisibleActivityCount] = useState(0);

  useEffect(() => {
    if (ticket.status !== 'draft' && visibleActivityCount < DEMO_ACTIVITY.length) {
      const timer = setTimeout(() => {
        setVisibleActivityCount(prev => prev + 1);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [visibleActivityCount, ticket.status]);

  useEffect(() => {
    setVisibleActivityCount(0);
  }, [ticket.id]);

  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-card">
      <DemoTicketPanelHeader ticket={ticket} onClose={onClose} />

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 p-4">
          <h2 className="text-lg font-semibold leading-snug">{ticket.title}</h2>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 rounded-full text-[11px]"
              style={{ borderColor: ticket.project_color + '60' }}
            >
              <ProjectColorDot color={ticket.project_color} />
              {ticket.project_name}
            </Badge>
            <Badge variant="secondary" className="rounded-full text-[11px] capitalize">
              {ticket.status}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'gap-1 rounded-full text-[11px]',
                ticket.for_human === false
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
              )}
            >
              {ticket.for_human === false ? <Bot className="h-3 w-3" /> : null}
              {ticket.for_human ? 'Human' : 'Agent'}
            </Badge>
            <StatusBadge state={ticket.agent_session_state} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Objectives
            </p>
            <DemoObjectivesSection onRun={onRun} />
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
