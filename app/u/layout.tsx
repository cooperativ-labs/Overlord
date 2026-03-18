import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { UserTicketsSettingsPanel } from '@/components/features/UserTicketsSettingsPanel';
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

  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const isElectronRequest = userAgent.toLowerCase().includes('electron');
  if (!isElectronRequest) {
    // Web users without org/project → redirect to full-page onboarding
    redirect('/onboarding');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <ErrorBoundary>
        <UserTicketsSettingsPanel selectedOrgId={selectedOrgId} />
        <TicketsBoardContent organizationId={selectedOrgId} showOrganizationName={!selectedOrgId} />
        {children}
      </ErrorBoundary>
    </div>
  );
}
