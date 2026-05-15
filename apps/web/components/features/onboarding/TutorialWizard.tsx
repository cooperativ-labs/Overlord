'use client';

import * as Sentry from '@sentry/nextjs';
import { Building2, FolderKanban, FolderSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { CliInstallStep } from '@/components/features/onboarding/steps/CliInstallStep';
import { ConnectorSetupStep } from '@/components/features/onboarding/steps/ConnectorSetupStep';
import { DownloadAppStep } from '@/components/features/onboarding/steps/DownloadAppStep';
import { TicketFlowStep } from '@/components/features/onboarding/steps/TicketFlowStep';
import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter
} from '@/components/features/projects/ProjectColorSetter';
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
  createFirstProjectWithDirectory,
  updateOnboardingProgressAction
} from '@/lib/actions/onboarding';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { refreshElectronRoute } from '@/lib/electron-auth/route-refresh';
import { cn } from '@/lib/utils';

import { useTutorialWizard } from './TutorialWizardContext';

/**
 * Unified onboarding wizard.
 *
 * Steps:
 *   1 — Create organization  (skipped if exists)
 *   2 — Create first project (skipped if exists)
 *   3 — Desktop: Install CLI | Web: Download app
 *   4 — Desktop: Agent connectors | Web: How tickets work
 *   5 — Desktop only: How tickets work
 *
 * Desktop steps (3) appear even if the user already completed the web flow,
 * because `desktopSetupDone` is tracked independently.
 */

const WEB_TOTAL_STEPS = 4;
const DESKTOP_TOTAL_STEPS = 5;
const TUTORIAL_START_STEP = 3;

const createFirstOrganizationWithRetry = withElectronActionRetry(createFirstOrganization);
const createFirstProjectWithDirectoryWithRetry = withElectronActionRetry(
  createFirstProjectWithDirectory
);
const updateOnboardingProgressActionWithRetry = withElectronActionRetry(
  updateOnboardingProgressAction
);

type TutorialWizardProps = {
  initialState: OnboardingState;
  /** Which step to start at. Steps 1–2 are skipped if org/project already exist. */
  startAtStep: number;
  onClose: () => void;
};

export function TutorialWizard({ initialState, startAtStep, onClose }: TutorialWizardProps) {
  const router = useRouter();
  const { api, isElectron } = useElectron();
  const { updateState } = useTutorialWizard();
  const totalSteps = isElectron ? DESKTOP_TOTAL_STEPS : WEB_TOTAL_STEPS;

  const stepLabels: Record<number, string> = isElectron
    ? {
        1: 'Organization',
        2: 'Project',
        3: 'Install CLI',
        4: 'Agent connectors',
        5: 'How it works'
      }
    : { 1: 'Organization', 2: 'Project', 3: 'Desktop App', 4: 'How it works' };

  const fullVisibleSteps = isElectron ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
  const tutorialVisibleSteps = isElectron ? [3, 4, 5] : [3, 4];

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

  // Step 2 — Project
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState(DEFAULT_PROJECT_COLOR);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectButtonState, setProjectButtonState] = useState<ButtonLoadingState>('default');
  const directoryInputRef = useRef<HTMLInputElement>(null);

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
    } else {
      setCurrentStep(nextStep);
    }
  }

  // --- Step 1 handlers ---
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

  // --- Step 2 handlers ---
  async function handleChooseDirectory() {
    setProjectError(null);
    if (isElectron && api) {
      const chosenPath = await api.terminal.chooseDirectory();
      if (!chosenPath) return;
      setWorkingDirectory(chosenPath);
      return;
    }
    const w =
      typeof window !== 'undefined'
        ? (window as Window & { showDirectoryPicker?(): Promise<{ name: string }> })
        : null;
    if (w?.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        setWorkingDirectory(handle.name);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setProjectError('Could not access the selected folder.');
        }
      }
      return;
    }
    directoryInputRef.current?.click();
  }

  function handleWebDirectoryInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = firstPath ? firstPath.split('/')[0] : '';
    e.target.value = '';
    if (folderName) setWorkingDirectory(folderName);
  }

  async function handleCreateProject() {
    if (!organizationId) {
      setProjectError('Organization is required before creating a project.');
      return;
    }
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setProjectError('Project name is required.');
      return;
    }
    setProjectButtonState('loading');
    setProjectError(null);
    try {
      let deviceIdentity: { deviceFingerprint: string; hostname: string; platform: string } | null =
        null;
      if (isElectron && api?.app?.getDeviceIdentity) {
        try {
          deviceIdentity = await api.app.getDeviceIdentity();
        } catch (error) {
          Sentry.captureException(error);
          console.error('handleCreateProject:getDeviceIdentity', error);
        }
      }

      await createFirstProjectWithDirectoryWithRetry({
        organizationId,
        name: trimmedName,
        color: projectColor,
        workingDirectory: workingDirectory.trim() || null,
        ...(deviceIdentity
          ? {
              deviceFingerprint: deviceIdentity.deviceFingerprint,
              deviceHostname: deviceIdentity.hostname,
              devicePlatform: deviceIdentity.platform
            }
          : {})
      });
      setProjectButtonState('success');
      await refreshElectronRoute(router);
      setCurrentStep(3);
    } catch (error) {
      setProjectButtonState('error');
      setProjectError(error instanceof Error ? error.message : 'Failed to create project.');
    }
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

        {currentStep === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Create your first project</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Projects give tickets a home and tell Overlord where agents should work.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">One project, one codebase</p>
                    <p className="text-muted-foreground text-sm">
                      Use a project for each repo or product area you want agents to work in.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                    <FolderSearch className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Attach a working directory</p>
                    <p className="text-muted-foreground text-sm">
                      In the desktop app, agent terminals open directly in this folder.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="onboarding-project-name">Project name</FieldLabel>
                <Input
                  id="onboarding-project-name"
                  value={projectName}
                  onChange={event => {
                    setProjectName(event.target.value);
                    if (projectError) setProjectError(null);
                  }}
                  placeholder="Agent orchestration"
                  aria-invalid={!!projectError}
                  aria-describedby={projectError ? 'onboarding-project-error' : undefined}
                />
              </Field>
              <Field>
                <FieldLabel>Project color</FieldLabel>
                <ProjectColorSetter
                  value={projectColor}
                  onSelect={color => {
                    setProjectColor(color);
                    if (projectError) setProjectError(null);
                  }}
                />
              </Field>
              {isElectron ? (
                <Field>
                  <FieldLabel htmlFor="onboarding-working-directory">Local directory</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="onboarding-working-directory"
                      value={workingDirectory}
                      onChange={event => setWorkingDirectory(event.target.value)}
                      placeholder="/absolute/path/to/your/project"
                      className="min-w-[260px] flex-1"
                    />
                    <input
                      ref={directoryInputRef}
                      type="file"
                      {...({
                        webkitdirectory: '',
                        directory: ''
                      } as React.InputHTMLAttributes<HTMLInputElement>)}
                      multiple
                      className="hidden"
                      aria-hidden
                      tabIndex={-1}
                      onChange={handleWebDirectoryInputChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleChooseDirectory}
                    >
                      Choose folder
                    </Button>
                  </div>
                  <FieldDescription>
                    When you run agents for this project, terminals will open in this directory.
                  </FieldDescription>
                </Field>
              ) : null}
              {projectError ? (
                <Alert id="onboarding-project-error" variant="destructive" role="alert">
                  <AlertDescription>{projectError}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentStep(1)}
                  >
                    Back
                  </Button>
                  <LoadingButton
                    buttonState={projectButtonState}
                    setButtonState={setProjectButtonState}
                    text="Create project"
                    loadingText="Creating…"
                    successText="Created"
                    errorText="Retry"
                    onClick={handleCreateProject}
                  />
                </div>
              </Field>
            </FieldGroup>
          </div>
        )}

        {currentStep === 3 &&
          (isElectron ? (
            <CliInstallStep onContinue={() => void handleStepComplete(3)} />
          ) : (
            <DownloadAppStep onContinue={() => void handleStepComplete(3)} />
          ))}

        {currentStep === 4 &&
          (isElectron ? (
            <ConnectorSetupStep
              onContinue={() => void handleStepComplete(4)}
              projectDirectory={workingDirectory.trim() || undefined}
            />
          ) : (
            <TicketFlowStep onContinue={() => void handleStepComplete(4)} />
          ))}

        {currentStep === 5 && isElectron && (
          <TicketFlowStep onContinue={() => void handleStepComplete(5)} />
        )}
      </div>
    </div>
  );
}
