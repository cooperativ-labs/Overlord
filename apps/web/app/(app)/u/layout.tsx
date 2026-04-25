import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { TicketsBoardLoadingSkeleton } from '@/components/features/TicketsBoardLoadingSkeleton';
import { UserTicketsSettingsPanel } from '@/components/features/UserTicketsSettingsPanel';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import {
  getRequestDefaultProjectId,
  getRequestSelectedOrganizationId,
  isElectronRequestFromHeaders
} from '@/supabase/utils/server';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

type LayoutProps = {
  children: React.ReactNode;
};

export default async function UserLayout({ children }: LayoutProps) {
  const [organizations, projects] = await Promise.all([
    getUserOrganizations(),
    getProjectsForCurrentUser()
  ]);
  const defaultProjectId = await getRequestDefaultProjectId();
  const defaultProjectOrganizationId =
    projects.find(project => project.id === defaultProjectId)?.organizationId ?? null;
  const selectedOrgId = await getRequestSelectedOrganizationId({
    defaultProjectOrganizationId,
    organizations
  });

  const isElectronRequest = await isElectronRequestFromHeaders();
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
            mentionProjectId={defaultProjectId ?? undefined}
          />
        </Suspense>
        {children}
      </ErrorBoundary>
    </div>
  );
}
