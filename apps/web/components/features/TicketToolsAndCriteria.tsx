'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';

interface TicketToolsAndCriteriaProps {
  ticketId: string;
  organizationId: number;
  availableTools: string | null;
  acceptanceCriteria: string | null;
}

export function TicketToolsAndCriteria({
  ticketId,
  organizationId,
  availableTools,
  acceptanceCriteria
}: TicketToolsAndCriteriaProps) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="tools-criteria">
        <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:no-underline">
          Tools and Acceptance Criteria
        </AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-4 pl-2 pb-2">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Available Tools
              </h2>
              <InlineEditField
                displayClassName="text-sm leading-relaxed"
                field="available_tools"
                organizationId={organizationId}
                initialValue={availableTools ?? ''}
                multiline
                placeholder="None specified — click to add."
                ticketId={ticketId}
              />
            </div>
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Acceptance Criteria
              </h2>
              <InlineEditField
                displayClassName="text-sm leading-relaxed"
                field="acceptance_criteria"
                organizationId={organizationId}
                initialValue={acceptanceCriteria ?? ''}
                multiline
                placeholder="None specified — click to add."
                ticketId={ticketId}
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
