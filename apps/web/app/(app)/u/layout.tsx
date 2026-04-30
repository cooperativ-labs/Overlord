import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { OrganizationEmptyProjectsState } from '@/components/features/projects/OrganizationEmptyProjectsState';
import { TicketsBoardLoadingSkeleton } from '@/components/features/TicketsBoardLoadingSkeleton';
import { UserTicketsSettingsPanel } from '@/components/features/UserTicketsSettingsPanel';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import {
  createClientForRequest,
  getRequestDefaultProjectId,
  getRequestSelectedOrganizationId,
  isElectronRequestFromHeaders
} from '@/supabase/utils/server';

import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

type LayoutProps = {
  children: React.ReactNode;
};

export default async function UserLayout({ children }: LayoutProps) {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [organizations, projects, profileSettings] = await Promise.all([
    getUserOrganizations(),
    getProjectsForCurrentUser(),
    user ? fetchProfileSettings(supabase, user.id) : Promise.resolve(null)
  ]);
  const defaultProjectId = await getRequestDefaultProjectId({
    profileDefaultProjectId: profileSettings?.default_project_id ?? null
  });
  const selectedOrgId = await getRequestSelectedOrganizationId({
    organizations,
    profilePreferences: profileSettings?.preferences
  });

  const isElectronRequest = await isElectronRequestFromHeaders();
  if (!isElectronRequest && (organizations.length === 0 || projects.length === 0)) {
    // Web users without org/project data still need the onboarding flow.
    redirect('/onboarding');
  }

  // When a specific org is selected but it has no projects (other orgs may
  // still have some), show an in-board empty state with a create-project CTA
  // rather than rendering an empty board.
  const selectedOrg =
    selectedOrgId !== null ? organizations.find(org => org.id === selectedOrgId) : null;
  const selectedOrgHasNoProjects =
    selectedOrgId !== null && !projects.some(project => project.organizationId === selectedOrgId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <ErrorBoundary>
        <UserTicketsSettingsPanel selectedOrgId={selectedOrgId ?? undefined} />
        {selectedOrgHasNoProjects && selectedOrg ? (
          <OrganizationEmptyProjectsState
            organizationId={selectedOrg.id}
            organizationName={selectedOrg.name}
          />
        ) : null}
        <Suspense fallback={<TicketsBoardLoadingSkeleton variant="user" />}>
          <TicketsBoardContent
            organizationId={selectedOrgId ?? undefined}
            showOrganizationName={!selectedOrgId}
            mentionProjectId={defaultProjectId ?? undefined}
          />
        </Suspense>
        {children}
      </ErrorBoundary>
    </div>
  );
}
