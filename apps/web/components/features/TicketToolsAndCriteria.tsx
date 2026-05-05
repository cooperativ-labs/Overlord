'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import type { TaggingInspector } from '@/lib/tagging-engine';

import { TicketTaggingDebug } from './TicketTaggingDebug';

interface TicketToolsAndCriteriaProps {
  ticketId: string;
  availableTools: string | null;
  acceptanceCriteria: string | null;
  inspector: TaggingInspector | null;
}

export function TicketToolsAndCriteria({
  ticketId,
  availableTools,
  acceptanceCriteria,
  inspector
}: TicketToolsAndCriteriaProps) {
  return (
    <Accordion type="multiple">
      <AccordionItem value="tools" className="border-b-0">
        <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:no-underline">
          Available Tools
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-2 pb-2">
            <InlineEditField
              displayClassName="text-sm leading-relaxed"
              field="available_tools"
              initialValue={availableTools ?? ''}
              multiline
              placeholder="None specified — click to add."
              ticketId={ticketId}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="acceptance-criteria" className="border-b-0">
        <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:no-underline">
          Acceptance Criteria
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-2 pb-2">
            <InlineEditField
              displayClassName="text-sm leading-relaxed"
              field="acceptance_criteria"
              initialValue={acceptanceCriteria ?? ''}
              multiline
              placeholder="None specified — click to add."
              ticketId={ticketId}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
      <TicketTaggingDebug inspector={inspector} />
    </Accordion>
  );
}
