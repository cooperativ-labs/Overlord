import { notFound } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function OrganizationTicketsPage({ params, searchParams }: PageProps) {
  const { organizationId } = await params;
  const { view = 'board' } = await searchParams;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  const supabase = await createClient();
  const { data: organization, error } = await supabase
    .from('organizations')
    .select('id,name')
    .eq('id', parsedOrganizationId)
    .single();

  if (error || !organization) {
    notFound();
  }

  return (
    <TicketsBoardContent
      view={view}
      organizationId={parsedOrganizationId}
      title={`${organization.name} Tickets`}
      description={`Showing tickets for ${organization.name}.`}
    />
  );
}
