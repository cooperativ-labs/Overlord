'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { SharedStateList } from '@/components/features/TicketPanelLive/SharedStateSection';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';

interface TicketToolsAndCriteriaProps {
  ticketId: string;
  availableTools: string | null;
  acceptanceCriteria: string | null;
}

export function TicketToolsAndCriteria({
  ticketId,
  availableTools,
  acceptanceCriteria
}: TicketToolsAndCriteriaProps) {
  const { sharedState } = useTicketLive();

  return (
    <Accordion type="multiple">
      <AccordionItem value="acceptance-criteria" className="border-b-0">
        <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
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
      <AccordionItem value="tools" className="border-b-0">
        <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
          Tools
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
      <AccordionItem value="shared-state" className="border-b-0">
        <AccordionTrigger className="eyebrow text-xs py-3 hover:no-underline">
          Shared State
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-2 pb-2">
            <SharedStateList sharedState={sharedState} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
