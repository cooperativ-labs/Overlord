'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { deleteProjectAction } from '@/lib/actions/projects';

type DangerZonePageProps = {
  projectId: string;
  projectName: string;
  onOpenChange: (open: boolean) => void;
};

export function DangerZonePage({ projectId, projectName, onOpenChange }: DangerZonePageProps) {
  const router = useRouter();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<ButtonLoadingState>('default');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteProject() {
    setDeleteState('loading');
    setDeleteError(null);
    try {
      await deleteProjectAction({ projectId });
      setDeleteState('success');
      onOpenChange(false);
      router.push('/projects');
      router.refresh();
    } catch (error) {
      setDeleteState('error');
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete project.');
    }
  }

  return (
    <>
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Permanently delete this project and all its tickets. This action cannot be undone.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete project
        </Button>
        {deleteError ? <p className="text-xs text-destructive">{deleteError}</p> : null}
      </div>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{projectName}</strong> and all its tickets. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteState === 'loading'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteState === 'loading'}
              onClick={handleDeleteProject}
            >
              {deleteState === 'loading' ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
