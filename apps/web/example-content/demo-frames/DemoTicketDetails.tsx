'use client';

import {
  ArrowRightToLine,
  Bot,
  Calendar,
  CalendarClock,
  ChevronDown,
  EllipsisVertical,
  Plus,
  Tag
} from 'lucide-react';
import { useLayoutEffect } from 'react';

import { seedAgentModelsCache } from '@/components/features/AgentModelSelector';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MARKETING_OFFERED_AGENT_MODELS } from '@/lib/marketing/offered-agent-models';

import { DemoObjectivesSection } from './DemoObjectivesSection';
import { DEMO_TICKET_DETAILS } from './mock-ticket-details';

export function DemoTicketDetails() {
  useLayoutEffect(() => {
    seedAgentModelsCache(MARKETING_OFFERED_AGENT_MODELS);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl bg-card text-foreground shadow-inner">
      <PanelHeader />
      <div className="bg-card py-5">
        <div className="px-5">
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
        </div>

        <DemoObjectivesSection className="px-5" />
      </div>

      <div className="border-t px-5 pb-2">
        <Accordion type="multiple" defaultValue={[]}>
          <AccordionItem value="acceptance-criteria" className="border-b-0">
            <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
              Acceptance Criteria
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-2 pb-2 text-sm leading-relaxed text-muted-foreground">
                {DEMO_TICKET_DETAILS.acceptance_criteria}
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="tools" className="border-b-0">
            <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
              Tools
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-2 pb-2 text-sm leading-relaxed text-muted-foreground">
                {DEMO_TICKET_DETAILS.available_tools}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="relative flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Button
          aria-label="Ticket actions"
          className="h-7 w-7"
          size="icon"
          variant="ghost"
          type="button"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </Button>
        <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" />
          Agent
        </span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: DEMO_TICKET_DETAILS.project_color }}
            />
            <span className="font-medium">{DEMO_TICKET_DETAILS.project_name}</span>
            <span className="font-mono text-muted-foreground">
              {DEMO_TICKET_DETAILS.ticket_identifier}
            </span>
          </span>
          <div className="h-3.5 w-px bg-border" />
          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
            {DEMO_TICKET_DETAILS.status}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Badge>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          type="button"
          aria-label="Close panel"
        >
          <ArrowRightToLine className="h-3.5 w-3.5" />
        </Button>
      </div>
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
