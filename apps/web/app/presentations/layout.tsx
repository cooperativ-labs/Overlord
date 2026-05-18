import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';

function isLocalhost(host: string | null): boolean {
  return host?.split(':')[0] === 'localhost' || host?.split(':')[0] === '127.0.0.1';
}

export default async function PresentationsLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const host = headersList.get('host');

  if (isLocalhost(host)) {
    return <>{children}</>;
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    redirect('/');
  }

  return <>{children}</>;
}
