import { redirect } from 'next/navigation';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { createClient } from '@/supabase/utils/server';

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: everhourIntegration } = await supabase
    .from('user_integrations')
    .select('updated_at')
    .eq('user_id', user.id)
    .eq('provider', 'everhour')
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your personal integrations and credentials.
        </p>
      </div>

      <EverhourSettings
        initiallyConnected={Boolean(everhourIntegration)}
        lastUpdatedAt={(everhourIntegration?.updated_at as string | undefined) ?? null}
      />
    </div>
  );
}
