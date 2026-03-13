'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import type { OnboardingState } from '@/lib/actions/onboarding';

type TutorialWizardContextValue = {
  isOpen: boolean;
  startAtStep: number;
  initialState: OnboardingState | null;
  openTutorial: (opts?: { startAtStep?: number }) => void;
  closeTutorial: () => void;
};

const TutorialWizardContext = createContext<TutorialWizardContextValue>({
  isOpen: false,
  startAtStep: 3,
  initialState: null,
  openTutorial: () => undefined,
  closeTutorial: () => undefined
});

type TutorialProviderProps = {
  children: React.ReactNode;
  /** Whether the wizard should auto-open on mount (e.g. new user, incomplete tutorial). */
  autoOpen: boolean;
  /** Which step to start at when auto-opening. */
  autoOpenStep: number;
  /** Org/project state from the server — passed through to the wizard. */
  initialState: OnboardingState | null;
};

export function TutorialProvider({
  children,
  autoOpen,
  autoOpenStep,
  initialState
}: TutorialProviderProps) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [startAtStep, setStartAtStep] = useState(autoOpenStep);
  // Keep a mutable copy of state so the wizard can update it mid-flow
  const [state, setState] = useState<OnboardingState | null>(initialState);

  // If the server says we should auto-open but state changes (e.g. fast-nav), sync
  useEffect(() => {
    if (autoOpen && !isOpen) {
      setIsOpen(true);
      setStartAtStep(autoOpenStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  function openTutorial(opts?: { startAtStep?: number }) {
    setStartAtStep(opts?.startAtStep ?? 3);
    setIsOpen(true);
  }

  function closeTutorial() {
    setIsOpen(false);
  }

  return (
    <TutorialWizardContext.Provider
      value={{ isOpen, startAtStep, initialState: state, openTutorial, closeTutorial }}
    >
      {children}
    </TutorialWizardContext.Provider>
  );
}

export function useTutorialWizard() {
  return useContext(TutorialWizardContext);
}
