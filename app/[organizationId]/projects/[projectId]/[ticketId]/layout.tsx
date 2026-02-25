import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { TicketPanelContent } from '@/components/features/TicketPanelContent';
import { TicketPanelSkeleton } from '@/components/features/TicketPanelSkeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SidePanelSlot } from '@/components/ui/side-panel';
import { buildProjectPath } from '@/lib/helpers/ticket-path';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationId: string; projectId: string; ticketId: string }>;
};

export default async function TicketDetailLayout({ children, params }: LayoutProps) {
  const { organizationId, projectId, ticketId } = await params;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0 || !projectId) {
    notFound();
  }

  return (
    <>
      {children}
      <SidePanelSlot
        closePath={buildProjectPath({ organizationId: parsedOrganizationId, projectId })}
      >
        <Suspense fallback={<TicketPanelSkeleton />}>
          <ErrorBoundary>
            <TicketPanelContent
              key={ticketId}
              ticketId={ticketId}
              organizationId={parsedOrganizationId}
            />
          </ErrorBoundary>
        </Suspense>
      </SidePanelSlot>
    </>
  );
}
