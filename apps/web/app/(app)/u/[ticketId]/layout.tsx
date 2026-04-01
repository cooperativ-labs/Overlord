import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { TicketPanelContent } from '@/components/features/TicketPanelContent';
import { TicketPanelSkeleton } from '@/components/features/TicketPanelSkeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SidePanelSlot } from '@/components/ui/side-panel';
import { createClient } from '@/supabase/utils/server';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ ticketId: string }>;
};

const CLOSE_PATH = '/u';

export default async function UserTicketDetailLayout({ children, params }: LayoutProps) {
  const { ticketId } = await params;

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('organization_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) {
    notFound();
  }

  return (
    <>
      {children}
      <SidePanelSlot closePath={CLOSE_PATH}>
        <Suspense fallback={<TicketPanelSkeleton />}>
          <ErrorBoundary>
            <TicketPanelContent
              key={ticketId}
              ticketId={ticketId}
              organizationId={ticket.organization_id}
              closePath={CLOSE_PATH}
            />
          </ErrorBoundary>
        </Suspense>
      </SidePanelSlot>
    </>
  );
}
