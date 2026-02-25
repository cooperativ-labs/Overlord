import { cookies } from 'next/headers';

import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

export default async function UserTicketsPage() {
  const cookieStore = await cookies();
  const rawOrgId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
  const selectedOrgId = rawOrgId ? Number(rawOrgId) : undefined;

  return (
    <TicketsBoardContent
      organizationId={selectedOrgId}
      showOrganizationName={!selectedOrgId}
      title={selectedOrgId ? 'Team Tasks' : 'All Tasks'}
      description={
        selectedOrgId
          ? 'Showing tasks for the selected workspace.'
          : 'Tasks from all your workspaces.'
      }
    />
  );
}
