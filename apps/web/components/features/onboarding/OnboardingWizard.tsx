'use client';

import { useState } from 'react';

import { CliSetupStep } from '@/components/features/onboarding/steps/CliSetupStep';
import { ConnectorSetupStep } from '@/components/features/onboarding/steps/ConnectorSetupStep';
import { ConnectResourceStep } from '@/components/features/onboarding/steps/ConnectResourceStep';
import { DownloadAppStep } from '@/components/features/onboarding/steps/DownloadAppStep';
import { NameProjectStep } from '@/components/features/onboarding/steps/NameProjectStep';
import { TerminalSettingsStep } from '@/components/features/onboarding/steps/TerminalSettingsStep';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

const createFirstOrganizationWithRetry = withElectronActionRetry(createFirstOrganization);
const updateOnboardingProgressActionWithRetry = withElectronActionRetry(
  updateOnboardingProgressAction
);
const createOnboardingTicketActionWithRetry = withElectronActionRetry(createOnboardingTicketAction);

type OnboardingWizardProps = {
  initialState: OnboardingState;
};

/**
 * Full-page onboarding wizard for web users.
 *
 * Flow:
 *   1 — Create organization  (skipped if exists)
 *   2 — Download Desktop App (web only)
 *       - Download → finish here; setup continues in the desktop app
 *       - Continue without the app → web path below
 *   3a (Electron) — Connect a resource (folder browser) → Terminal → Connectors
 *   3b (web decline) — Name project → CLI setup (install, auth, `ovld add-cwd`)
 *   →   Completion: create first draft ticket + hard refresh
 *
 * Registering an execution target needs either the desktop app or the CLI.
 * Web users who download the app finish setup there; web users who decline just
 * name a project (the browser can't read an absolute path), then the CLI-setup
 * step tells them to run `ovld add-cwd` from that folder to register this
 * machine as an execution target and link it to the project.
 */

type OnboardingStep =
  | 'organization'
  | 'download-app'
  | 'connect-resource'
  | 'name-project'
  | 'terminal-settings'
  | 'agent-connectors'
  | 'cli-setup';

export function OnboardingWizard({ initialState }: OnboardingWizardProps) {
  const { isElectron } = useElectron();

  const isInvitedUser = !!initialState.invitedOrganizationId;

  const getInitialStep = (): OnboardingStep => {
    if (isInvitedUser) return isElectron ? 'connect-resource' : 'download-app';
    if (!initialState.hasOrganizations) return 'organization';
    return isElectron ? 'connect-resource' : 'download-app';
  };

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(getInitialStep);
  // Web only: set when the user chooses to continue without the desktop app,
  // which reveals the Connect Resource + CLI setup steps.
  const [declinedDesktopApp, setDeclinedDesktopApp] = useState(false);

  // Build visible steps based on platform
  const allSteps: { key: OnboardingStep; label: string }[] = [];
  if (!isInvitedUser) {
    allSteps.push({ key: 'organization', label: 'Organization' });
  }
  if (!isElectron) {
    allSteps.push({ key: 'download-app', label: 'Desktop App' });
  }
  if (isElectron) {
    // On the desktop app the connection registers an execution target directly.
    allSteps.push({ key: 'connect-resource', label: 'Connect Resource' });
    allSteps.push({ key: 'terminal-settings', label: 'Terminal' });
    allSteps.push({ key: 'agent-connectors', label: 'Connectors' });
  } else if (declinedDesktopApp) {
    // Web users who skip the desktop app just name a project (no folder picker —
    // the browser can't read a real path), then register their machine as an
    // execution target via the CLI.
    allSteps.push({ key: 'name-project', label: 'Name Project' });
    allSteps.push({ key: 'cli-setup', label: 'CLI Setup' });
  }

  const currentIndex = allSteps.findIndex(s => s.key === currentStep);
  const progressPercent = allSteps.length > 1 ? (currentIndex / (allSteps.length - 1)) * 100 : 100;

  // State shared across steps
  const [organizationName, setOrganizationName] = useState(
    initialState.userName ? `${initialState.userName}'s organization` : 'My organization'
  );
  const [organizationId, setOrganizationId] = useState<number | null>(
    initialState.firstOrganizationId ?? initialState.invitedOrganizationId
  );
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgButtonState, setOrgButtonState] = useState<ButtonLoadingState>('default');

  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [createdProjectName, setCreatedProjectName] = useState('');
  const [executionTargetId, setExecutionTargetId] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');

  function nextStep() {
    const idx = allSteps.findIndex(s => s.key === currentStep);
    const next = allSteps[idx + 1];
    if (next) {
      setCurrentStep(next.key);
    } else {
      void completeOnboarding();
    }
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
      nextStep();
    } catch (error) {
      setOrgButtonState('error');
      setOrgError(error instanceof Error ? error.message : 'Failed to create organization.');
    }
  }

  async function handleDownloadAppContinue() {
    // Web-only step. Choosing to continue without the desktop app opens the
    // Connect Resource + CLI setup path. Set the flag before navigating so the
    // step list (computed on render) includes those steps.
    setDeclinedDesktopApp(true);
    await updateOnboardingProgressActionWithRetry({ completedStep: 2 });
    setCurrentStep('name-project');
  }

  function handleProjectNamed(result: {
    projectId: string;
    organizationId: number;
    projectName: string;
  }) {
    setCreatedProjectId(result.projectId);
    setCreatedProjectName(result.projectName);
    setOrganizationId(result.organizationId);
    void updateOnboardingProgressActionWithRetry({ completedStep: 3 }).then(() => {
      nextStep();
    });
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
    void updateOnboardingProgressActionWithRetry({ completedStep: 3 }).then(() => {
      nextStep();
    });
  }

  function handleTerminalSettingsContinue() {
    void updateOnboardingProgressActionWithRetry({ completedStep: 4 }).then(() => {
      nextStep();
    });
  }

  function handleConnectorsContinue() {
    void updateOnboardingProgressActionWithRetry({ completedStep: 5 }).then(() => {
      void completeOnboarding();
    });
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
      // Non-blocking — the ticket is a nice-to-have, not critical
    }

    await updateOnboardingProgressActionWithRetry({
      completedStep: 6,
      ...(isElectron ? { desktopSetupDone: true, desktopCompletedStep: 6 } : {})
    });

    // Hard refresh to ensure all caches are cleared
    window.location.href = '/u';
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="flex flex-col gap-0">
        {/* Progress header */}
        <div className="border-b px-6 pb-4 pt-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Get started</h1>
            <p className="text-muted-foreground text-sm">
              {`Step ${currentIndex + 1} of ${allSteps.length} — ${allSteps[currentIndex]?.label ?? ''}`}
            </p>
          </div>

          <div className="mt-3">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between">
              {allSteps.map(step => (
                <span
                  key={step.key}
                  className={cn(
                    'text-xs',
                    currentStep === step.key
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {currentStep === 'organization' && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Welcome to Overlord</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Start by creating a workspace for your projects, tickets, and agent runs.
                </p>
              </div>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="onboarding-organization-name">Organization name</FieldLabel>
                  <Input
                    id="onboarding-organization-name"
                    autoFocus
                    className="h-12"
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

          {currentStep === 'download-app' && (
            <DownloadAppStep
              title="Download the Desktop App"
              onContinue={handleDownloadAppContinue}
            />
          )}

          {currentStep === 'connect-resource' && (
            <ConnectResourceStep
              organizationId={organizationId}
              onConnected={handleResourceConnected}
            />
          )}

          {currentStep === 'name-project' && (
            <NameProjectStep organizationId={organizationId} onCreated={handleProjectNamed} />
          )}

          {currentStep === 'terminal-settings' && executionTargetId && (
            <TerminalSettingsStep
              executionTargetId={executionTargetId}
              onContinue={handleTerminalSettingsContinue}
            />
          )}

          {currentStep === 'agent-connectors' && (
            <ConnectorSetupStep
              onContinue={handleConnectorsContinue}
              projectDirectory={workingDirectory || undefined}
            />
          )}

          {currentStep === 'cli-setup' && (
            <CliSetupStep
              projectName={createdProjectName || undefined}
              onContinue={() => void completeOnboarding()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
