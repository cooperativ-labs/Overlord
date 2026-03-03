import { SessionsList } from '@/components/features/account/sessions-list';
import { getProfileDataAction } from '@/lib/actions/account';

export default async function AccountSessionsPage() {
  const profile = await getProfileDataAction();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Linked accounts</h2>
        <p className="text-muted-foreground text-sm">
          OAuth providers and login methods connected to your account.
        </p>
      </div>

      <SessionsList identities={profile.identities} />
    </div>
  );
}
