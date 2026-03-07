'use client';

import { OnboardingWizard } from '@/components/features/onboarding/OnboardingWizard';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { OnboardingState } from '@/lib/actions/onboarding';

type OrganizationOnboardingModalProps = {
  initialState: OnboardingState;
};

export function OrganizationOnboardingModal({ initialState }: OrganizationOnboardingModalProps) {
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Complete onboarding</DialogTitle>
        <DialogDescription className="sr-only">
          Create your organization and first project to continue.
        </DialogDescription>
        <OnboardingWizard initialState={initialState} />
      </DialogContent>
    </Dialog>
  );
}
