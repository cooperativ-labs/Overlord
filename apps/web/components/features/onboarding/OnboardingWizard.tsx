'use client';

import { Building2, FolderKanban, FolderSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

import { DownloadAppStep } from '@/components/features/onboarding/steps/DownloadAppStep';
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
import { cn } from '@/lib/utils';

type OnboardingWizardProps = {
  initialState: OnboardingState;
};

/**
 * Full-page onboarding wizard for web users.
 *
 * Flow:
 *   1 — Create organization  (skipped if exists)
 *   2 — Download the Desktop App (skipped on Electron)
 *       - "I'll use the web app for now" → goes to step 3
 *   3 — Create first project
 *       - After creation → redirect to /u
 */

type OnboardingStep = 'organization' | 'download-app' | 'project';

export function OnboardingWizard({ initialState }: OnboardingWizardProps) {
  const router = useRouter();
  const { api, isElectron } = useElectron();

  // Determine starting step
  const getInitialStep = (): OnboardingStep => {
    if (!initialState.hasOrganizations) return 'organization';
    if (!initialState.hasProjects) return 'download-app';
    return 'download-app';
  };

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(getInitialStep);

  // Step labels for progress bar
  const steps: { key: OnboardingStep; label: string }[] = [
    { key: 'organization', label: 'Organization' },
    { key: 'download-app', label: 'Desktop App' },
    { key: 'project', label: 'Project' }
  ];

  const currentIndex = steps.findIndex(s => s.key === currentStep);
  const progressPercent = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 100;

  // Step 1 — Organization
  const [organizationName, setOrganizationName] = useState(
    initialState.userName ? `${initialState.userName}'s organization` : 'My organization'
  );
  const [organizationId, setOrganizationId] = useState<number | null>(
    initialState.firstOrganizationId
  );
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgButtonState, setOrgButtonState] = useState<ButtonLoadingState>('default');

  // Step 3 — Project
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState(DEFAULT_PROJECT_COLOR);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectButtonState, setProjectButtonState] = useState<ButtonLoadingState>('default');
  const directoryInputRef = useRef<HTMLInputElement>(null);

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
      // After org creation, go to download app step
      setCurrentStep('download-app');
    } catch (error) {
      setOrgButtonState('error');
      setOrgError(error instanceof Error ? error.message : 'Failed to create organization.');
    }
  }

  async function handleDownloadAppContinue() {
    // User downloaded app or skipped — mark step complete and go to project creation
    await updateOnboardingProgressAction({ completedStep: 3 });
    setCurrentStep('project');
  }

  async function handleChooseDirectory() {
    setProjectError(null);
    if (isElectron && api) {
      try {
        const chosenPath = await api.terminal.chooseDirectory();
        if (!chosenPath) return;
        setWorkingDirectory(chosenPath);
        return;
      } catch (err) {
        Sentry.captureException(err);
        console.error('handleChooseDirectory', err);
      }
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
        } else {
          Sentry.captureException(err);
          console.error('handleChooseDirectory', err);
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
      await createFirstProjectWithDirectory({
        organizationId,
        name: trimmedName,
        color: projectColor,
        workingDirectory: workingDirectory.trim() || null
      });
      setProjectButtonState('success');
      await updateOnboardingProgressAction({ completedStep: 4, skipped: true });
      router.push('/u');
    } catch (error) {
      setProjectButtonState('error');
      setProjectError(error instanceof Error ? error.message : 'Failed to create project.');
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="flex flex-col gap-0">
        {/* Progress header */}
        <div className="border-b px-6 pb-4 pt-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Get started</h1>
            <p className="text-muted-foreground text-sm">
              {`Step ${currentIndex + 1} of ${steps.length} — ${steps[currentIndex].label}`}
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
              {steps.map(step => (
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

              {/* <div className="rounded-xl border p-4">
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
              </div> */}

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

          {currentStep === 'project' && (
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
                    autoFocus
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
                      onClick={() => setCurrentStep('download-app')}
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
        </div>
      </div>
    </div>
  );
}
