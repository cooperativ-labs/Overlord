import { notFound } from 'next/navigation';

import TicketsBoardContent from '../../tickets/(components)/TicketsBoardContent';

type PageProps = {
  params: Promise<{ organizationId: string; ticketId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function TicketDetailBackground({ params, searchParams }: PageProps) {
  const { organizationId } = await params;
  const { view = 'board' } = await searchParams;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  return <TicketsBoardContent organizationId={parsedOrganizationId} view={view} />;
}
