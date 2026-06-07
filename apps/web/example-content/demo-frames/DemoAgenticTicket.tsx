'use client';

import Image from 'next/image';
import { useLayoutEffect } from 'react';

import { seedAgentModelsCache } from '@/components/features/AgentModelSelector';
import { LiveActivityFeed } from '@/components/features/TicketPanelLive/LiveActivityFeed';
import { LiveFileChanges } from '@/components/features/TicketPanelLive/LiveFileChanges';
import { Badge } from '@/components/ui/badge';
import { MARKETING_OFFERED_AGENT_MODELS } from '@/lib/marketing/offered-agent-models';
import { cn } from '@/lib/utils';

import { DemoObjectivesSection } from './DemoObjectivesSection';
import {
  DEMO_TICKET_DETAILS,
  DEMO_TICKET_LIFECYCLE_EVENTS,
  DEMO_TICKET_LIFECYCLE_FILE_CHANGES,
  DEMO_TICKET_LIFECYCLE_INFO
} from './mock-ticket-lifecycle-data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export function DemoAgenticTicket() {
  useLayoutEffect(() => {
    seedAgentModelsCache(MARKETING_OFFERED_AGENT_MODELS);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl bg-card text-foreground ">
      <div className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold leading-tight">
            {DEMO_TICKET_DETAILS.title}
          </h2>

        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {DEMO_TICKET_DETAILS.project_name} · {DEMO_TICKET_DETAILS.ticket_identifier}
        </p>
      </div>

      <div className="px-5 py-5">
        <DemoObjectivesSection />
      </div>
      <div className="border-t px-5 py-2">
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

      <div
        className={cn(
          'relative overflow-hidden border-t bg-card px-5 py-5 text-foreground sm:px-6 sm:py-6',

          'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-12 before:bg-linear-to-b before:from-black/6 before:to-transparent',

        )}
      >
        <section className="mb-6">
          <h3 className="eyebrow mb-3">Activity</h3>
          <LiveActivityFeed events={DEMO_TICKET_LIFECYCLE_EVENTS} />
        </section>

        <LiveFileChanges
          fileChanges={DEMO_TICKET_LIFECYCLE_FILE_CHANGES}
          editorScheme="vscode"
          projectId={null}
          ticketId={DEMO_TICKET_LIFECYCLE_INFO.ticket_id}
          workspaceRoot=""
        />
      </div>
    </div>
  );
}
