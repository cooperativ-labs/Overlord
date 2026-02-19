import { notFound } from 'next/navigation';

import { TicketPanelContent } from '@/components/features/TicketPanelContent';
import { SidePanelSlot } from '@/components/ui/side-panel';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationId: string; ticketId: string }>;
};

export default async function TicketDetailLayout({ children, params }: LayoutProps) {
  const { organizationId, ticketId } = await params;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  return (
    <>
      {children}
      <SidePanelSlot closePath={`/${parsedOrganizationId}`}>
        <TicketPanelContent
          key={ticketId}
          ticketId={ticketId}
          organizationId={parsedOrganizationId}
        />
      </SidePanelSlot>
    </>
  );
}
