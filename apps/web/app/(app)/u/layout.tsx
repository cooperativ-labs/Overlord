import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { TicketsBoardLoadingSkeleton } from '@/components/features/TicketsBoardLoadingSkeleton';
import { UserTicketsSettingsPanel } from '@/components/features/UserTicketsSettingsPanel';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

type LayoutProps = {
  children: React.ReactNode;
};

export default async function UserLayout({ children }: LayoutProps) {
  const cookieStore = await cookies();
  const rawOrgId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
  const selectedOrgId = rawOrgId ? Number(rawOrgId) : undefined;
  const defaultProjectId = cookieStore.get(DEFAULT_PROJECT_COOKIE)?.value ?? undefined;
  const [organizations, projects] = await Promise.all([
    getUserOrganizations(),
    getProjectsForCurrentUser()
  ]);

  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const isElectronRequest = userAgent.toLowerCase().includes('electron');
  if (!isElectronRequest && (organizations.length === 0 || projects.length === 0)) {
    // Web users without org/project data still need the onboarding flow.
    redirect('/onboarding');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <ErrorBoundary>
        <UserTicketsSettingsPanel selectedOrgId={selectedOrgId} />
        <Suspense fallback={<TicketsBoardLoadingSkeleton variant="user" />}>
          <TicketsBoardContent
            organizationId={selectedOrgId}
            showOrganizationName={!selectedOrgId}
            mentionProjectId={defaultProjectId}
          />
        </Suspense>
        {children}
      </ErrorBoundary>
    </div>
  );
}
