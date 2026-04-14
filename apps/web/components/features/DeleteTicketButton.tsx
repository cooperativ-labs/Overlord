'use client';

import { Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { deleteTicketAction } from '@/lib/actions/tickets';
import { dispatchTicketDeletedEvent } from '@/lib/helpers/ticket-board-events';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

type DeleteTicketButtonProps = {
  ticketId: string;
  ticketLabel?: string;
  variant?: 'icon' | 'default';
  className?: string;
};

export function DeleteTicketButton({ ticketId, ticketLabel, className }: DeleteTicketButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [deleteButtonState, setDeleteButtonState] = useState<ButtonLoadingState>('default');

  async function handleConfirm() {
    setDeleteButtonState('loading');
    try {
      const { projectId } = await deleteTicketAction(ticketId);
      dispatchTicketDeletedEvent(ticketId);
      setDeleteButtonState('success');
      setOpen(false);
      const segments = pathname.split('/').filter(Boolean);
      if (segments[0] === 'u') {
        router.push('/u');
      } else {
        router.push(buildProjectPath({ projectId }));
      }
      router.refresh();
    } catch {
      setDeleteButtonState('error');
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={'ghost'}
          size="icon"
          className={cn(
            className,
            'text-red-600 border-red-600/30 hover:text-white hover:bg-red-600 w-8 h-8'
          )}
          aria-label="Delete ticket"
          onClick={e => e.stopPropagation()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={e => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this task{ticketLabel ? ` (${ticketLabel})` : ''}. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={e => e.stopPropagation()}>Cancel</AlertDialogCancel>
          <LoadingButton
            buttonState={deleteButtonState}
            setButtonState={setDeleteButtonState}
            text="Delete"
            loadingText="Deleting…"
            errorText="Failed to delete"
            variant="destructive"
            onClick={() => handleConfirm()}
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
