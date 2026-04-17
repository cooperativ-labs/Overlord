'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter,
  toHexColor
} from '@/components/features/projects/ProjectColorSetter';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { useCreateProjectMutation } from '@/lib/client-data/projects/mutations';
import { buildProjectPath } from '@/lib/helpers/ticket-path';

type ProjectCreatorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: number;
};

export function ProjectCreatorModal({
  open,
  onOpenChange,
  organizationId
}: ProjectCreatorModalProps) {
  const router = useRouter();
  const createProjectMutation = useCreateProjectMutation();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('');
      setColor(DEFAULT_PROJECT_COLOR);
      setError(null);
      setCreateButtonState('default');
    }
    onOpenChange(next);
  }

  async function handleCreate() {
    setCreateButtonState('loading');
    setError(null);

    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Project name is required.');
      }

      const hexColor = toHexColor(color);
      if (!hexColor) {
        throw new Error('Use a valid 6-digit hex color, like #d4d4d8.');
      }

      const created = await createProjectMutation.mutateAsync({
        organizationId,
        name: trimmedName,
        color: hexColor
      });

      setCreateButtonState('success');
      handleOpenChange(false);
      router.push(buildProjectPath({ projectId: created.id }));
    } catch (err) {
      setCreateButtonState('error');
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Create a project to organize tickets and tasks.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Project name"
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <ProjectColorSetter value={color} onSelect={setColor} />
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            buttonState={createButtonState}
            setButtonState={setCreateButtonState}
            text="Create project"
            loadingText="Creating…"
            successText="Created"
            errorText="Failed"
            onClick={handleCreate}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
