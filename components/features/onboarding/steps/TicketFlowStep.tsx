'use client';

import { ArrowRight, Play, Plus, Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Props = {
  onContinue: () => void;
};

type FlowNode = {
  icon: React.ReactNode;
  label: string;
  description: string;
  badge?: string;
  screenshotSrc?: string;
};

const FLOW_NODES: FlowNode[] = [
  {
    icon: <Plus className="h-5 w-5" />,
    label: 'New Ticket',
    description: 'Click the + button at the top of any project column'
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden>
        <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <line
          x1="5"
          y1="9"
          x2="15"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="5"
          y1="12"
          x2="11"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    label: 'Type your objective',
    description:
      'Describe what you want the agent to do — be as specific or brief as you like. You can even @mention files.'
  },
  {
    icon: <Play className="h-5 w-5" />,
    label: 'Launch the agent',
    description:
      'Pick your agent (Claude, Codex, Cursor, OpenCode…) and launch it from the ticket:',
    screenshotSrc: '/images/onboarding/launch-screenshot.png'
  },
  {
    icon: <Terminal className="h-5 w-5" />,
    label: 'Terminal opens',
    description:
      'A terminal launches in your project directory and the agent gets to work automatically',
    badge: 'Desktop app only'
  }
];

export function TicketFlowStep({ onContinue }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">How tickets work</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Each ticket is a unit of work for an AI agent. Here's the full loop from creation to a
          running agent.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="flex flex-col gap-0">
        {FLOW_NODES.map((node, index) => (
          <div key={node.label}>
            <div className="flex items-start gap-4">
              {/* Step number + icon column */}
              <div className="flex flex-col items-center gap-1">
                <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  {node.icon}
                </div>
                {index < FLOW_NODES.length - 1 && (
                  <div className="bg-border w-px flex-1" style={{ minHeight: 20 }} />
                )}
              </div>
              {/* Content */}
              <div className="pb-5 pt-1.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{node.label}</p>
                  {node.badge && (
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs font-medium">
                      {node.badge}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">{node.description}</p>
                {node.screenshotSrc && (
                  <img
                    src={node.screenshotSrc}
                    alt="Screenshot of the agent launcher"
                    className="mt-3 rounded-lg h-8  shadow-sm"
                    onError={e => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">What happens next?</p>
        <p className="text-muted-foreground mt-0.5 text-sm">
          The agent reads your ticket, runs code in the terminal, and posts progress updates back to
          Overlord. You can watch live, pause, or let it run in the background.
        </p>
      </div>

      <Button onClick={onContinue} className="self-start">
        Got it — I'm ready to build
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
