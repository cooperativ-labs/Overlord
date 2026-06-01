'use client';

import { FolderKanban } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_PROJECT_COLOR } from '@/components/features/projects/ProjectColorSetter';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createFirstProjectWithDirectory } from '@/lib/actions/onboarding';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const createFirstProjectWithDirectoryWithRetry = withElectronActionRetry(
  createFirstProjectWithDirectory
);

type Props = {
  organizationId: number | null;
  onCreated: (result: { projectId: string; organizationId: number; projectName: string }) => void;
};

/**
 * Web-only step: just name the project. The browser can't read an absolute
 * path, so there's nothing to gain from a folder picker here — the user links
 * the actual directory + execution target later via `ovld add-cwd`.
 */
export function NameProjectStep({ organizationId, onCreated }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required.');
      return;
    }
    if (!organizationId) {
      setError('Organization is required before creating a project.');
      return;
    }
    setButtonState('loading');
    setError(null);
    try {
      const result = await createFirstProjectWithDirectoryWithRetry({
        organizationId,
        name: trimmed,
        color: DEFAULT_PROJECT_COLOR,
        workingDirectory: null
      });
      setButtonState('success');
      onCreated({
        projectId: result.projectId,
        organizationId: result.organizationId,
        projectName: trimmed
      });
    } catch (err) {
      setButtonState('error');
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Name your first project</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          A project is where your tickets live. You'll connect it to a folder on your machine in the
          next step using the CLI.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">One project per codebase</p>
            <p className="text-muted-foreground text-sm">
              Use a project for each repo or product area you want agents to work in.
            </p>
          </div>
        </div>
      </div>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="onboarding-project-name">Project name</FieldLabel>
          <Input
            id="onboarding-project-name"
            autoFocus
            value={name}
            onChange={event => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            placeholder="My project"
            aria-invalid={!!error}
            aria-describedby={error ? 'onboarding-project-name-error' : undefined}
          />
          <FieldDescription>
            Tip: match it to the folder name you'll connect later.
          </FieldDescription>
        </Field>
        {error ? (
          <Alert id="onboarding-project-name-error" variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <LoadingButton
          buttonState={buttonState}
          setButtonState={setButtonState}
          text="Create project"
          loadingText="Creating…"
          successText="Created"
          errorText="Retry"
          onClick={handleCreate}
          disabled={!name.trim()}
        />
      </FieldGroup>
    </div>
  );
}
