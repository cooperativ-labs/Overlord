'use client';

import { Calendar, CalendarClock, Plus, Tag } from 'lucide-react';

import { DemoObjectivesSection } from './DemoObjectivesSection';
import { DemoPanelHeader } from './DemoPanelHeader';
import { DemoTicketExtrasAccordion } from './DemoTicketExtrasAccordion';
import { DEMO_TICKET_DETAILS } from './mock-ticket-details';

export function DemoTicketDetails() {
  return (
    <div className="overflow-hidden rounded-xl bg-card text-foreground shadow-inner">
      <DemoPanelHeader />
      <div className="bg-card px-5 py-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold leading-tight">{DEMO_TICKET_DETAILS.title}</h2>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Chip>
            <Calendar className="h-3 w-3" />
            {DEMO_TICKET_DETAILS.due_label}
          </Chip>
          <Chip>
            <CalendarClock className="h-3 w-3" />
            {DEMO_TICKET_DETAILS.schedule_label}
          </Chip>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {DEMO_TICKET_DETAILS.tags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
              style={{ borderColor: `${tag.color}55` }}
            >
              <Tag className="h-2.5 w-2.5" style={{ color: tag.color }} />
              {tag.label}
            </span>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-background"
          >
            <Plus className="h-2.5 w-2.5" />
            Add tag
          </button>
        </div>

        <DemoObjectivesSection />
      </div>

      <DemoTicketExtrasAccordion />
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}
