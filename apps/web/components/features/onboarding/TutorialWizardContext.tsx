'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import type { OnboardingState } from '@/lib/actions/onboarding';

const DESKTOP_SETUP_START_STEP = 2;
const DESKTOP_SETUP_LAST_STEP = 4;

function getNextDesktopStep(state: OnboardingState | null): number | null {
  if (!state || state.desktopSetupDone) return null;

  const nextStep = Math.max(DESKTOP_SETUP_START_STEP, (state.desktopCompletedStep || 0) + 1);
  return nextStep <= DESKTOP_SETUP_LAST_STEP ? nextStep : null;
}

type TutorialWizardContextValue = {
  isOpen: boolean;
  startAtStep: number;
  initialState: OnboardingState | null;
  updateState: (update: Partial<OnboardingState>) => void;
  openTutorial: (opts?: { startAtStep?: number }) => void;
  closeTutorial: () => void;
};

const TutorialWizardContext = createContext<TutorialWizardContextValue>({
  isOpen: false,
  startAtStep: 2,
  initialState: null,
  updateState: () => undefined,
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

  // Desktop-specific: if the user completed the web flow but hasn't done desktop
  // CLI + connector setup, auto-open at the desktop onboarding step on Electron.
  useEffect(() => {
    if (!state) return;
    const onElectron = !!window.electronAPI?.isElectron;
    if (!onElectron) return;

    // Web flow is now 2 steps (org → download app); connecting a resource is
    // desktop-only, so the web portion is "done" once completedStep reaches 2.
    // Keep this in sync with WEB_TOTAL_STEPS in TutorialWizard.tsx.
    const webDone = state.onboardingCompletedStep >= 2 || state.onboardingSkipped;
    const nextDesktopStep = getNextDesktopStep(state);

    if (webDone && nextDesktopStep !== null && !isOpen) {
      setStartAtStep(nextDesktopStep);
      setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function updateState(update: Partial<OnboardingState>) {
    setState(current => (current ? { ...current, ...update } : current));
  }

  function openTutorial(opts?: { startAtStep?: number }) {
    setStartAtStep(opts?.startAtStep ?? getNextDesktopStep(state) ?? 2);
    setIsOpen(true);
  }

  function closeTutorial() {
    setIsOpen(false);
  }

  return (
    <TutorialWizardContext.Provider
      value={{ isOpen, startAtStep, initialState: state, updateState, openTutorial, closeTutorial }}
    >
      {children}
    </TutorialWizardContext.Provider>
  );
}

export function useTutorialWizard() {
  return useContext(TutorialWizardContext);
}
