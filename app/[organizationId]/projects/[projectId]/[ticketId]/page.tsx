import { notFound } from 'next/navigation';

import TicketsBoardContent from '../../../../tickets/(components)/TicketsBoardContent';

type PageProps = {
  params: Promise<{ organizationId: string; projectId: string; ticketId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function TicketDetailBackground({ params, searchParams }: PageProps) {
  const { organizationId, projectId } = await params;
  const { view = 'board' } = await searchParams;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0 || !projectId) {
    notFound();
  }

  return (
    <TicketsBoardContent organizationId={parsedOrganizationId} projectId={projectId} view={view} />
  );
}
