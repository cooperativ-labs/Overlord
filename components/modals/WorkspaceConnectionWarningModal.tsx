'use client';

import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from '@/components/ui/dialog';

type WorkspaceConnectionWarningModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceType: 'local' | 'ssh';
  path: string;
  error?: string | null;
  onOpenSettings?: () => void;
};

export function WorkspaceConnectionWarningModal({
  open,
  onOpenChange,
  workspaceType,
  path,
  error,
  onOpenSettings
}: WorkspaceConnectionWarningModalProps) {
  const typeLabel = workspaceType === 'ssh' ? 'SSH remote' : 'Local';
  const suggestion =
    workspaceType === 'ssh'
      ? 'Verify that the SSH host is reachable and the remote directory exists.'
      : 'Verify that the directory exists on this machine.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold">
              {typeLabel} workspace unreachable
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              The selected workspace could not be reached. Agents launched from this project may
              fail.
            </DialogDescription>
          </div>
        </div>

        <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground">{path}</p>
          {error ? <p className="mt-1 text-muted-foreground">{error}</p> : null}
        </div>

        <p className="text-xs text-muted-foreground">{suggestion}</p>

        <DialogFooter className="gap-2 sm:gap-0">
          {onOpenSettings ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenSettings();
                onOpenChange(false);
              }}
            >
              Open project settings
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
