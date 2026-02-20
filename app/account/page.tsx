import { redirect } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account. For integrations (e.g. Everhour API key), use Settings in the
          sidebar.
        </p>
      </div>
    </div>
  );
}
