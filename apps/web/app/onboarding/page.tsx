import { redirect } from 'next/navigation';

import { OnboardingWizard } from '@/components/features/onboarding/OnboardingWizard';
import { getOnboardingState } from '@/lib/actions/onboarding';
import { createClientForRequest } from '@/supabase/utils/server';

export default async function OnboardingPage() {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const state = await getOnboardingState();

  return (
    <div className="w-full">
      <OnboardingWizard initialState={state} />
    </div>
  );
}
