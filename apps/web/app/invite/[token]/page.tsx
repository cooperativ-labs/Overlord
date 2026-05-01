import { redirect } from 'next/navigation';

import { getInvitationByTokenAction } from '@/lib/actions/invitations';
import { createClientForRequest } from '@/supabase/utils/server';

import { InvitePageClient } from './InvitePageClient';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getInvitationByTokenAction(token);

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // If user is authenticated and invitation is still pending, try to auto-accept
  if (user && invitation?.status === 'pending') {
    const { acceptInvitationAction } = await import('@/lib/actions/invitations');
    const result = await acceptInvitationAction(token);
    if (!result.error) {
      if (result.isNewUser) {
        redirect('/onboarding');
      } else {
        redirect('/u');
      }
    }
    // If there was an error (e.g. email mismatch), fall through to show the error UI
    return (
      <InvitePageClient
        invitation={invitation}
        user={user}
        token={token}
        acceptError={result.error}
      />
    );
  }

  return <InvitePageClient invitation={invitation} user={user} token={token} />;
}
