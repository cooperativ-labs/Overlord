'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter
} from '@/components/features/projects/ProjectColorSetter';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { OnboardingState } from '@/lib/actions/onboarding';
import { createFirstOrganization, createFirstProjectWithDirectory } from '@/lib/actions/onboarding';

type OnboardingWizardProps = {
  initialState: OnboardingState;
};

export function OnboardingWizard({ initialState }: OnboardingWizardProps) {
  const router = useRouter();
  const { api, isElectron } = useElectron();

  const [step, setStep] = useState<1 | 2>(1);
  const [organizationName, setOrganizationName] = useState(
    initialState.userName ? `${initialState.userName}'s organization` : 'My organization'
  );
  const [organizationId, setOrganizationId] = useState<number | null>(
    initialState.firstOrganizationId
  );
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgButtonState, setOrgButtonState] = useState<ButtonLoadingState>('default');

  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState(DEFAULT_PROJECT_COLOR);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectButtonState, setProjectButtonState] = useState<ButtonLoadingState>('default');

  async function handleCreateOrganization() {
    setOrgButtonState('loading');
    setOrgError(null);
    try {
      const result = await createFirstOrganization({ name: organizationName });
      setOrganizationId(result.organizationId);
      setOrgButtonState('success');
      setStep(2);
    } catch (error) {
      setOrgButtonState('error');
      setOrgError(error instanceof Error ? error.message : 'Failed to create organization.');
    }
  }

  async function handleChooseDirectory() {
    if (!api) return;
    setProjectError(null);
    const chosenPath = await api.terminal.chooseDirectory();
    if (!chosenPath) return;
    setWorkingDirectory(chosenPath);
  }

  async function handleCreateProject() {
    if (!organizationId) {
      setProjectError('Organization is required before creating a project.');
      return;
    }

    setProjectButtonState('loading');
    setProjectError(null);

    try {
      const result = await createFirstProjectWithDirectory({
        organizationId,
        name: projectName,
        color: projectColor,
        workingDirectory: workingDirectory.trim() || null
      });

      setProjectButtonState('success');
      router.push(`/${result.organizationId}/projects/${result.projectId}`);
    } catch (error) {
      setProjectButtonState('error');
      setProjectError(error instanceof Error ? error.message : 'Failed to create project.');
    }
  }

  if (initialState.hasOrganizations && initialState.hasProjects) {
    router.replace('/u');
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Overlord</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Let&apos;s get your workspace ready by creating an organization and your first project.
        </p>
      </div>

      <div className="flex gap-2 text-sm text-muted-foreground">
        <span
          className={step === 1 ? 'font-semibold text-foreground' : ''}
        >{`1. Organization`}</span>
        <span>›</span>
        <span className={step === 2 ? 'font-semibold text-foreground' : ''}>{`2. Project`}</span>
      </div>

      {step === 1 ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-organization-name">Organization name</FieldLabel>
            <Input
              id="onboarding-organization-name"
              value={organizationName}
              onChange={event => setOrganizationName(event.target.value)}
              placeholder="Acme Inc."
            />
            <FieldDescription>
              You can invite teammates later. This is just the name of your workspace.
            </FieldDescription>
          </Field>
          {orgError ? <p className="text-sm text-destructive">{orgError}</p> : null}
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
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-project-name">Project name</FieldLabel>
            <Input
              id="onboarding-project-name"
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
              placeholder="Agent orchestration"
            />
          </Field>
          <Field>
            <FieldLabel>Project color</FieldLabel>
            <ProjectColorSetter value={projectColor} onSelect={setProjectColor} />
          </Field>
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
              {isElectron ? (
                <Button type="button" variant="outline" size="sm" onClick={handleChooseDirectory}>
                  Choose folder
                </Button>
              ) : null}
            </div>
            <FieldDescription>
              When you run agents for this project, terminals will open in this directory.
            </FieldDescription>
          </Field>
          {projectError ? <p className="text-sm text-destructive">{projectError}</p> : null}
          <Field>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
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
    </div>
  );
}
