import { redirect } from 'next/navigation';

import { OnboardingWizard } from '@/components/features/onboarding/OnboardingWizard';
import { getOnboardingState } from '@/lib/actions/onboarding';
import { createClient } from '@/supabase/utils/server';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const state = await getOnboardingState();

  // If user already has both org and project, send them to the dashboard
  if (state.hasOrganizations && state.hasProjects) {
    redirect('/u');
  }

  return (
    <div className="w-full max-w-md">
      <OnboardingWizard initialState={state} />
    </div>
  );
}
