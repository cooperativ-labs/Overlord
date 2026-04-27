'use client';

import { Folder } from 'lucide-react';
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
import { useUpdateProjectWorkingDirectoryMutation } from '@/lib/client-data/projects/mutations';
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
  const updateWorkingDirectoryMutation = useUpdateProjectWorkingDirectoryMutation();
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

    let chosenPath: string | null;

    try {
      chosenPath = await api.terminal.chooseDirectory();
    } catch (pickerError) {
      setSelectFolderState('error');
      console.error('Failed to open directory picker', {
        projectId: project.id,
        projectName: project.name,
        pickerError
      });
      setError(
        pickerError instanceof Error
          ? `Could not open the directory picker: ${pickerError.message}`
          : 'Could not open the directory picker due to an unknown error.'
      );
      return;
    }

    if (!chosenPath) {
      setSelectFolderState('default');
      setError('No folder was selected. Choose a folder to continue.');
      return;
    }

    try {
      await updateWorkingDirectoryMutation.mutateAsync({
        projectId: project.id,
        workingDirectory: chosenPath
      });

      setSelectFolderState('success');
      onLinked?.(chosenPath);
      onOpenChange(false);
    } catch (updateError) {
      setSelectFolderState('error');
      console.error('Failed to save project working directory', {
        projectId: project.id,
        projectName: project.name,
        chosenPath,
        updateError
      });
      setError(
        updateError instanceof Error
          ? `Failed to link folder "${chosenPath}" to "${project.name}": ${updateError.message}`
          : `Failed to link folder "${chosenPath}" to "${project.name}" due to an unknown error.`
      );
    }
  }

  async function handleSkipDirectory() {
    if (!project) return;

    setSkipState('loading');
    setError(null);

    try {
      await updateWorkingDirectoryMutation.mutateAsync({
        projectId: project.id,
        workingDirectory: WORKING_DIRECTORY_NONE
      });

      setSkipState('success');
      onOpenChange(false);
    } catch (updateError) {
      setSkipState('error');
      setError(updateError instanceof Error ? updateError.message : 'Failed to save preference.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            variant="outline"

            errorText="Try again"
            loadingText="Saving…"
            setButtonState={setSkipState}
            successText="Saved"
            text="Don't use a directory"
            onClick={handleSkipDirectory}
          />


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

        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
