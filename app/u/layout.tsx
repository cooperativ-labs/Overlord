import { cookies } from 'next/headers';

import { DefaultProjectSection } from '@/components/features/projects/DefaultProjectSection';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

type LayoutProps = {
  children: React.ReactNode;
};

export default async function UserLayout({ children }: LayoutProps) {
  const cookieStore = await cookies();
  const rawOrgId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
  const selectedOrgId = rawOrgId ? Number(rawOrgId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorBoundary>
        <DefaultProjectSection />
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
        {children}
      </ErrorBoundary>
    </div>
  );
}
