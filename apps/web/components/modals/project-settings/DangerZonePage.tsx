'use client';

import { Archive, Trash2 } from 'lucide-react';
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
import {
  useArchiveProjectMutation,
  useDeleteProjectMutation,
  useUnarchiveProjectMutation
} from '@/lib/client-data/projects/mutations';

type DangerZonePageProps = {
  projectId: string;
  projectName: string;
  isArchived?: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DangerZonePage({
  projectId,
  projectName,
  isArchived = false,
  onOpenChange
}: DangerZonePageProps) {
  const router = useRouter();
  const archiveProjectMutation = useArchiveProjectMutation();
  const unarchiveProjectMutation = useUnarchiveProjectMutation();
  const deleteProjectMutation = useDeleteProjectMutation();
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveState, setArchiveState] = useState<ButtonLoadingState>('default');
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [unarchiveState, setUnarchiveState] = useState<ButtonLoadingState>('default');
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<ButtonLoadingState>('default');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleArchiveProject() {
    setArchiveState('loading');
    setArchiveError(null);
    try {
      await archiveProjectMutation.mutateAsync({ projectId });
      setArchiveState('success');
      onOpenChange(false);
      router.push('/projects');
    } catch (error) {
      setArchiveState('error');
      setArchiveError(error instanceof Error ? error.message : 'Failed to archive project.');
    }
  }

  async function handleUnarchiveProject() {
    setUnarchiveState('loading');
    setUnarchiveError(null);
    try {
      await unarchiveProjectMutation.mutateAsync({ projectId });
      setUnarchiveState('success');
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      setUnarchiveState('error');
      setUnarchiveError(error instanceof Error ? error.message : 'Failed to unarchive project.');
    }
  }

  async function handleDeleteProject() {
    setDeleteState('loading');
    setDeleteError(null);
    try {
      await deleteProjectMutation.mutateAsync({ projectId });
      setDeleteState('success');
      onOpenChange(false);
      router.push('/projects');
    } catch (error) {
      setDeleteState('error');
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete project.');
    }
  }

  return (
    <>
      <div className="grid gap-6">
        {isArchived ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              This project is archived. Unarchive it to restore it to the sidebar and project
              selectors. Resources will need to be reconnected.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1.5"
              disabled={unarchiveState === 'loading'}
              onClick={handleUnarchiveProject}
            >
              <Archive className="h-3.5 w-3.5" />
              {unarchiveState === 'loading' ? 'Unarchiving…' : 'Unarchive project'}
            </Button>
            {unarchiveError ? <p className="text-xs text-destructive">{unarchiveError}</p> : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Archive this project to hide it from the sidebar and project selectors. Connected
              resources will be disconnected. Tickets are preserved and the project can be
              unarchived later.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1.5"
              onClick={() => setArchiveConfirmOpen(true)}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive project
            </Button>
            {archiveError ? <p className="text-xs text-destructive">{archiveError}</p> : null}
          </div>
        )}

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
      </div>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <strong>{projectName}</strong> and disconnect its resources. The
              project will be hidden from the sidebar and project selectors. Tickets will be
              preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveState === 'loading'}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={archiveState === 'loading'} onClick={handleArchiveProject}>
              {archiveState === 'loading' ? 'Archiving…' : 'Archive project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
