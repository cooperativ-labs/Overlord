'use client';

import { Building2 } from 'lucide-react';
import { useState } from 'react';

import { ConnectorSetupStep } from '@/components/features/onboarding/steps/ConnectorSetupStep';
import { ConnectResourceStep } from '@/components/features/onboarding/steps/ConnectResourceStep';
import { DownloadAppStep } from '@/components/features/onboarding/steps/DownloadAppStep';
import { TerminalSettingsStep } from '@/components/features/onboarding/steps/TerminalSettingsStep';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { OnboardingState } from '@/lib/actions/onboarding';
import {
  createFirstOrganization,
  createOnboardingTicketAction,
  updateOnboardingProgressAction
} from '@/lib/actions/onboarding';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { cn } from '@/lib/utils';

import { useTutorialWizard } from './TutorialWizardContext';

/**
 * Unified onboarding wizard used in the modal context.
 *
 * Steps:
 *   1 — Create organization  (skipped if exists)
 *   2 — Desktop: Connect a resource | Web: Download app
 *   3 — Desktop: Terminal settings
 *   4 — Desktop: Agent connectors
 *   →   Completion: create first draft ticket + hard refresh
 *
 * Connecting a resource registers an execution target, which only the desktop
 * app can do — so on the web the flow ends after Download App. Desktop steps
 * (2-4) appear even after the web flow because `desktopSetupDone` is tracked
 * independently, and the user connects their repo when they open the app.
 */

const WEB_TOTAL_STEPS = 2;
const DESKTOP_TOTAL_STEPS = 4;
const TUTORIAL_START_STEP = 2;

const createFirstOrganizationWithRetry = withElectronActionRetry(createFirstOrganization);
const updateOnboardingProgressActionWithRetry = withElectronActionRetry(
  updateOnboardingProgressAction
);
const createOnboardingTicketActionWithRetry = withElectronActionRetry(createOnboardingTicketAction);

type TutorialWizardProps = {
  initialState: OnboardingState;
  startAtStep: number;
  onClose: () => void;
};

export function TutorialWizard({ initialState, startAtStep, onClose }: TutorialWizardProps) {
  const { isElectron } = useElectron();
  const { updateState } = useTutorialWizard();
  const totalSteps = isElectron ? DESKTOP_TOTAL_STEPS : WEB_TOTAL_STEPS;

  const stepLabels: Record<number, string> = isElectron
    ? {
        1: 'Organization',
        2: 'Connect Resource',
        3: 'Terminal',
        4: 'Connectors'
      }
    : { 1: 'Organization', 2: 'Desktop App' };

  const fullVisibleSteps = isElectron ? [1, 2, 3, 4] : [1, 2];
  const tutorialVisibleSteps = isElectron ? [2, 3, 4] : [2];

  const isTutorialOnlyFlow = startAtStep >= TUTORIAL_START_STEP;
  const visibleSteps = isTutorialOnlyFlow ? tutorialVisibleSteps : fullVisibleSteps;

  function normalizeStep(step: number) {
    if (visibleSteps.includes(step)) return step;
    const next = visibleSteps.find(candidate => candidate > step);
    return next ?? visibleSteps[visibleSteps.length - 1];
  }

  const effectiveStart = isTutorialOnlyFlow
    ? normalizeStep(Math.min(Math.max(startAtStep, TUTORIAL_START_STEP), totalSteps))
    : !initialState.hasOrganizations
      ? 1
      : !initialState.hasProjects
        ? 2
        : normalizeStep(Math.min(Math.max(startAtStep, TUTORIAL_START_STEP), totalSteps));

  const [currentStep, setCurrentStep] = useState(effectiveStart);

  // Step 1 — Organization
  const [organizationName, setOrganizationName] = useState(
    initialState.userName ? `${initialState.userName}'s organization` : 'My organization'
  );
  const [organizationId, setOrganizationId] = useState<number | null>(
    initialState.firstOrganizationId
  );
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgButtonState, setOrgButtonState] = useState<ButtonLoadingState>('default');

  // Shared state from resource connection
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [executionTargetId, setExecutionTargetId] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');

  const canSkip = currentStep >= TUTORIAL_START_STEP;
  const currentVisibleIndex = visibleSteps.indexOf(currentStep);
  const currentVisibleStepNumber = currentVisibleIndex + 1;
  const totalVisibleSteps = visibleSteps.length;
  const progressPercent =
    totalVisibleSteps > 1 ? (currentVisibleIndex / (totalVisibleSteps - 1)) * 100 : 100;

  async function handleSkip() {
    await handleStepComplete(currentStep);
  }

  async function handleStepComplete(completedStepNumber: number) {
    if (completedStepNumber >= TUTORIAL_START_STEP) {
      const update = isElectron
        ? {
            completedStep: completedStepNumber,
            desktopCompletedStep: completedStepNumber,
            desktopSetupDone:
              initialState.desktopSetupDone || completedStepNumber >= DESKTOP_TOTAL_STEPS
          }
        : { completedStep: completedStepNumber };

      await updateOnboardingProgressActionWithRetry(update);
      updateState({
        onboardingCompletedStep: Math.max(
          initialState.onboardingCompletedStep,
          completedStepNumber
        ),
        ...(isElectron
          ? {
              desktopCompletedStep: Math.max(
                initialState.desktopCompletedStep,
                completedStepNumber
              ),
              desktopSetupDone:
                initialState.desktopSetupDone || completedStepNumber >= DESKTOP_TOTAL_STEPS
            }
          : {})
      });
    }
    const completedIndex = visibleSteps.indexOf(completedStepNumber);
    const nextStep = completedIndex >= 0 ? visibleSteps[completedIndex + 1] : undefined;
    if (!nextStep) {
      await completeOnboarding();
    } else {
      setCurrentStep(nextStep);
    }
  }

  async function completeOnboarding() {
    try {
      if (createdProjectId && organizationId) {
        await createOnboardingTicketActionWithRetry({
          projectId: createdProjectId,
          organizationId
        });
      }
    } catch {
      // Non-blocking
    }

    const update = isElectron
      ? {
          completedStep: totalSteps,
          desktopCompletedStep: DESKTOP_TOTAL_STEPS,
          desktopSetupDone: true
        }
      : { completedStep: totalSteps };
    await updateOnboardingProgressActionWithRetry(update);
    updateState({
      onboardingCompletedStep: Math.max(initialState.onboardingCompletedStep, totalSteps),
      ...(isElectron
        ? {
            desktopCompletedStep: DESKTOP_TOTAL_STEPS,
            desktopSetupDone: true
          }
        : {})
    });
    onClose();
    // Hard refresh so the newly created project, execution target, and first
    // draft ticket are reflected everywhere (matches the full-page onboarding flow).
    window.location.href = '/u';
  }

  async function handleCreateOrganization() {
    const trimmed = organizationName.trim();
    if (!trimmed) {
      setOrgError('Organization name is required.');
      return;
    }
    setOrgButtonState('loading');
    setOrgError(null);
    try {
      const result = await createFirstOrganizationWithRetry({ name: trimmed });
      setOrganizationId(result.organizationId);
      setOrgButtonState('success');
      setCurrentStep(2);
    } catch (error) {
      setOrgButtonState('error');
      setOrgError(error instanceof Error ? error.message : 'Failed to create organization.');
    }
  }

  function handleResourceConnected(result: {
    projectId: string;
    organizationId: number;
    executionTargetId: string | null;
    workingDirectory: string;
  }) {
    setCreatedProjectId(result.projectId);
    setOrganizationId(result.organizationId);
    setExecutionTargetId(result.executionTargetId);
    setWorkingDirectory(result.workingDirectory);
    void handleStepComplete(2);
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="border-b px-6 pb-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Get started</h1>
            <p className="text-muted-foreground text-sm">
              {`Step ${currentVisibleStepNumber} of ${totalVisibleSteps} — ${stepLabels[currentStep]}`}
            </p>
          </div>
          {canSkip && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSkip()}
              className="text-muted-foreground"
            >
              Skip for now
            </Button>
          )}
        </div>

        <div className="mt-3">
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between">
            {visibleSteps.map(step => (
              <span
                key={step}
                className={cn(
                  'text-xs',
                  currentStep === step ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}
              >
                {stepLabels[step]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {currentStep === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Welcome to Overlord</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Start by creating a workspace for your projects, tickets, and agent runs.
              </p>
            </div>

            <div className="rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Your workspace home</p>
                  <p className="text-muted-foreground text-sm">
                    Invite teammates later. For now, just give your workspace a clear name so you
                    can start organizing work.
                  </p>
                </div>
              </div>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="onboarding-organization-name">Organization name</FieldLabel>
                <Input
                  id="onboarding-organization-name"
                  value={organizationName}
                  onChange={event => {
                    setOrganizationName(event.target.value);
                    if (orgError) setOrgError(null);
                  }}
                  placeholder="Acme Inc."
                  aria-invalid={!!orgError}
                  aria-describedby={orgError ? 'onboarding-org-error' : undefined}
                />
                <FieldDescription>
                  You can invite teammates later. This is just the name of your workspace.
                </FieldDescription>
              </Field>
              {orgError ? (
                <Alert id="onboarding-org-error" variant="destructive" role="alert">
                  <AlertDescription>{orgError}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <LoadingButton
                  buttonState={orgButtonState}
                  setButtonState={setOrgButtonState}
                  text="Create organization"
                  loadingText="Creating…"
                  successText="Created"
                  errorText="Retry"
                  onClick={handleCreateOrganization}
                />
              </Field>
            </FieldGroup>
          </div>
        )}

        {currentStep === 2 &&
          (isElectron ? (
            <ConnectResourceStep
              organizationId={organizationId}
              onConnected={handleResourceConnected}
            />
          ) : (
            <DownloadAppStep onContinue={() => void handleStepComplete(2)} />
          ))}

        {currentStep === 3 && isElectron && (
          <TerminalSettingsStep
            executionTargetId={executionTargetId ?? ''}
            onContinue={() => void handleStepComplete(3)}
          />
        )}

        {currentStep === 4 && isElectron && (
          <ConnectorSetupStep
            onContinue={() => void handleStepComplete(4)}
            projectDirectory={workingDirectory || undefined}
          />
        )}
      </div>
    </div>
  );
}
