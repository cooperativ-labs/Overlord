import { AuthForm } from '@/components/forms/auth-form';
import { getInvitationByTokenAction } from '@/lib/actions/invitations';

export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
    invite?: string;
    name?: string;
  }>;
}) {
  const { error, message, next, invite, name } = await searchParams;

  let inviteEmail: string | undefined;
  let inviteToken: string | undefined;

  if (invite) {
    const invitation = await getInvitationByTokenAction(invite);
    if (invitation && invitation.status === 'pending') {
      inviteEmail = invitation.email;
      inviteToken = invite;
    }
  }

  return (
    <div className="w-full max-w-md">
      <AuthForm
        error={error}
        message={message}
        next={next}
        mode="signup"
        inviteToken={inviteToken}
        inviteEmail={inviteEmail}
        defaultName={name}
      />
    </div>
  );
}
