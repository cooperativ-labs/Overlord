'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';

import { DEMO_TICKET_DETAILS } from './mock-ticket-details';

type DemoTicketExtrasAccordionProps = {
  className?: string;
};

export function DemoTicketExtrasAccordion({ className }: DemoTicketExtrasAccordionProps) {
  return (
    <div className={cn('border-t px-5 pb-2', className)}>
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
  );
}
