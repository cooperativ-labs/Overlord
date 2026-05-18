'use client';

import Image from 'next/image';

import { LiveActivityFeed } from '@/components/features/TicketPanelLive/LiveActivityFeed';
import { LiveFileChanges } from '@/components/features/TicketPanelLive/LiveFileChanges';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { DEMO_FILE_CHANGES, DEMO_TICKET_EVENTS, DEMO_TICKET_INFO } from './mock-activity-data';

export function DemoTicketActivity() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Ticket activity</h3>
          <p className="mt-1 text-sm text-slate-400">
            The activity feed shows the events that happened on the ticket: one checkpoint, an agent
            update, a user follow-up, the delivery, and the file changes with rationales the
            reviewer reads next.
          </p>
        </div>
      </div>

      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-background p-5 text-foreground sm:p-6',
          // Top shadow + fade: reads like the lower slice of a ticket panel (content continues above).
          'shadow-[inset_0_2px_4px_rgb(0_0_0/0.06),inset_0_18px_28px_-18px_rgb(0_0_0/0.09)]',
          'dark:shadow-[inset_0_2px_4px_rgb(0_0_0/0.35),inset_0_18px_28px_-18px_rgb(0_0_0/0.38)]',
          'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-12 before:bg-linear-to-b before:from-black/6 before:to-transparent',
          'dark:before:from-black/35'
        )}
      >
        <header className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
          <h4 className="flex-1 text-sm font-semibold">Ticket: {DEMO_TICKET_INFO.title}</h4>
          <Badge variant="secondary" className="rounded-full text-xs">
            review
          </Badge>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Image src="/images/icons/claude-code.svg" alt="Claude Code" width={12} height={12} />
            {DEMO_TICKET_INFO.agent}
          </span>
        </header>

        <section className="mb-6">
          <h5 className="eyebrow mb-3">Activity</h5>
          <LiveActivityFeed events={DEMO_TICKET_EVENTS} />
        </section>

        <LiveFileChanges
          fileChanges={DEMO_FILE_CHANGES}
          editorScheme="vscode"
          projectId={null}
          ticketId={DEMO_TICKET_EVENTS[0].ticket_id}
          workspaceRoot=""
        />
      </div>
    </div>
  );
}
