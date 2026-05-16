'use client';

import { History, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { cn } from '@/lib/utils';

type SafetyRef = {
  ref: string;
  gitCommitId: string;
  createdAt: string | null;
};

type SafetySnapshotsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
};

export function SafetySnapshotsDialog({
  open,
  onOpenChange,
  workingDirectory
}: SafetySnapshotsDialogProps) {
  const [refs, setRefs] = useState<SafetyRef[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoreState, setRestoreState] = useState<ButtonLoadingState>('default');

  const loadRefs = useCallback(async () => {
    const api = window.electronAPI?.filesystem?.listSafetyRefs;
    if (!api) {
      setListError('Safety snapshots are only available in the Overlord desktop app.');
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const result = await api({ directory: workingDirectory });
      if (!result.ok) {
        setListError(result.error ?? 'Failed to list safety snapshots.');
        setRefs([]);
        return;
      }
      setRefs(result.refs);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Failed to list safety snapshots.');
    } finally {
      setListLoading(false);
    }
  }, [workingDirectory]);

  useEffect(() => {
    if (!open) return;
    setSelectedRef(null);
    setDiff('');
    setDiffError(null);
    setRestoreState('default');
    void loadRefs();
  }, [open, loadRefs]);

  const handleSelect = useCallback(
    async (ref: string) => {
      setSelectedRef(ref);
      setRestoreState('default');
      const api = window.electronAPI?.filesystem?.diffCheckpoint;
      if (!api) {
        setDiffError('Diff is only available in the Overlord desktop app.');
        return;
      }
      const target = refs.find(r => r.ref === ref);
      if (!target) return;
      setDiffLoading(true);
      setDiffError(null);
      setDiff('');
      try {
        const result = await api({ directory: workingDirectory, gitCommitId: target.gitCommitId });
        if (!result.ok) {
          setDiffError(result.error ?? 'Failed to load snapshot diff.');
          return;
        }
        setDiff(result.diff || 'No diff between this safety snapshot and HEAD.');
      } catch (error) {
        setDiffError(error instanceof Error ? error.message : 'Failed to load snapshot diff.');
      } finally {
        setDiffLoading(false);
      }
    },
    [refs, workingDirectory]
  );

  const handleRestore = useCallback(async () => {
    if (!selectedRef) return;
    const api = window.electronAPI?.filesystem?.restoreSafetyRef;
    if (!api) {
      setDiffError('Restore is only available in the Overlord desktop app.');
      return;
    }
    setRestoreState('loading');
    try {
      const result = await api({ directory: workingDirectory, ref: selectedRef });
      if (!result.ok) {
        setRestoreState('error');
        setDiffError(result.error ?? 'Failed to restore safety snapshot.');
        return;
      }
      setRestoreState('success');
      void loadRefs();
    } catch (error) {
      setRestoreState('error');
      setDiffError(error instanceof Error ? error.message : 'Failed to restore safety snapshot.');
    }
  }, [selectedRef, workingDirectory, loadRefs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[82vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Recovery Snapshots
          </DialogTitle>
          <DialogDescription>
            Every revert captures a safety snapshot of the working tree first. Use this list to
            inspect and restore any prior state.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-3">
          <div className="min-h-0 overflow-auto rounded-md border">
            {listLoading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : listError ? (
              <p className="p-3 text-sm text-destructive">{listError}</p>
            ) : refs.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No safety snapshots recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {refs.map(item => (
                  <li key={item.ref}>
                    <button
                      type="button"
                      className={cn(
                        'block w-full px-3 py-2 text-left text-xs hover:bg-muted/50',
                        selectedRef === item.ref ? 'bg-muted/70' : ''
                      )}
                      onClick={() => void handleSelect(item.ref)}
                    >
                      <p className="font-medium">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString()
                          : 'Unknown timestamp'}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                        {item.gitCommitId.slice(0, 12)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-h-0 overflow-auto rounded-md border bg-muted/30">
            {!selectedRef ? (
              <p className="p-3 text-sm text-muted-foreground">
                Select a snapshot to preview its diff against HEAD.
              </p>
            ) : diffLoading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading diff...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-5">
                {diffError ?? diff}
              </pre>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <LoadingButton
            buttonState={restoreState}
            setButtonState={setRestoreState}
            text={
              <span className="inline-flex items-center gap-1">
                <RotateCcw className="h-3.5 w-3.5" /> Restore selected
              </span>
            }
            loadingText="Restoring..."
            successText="Restored"
            errorText="Restore failed"
            variant="destructive"
            disabled={!selectedRef || diffLoading || Boolean(diffError)}
            onClick={handleRestore}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
