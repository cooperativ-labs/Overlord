import type { Metadata } from 'next';

import { UserSessionsPage } from '@/components/modals/settings/UserSessionsPage';

export const metadata: Metadata = {
  title: 'Sessions'
};

export default function AccountSessionsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-6">
      <UserSessionsPage open />
    </div>
  );
}
