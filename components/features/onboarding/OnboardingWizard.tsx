'use client';

import { useRouter } from 'next/navigation';

import { TutorialWizard } from '@/components/features/onboarding/TutorialWizard';
import type { OnboardingState } from '@/lib/actions/onboarding';

type OnboardingWizardProps = {
  initialState: OnboardingState;
};

/**
 * Thin wrapper around the unified TutorialWizard for the /onboarding page.
 * Redirects to /u if onboarding is already complete.
 */
export function OnboardingWizard({ initialState }: OnboardingWizardProps) {
  const router = useRouter();

  if (initialState.hasOrganizations && initialState.hasProjects) {
    router.replace('/u');
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <TutorialWizard
        initialState={initialState}
        startAtStep={1}
        onClose={() => router.push('/u')}
      />
    </div>
  );
}
