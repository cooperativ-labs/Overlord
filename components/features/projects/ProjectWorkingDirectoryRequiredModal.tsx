'use client';

import { Folder } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from '@/components/ui/dialog';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { updateProjectWorkingDirectoryAction } from '@/lib/actions/projects';
import { WORKING_DIRECTORY_NONE } from '@/lib/helpers/project-working-directory';

type ProjectWorkingDirectoryRequiredModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: {
    id: string;
    name: string;
  } | null;
  onLinked?: (directory: string) => void;
};

export function ProjectWorkingDirectoryRequiredModal({
  open,
  onOpenChange,
  project,
  onLinked
}: ProjectWorkingDirectoryRequiredModalProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const [selectFolderState, setSelectFolderState] = useState<ButtonLoadingState>('default');
  const [skipState, setSkipState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectFolderState('default');
    setSkipState('default');
    setError(null);
  }, [open, project?.id]);

  async function handleSelectFolder() {
    if (!project || !isElectron || !api?.terminal?.chooseDirectory) {
      return;
    }

    setSelectFolderState('loading');
    setError(null);

    try {
      const chosenPath = await api.terminal.chooseDirectory();
      if (!chosenPath) {
        setSelectFolderState('default');
        return;
      }

      await updateProjectWorkingDirectoryAction({
        projectId: project.id,
        workingDirectory: chosenPath
      });

      setSelectFolderState('success');
      onLinked?.(chosenPath);
      onOpenChange(false);
      router.refresh();
    } catch (updateError) {
      setSelectFolderState('error');
      setError(
        updateError instanceof Error ? updateError.message : 'Failed to save the project folder.'
      );
    }
  }

  async function handleSkipDirectory() {
    if (!project) return;

    setSkipState('loading');
    setError(null);

    try {
      await updateProjectWorkingDirectoryAction({
        projectId: project.id,
        workingDirectory: WORKING_DIRECTORY_NONE
      });

      setSkipState('success');
      onOpenChange(false);
      router.refresh();
    } catch (updateError) {
      setSkipState('error');
      setError(updateError instanceof Error ? updateError.message : 'Failed to save preference.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Select a project folder</DialogTitle>
        <DialogDescription className="space-y-2">
          <span className="block">
            <strong>{project?.name ?? 'This project'}</strong> does not have a linked working
            directory yet.
          </span>
          <span className="block">
            Overlord uses this folder to run local agent commands, read files, and include the right
            project context.
          </span>
        </DialogDescription>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <LoadingButton
            buttonState={skipState}
            variant="ghost"
            className="text-muted-foreground"
            errorText="Try again"
            loadingText="Saving…"
            setButtonState={setSkipState}
            successText="Saved"
            text="Don't use a directory"
            onClick={handleSkipDirectory}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <LoadingButton
              buttonState={selectFolderState}
              className="gap-1.5"
              errorText="Try again"
              loadingText="Opening picker..."
              setButtonState={setSelectFolderState}
              successText="Folder linked"
              text={
                <span className="inline-flex items-center gap-1.5">
                  <Folder className="h-4 w-4" />
                  Select Folder
                </span>
              }
              onClick={handleSelectFolder}
            />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
