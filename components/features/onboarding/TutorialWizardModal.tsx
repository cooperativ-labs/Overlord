'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

import { TutorialWizard } from './TutorialWizard';
import { useTutorialWizard } from './TutorialWizardContext';

export function TutorialWizardModal() {
  const { isOpen, startAtStep, initialState, closeTutorial } = useTutorialWizard();

  if (!isOpen || !initialState) return null;

  // Prevent accidental close while creating org/project (steps 1–2).
  // Once the user has an org + project (or we start at step 3+), allow dismissal.
  const needsWorkspace = !initialState.hasOrganizations || !initialState.hasProjects;
  const allowDismiss = !needsWorkspace || startAtStep >= 3;

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && allowDismiss) closeTutorial();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl"
        onPointerDownOutside={event => {
          if (!allowDismiss) event.preventDefault();
        }}
        onEscapeKeyDown={event => {
          if (!allowDismiss) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Overlord setup</DialogTitle>
        <DialogDescription className="sr-only">
          Set up your workspace and learn how Overlord works.
        </DialogDescription>
        <TutorialWizard
          initialState={initialState}
          startAtStep={startAtStep}
          onClose={closeTutorial}
        />
      </DialogContent>
    </Dialog>
  );
}
