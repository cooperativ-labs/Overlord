'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter
} from '@/components/features/projects/ProjectColorSetter';
import { useElectron } from '@/components/features/terminal/useElectron';
import { DownloadAppStep } from '@/components/features/onboarding/steps/DownloadAppStep';
import { AgentSetupStep } from '@/components/features/onboarding/steps/AgentSetupStep';
import { TicketFlowStep } from '@/components/features/onboarding/steps/TicketFlowStep';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { AgentTypeValue } from '@/lib/helpers/agent-types';
import {
  createFirstOrganization,
  createFirstProjectWithDirectory,
  updateOnboardingProgressAction
} from '@/lib/actions/onboarding';
import type { OnboardingState } from '@/lib/actions/onboarding';
import { cn } from '@/lib/utils';

const TOTAL_STEPS = 5;

const STEP_LABELS = ['Organization', 'Project', 'Desktop App', 'Agent Setup', 'How it works'];

type TutorialWizardProps = {
  initialState: OnboardingState;
  /** Which step to start at. Steps 1–2 are skipped if org/project already exist. */
  startAtStep: number;
  onClose: () => void;
};

export function TutorialWizard({ initialState, startAtStep, onClose }: TutorialWizardProps) {
  const router = useRouter();
  const { api, isElectron } = useElectron();

  // Determine the effective first step
  const effectiveStart = !initialState.hasOrganizations
    ? 1
    : !initialState.hasProjects
      ? 2
      : Math.min(Math.max(startAtStep, 3), TOTAL_STEPS);

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

  // Preferred agent across steps
  const [preferredAgent] = useState<AgentTypeValue | undefined>(initialState.preferredAgent);

  const canSkip = currentStep >= 3;

  async function handleSkip() {
    await updateOnboardingProgressAction({ skipped: true });
    onClose();
  }

  async function advanceTo(step: number) {
    if (step > TOTAL_STEPS) {
      await updateOnboardingProgressAction({ completedStep: TOTAL_STEPS });
      onClose();
    } else {
      setCurrentStep(step);
    }
  }

  async function handleStepComplete(completedStepNumber: number) {
    if (completedStepNumber >= 3) {
      await updateOnboardingProgressAction({ completedStep: completedStepNumber });
    }
    if (completedStepNumber === TOTAL_STEPS) {
      onClose();
    } else {
      await advanceTo(completedStepNumber + 1);
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
      const result = await createFirstOrganization({ name: trimmed });
      setOrganizationId(result.organizationId);
      setOrgButtonState('success');
      await advanceTo(2);
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
      const result = await createFirstProjectWithDirectory({
        organizationId,
        name: trimmedName,
        color: projectColor,
        workingDirectory: workingDirectory.trim() || null
      });
      setProjectButtonState('success');
      // Advance to step 3 (tutorial) — router.refresh so layout picks up new org/project
      router.refresh();
      await advanceTo(3);
    } catch (error) {
      setProjectButtonState('error');
      setProjectError(error instanceof Error ? error.message : 'Failed to create project.');
    }
  }

  // Progress bar: only show for tutorial steps 3–5
  const showProgress = currentStep >= 3;
  const progressPercent = showProgress
    ? ((currentStep - 3) / (TOTAL_STEPS - 3)) * 100
    : 0;

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="border-b px-6 pb-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {currentStep <= 2 ? 'Welcome to Overlord' : 'Get started'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {currentStep <= 2
                ? "Let's set up your workspace."
                : `Step ${currentStep - 2} of 3 — ${STEP_LABELS[currentStep - 1]}`}
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

        {/* Step dots (1–2 = workspace, 3–5 = tutorial) */}
        {currentStep <= 2 ? (
          <div className="mt-3 flex gap-2 text-xs text-muted-foreground">
            <span className={cn('font-medium', currentStep === 1 && 'text-foreground')}>
              1. Organization
            </span>
            <span>›</span>
            <span className={cn(currentStep === 2 && 'text-foreground font-medium')}>
              2. Project
            </span>
          </div>
        ) : (
          <div className="mt-3">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between">
              {STEP_LABELS.slice(2).map((label, i) => (
                <span
                  key={label}
                  className={cn(
                    'text-xs',
                    currentStep === i + 3 ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step content */}
      <div className="px-6 py-5">
        {currentStep === 1 && (
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
        )}

        {currentStep === 2 && (
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
                  <Button type="button" variant="outline" size="sm" onClick={handleChooseDirectory}>
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
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentStep(1)}>
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
        )}

        {currentStep === 3 && (
          <DownloadAppStep onContinue={() => void handleStepComplete(3)} />
        )}

        {currentStep === 4 && (
          <AgentSetupStep
            initialPreferredAgent={preferredAgent}
            onContinue={() => void handleStepComplete(4)}
          />
        )}

        {currentStep === 5 && (
          <TicketFlowStep onContinue={() => void handleStepComplete(5)} />
        )}
      </div>
    </div>
  );
}
