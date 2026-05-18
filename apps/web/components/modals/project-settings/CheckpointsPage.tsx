'use client';

import { format } from 'date-fns';
import { GitCommit, HelpCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  deleteProjectCheckpointAction,
  listProjectCheckpointsAction,
  type ProjectCheckpoint,
  pruneStaleProjectCheckpointsAction
} from '@/lib/actions/checkpoints';

type CheckpointsPageProps = {
  open: boolean;
  projectId: string;
};

function isStale(checkpoint: ProjectCheckpoint): boolean {
  return checkpoint.objective_state === 'complete';
}

function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

export function CheckpointsPage({ open, projectId }: CheckpointsPageProps) {
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [pruneAllState, setPruneAllState] = useState<ButtonLoadingState>('default');
  const [pruneAllError, setPruneAllError] = useState<string | null>(null);

  const staleCount = checkpoints.filter(isStale).length;

  useEffect(() => {
    if (!open) {
      setError(null);
      setPruneAllError(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listProjectCheckpointsAction(projectId);
        if (!cancelled) setCheckpoints(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load checkpoints.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  async function handleDelete(id: string) {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await deleteProjectCheckpointAction(id);
      setCheckpoints(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete checkpoint.');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handlePruneAll() {
    setPruneAllState('loading');
    setPruneAllError(null);
    try {
      await pruneStaleProjectCheckpointsAction(projectId);
      const data = await listProjectCheckpointsAction(projectId);
      setCheckpoints(data);
      setPruneAllState('success');
    } catch (err) {
      setPruneAllState('error');
      setPruneAllError(err instanceof Error ? err.message : 'Failed to prune checkpoints.');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Checkpoints</p>
          <p className="text-xs text-muted-foreground">
            Checkpoints capture the git state at key moments during agent execution.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="What is a stale checkpoint?"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-sm" align="end">
              <p className="font-medium mb-1">Stale checkpoints</p>
              <p className="text-xs text-muted-foreground">
                A checkpoint is <strong>stale</strong> when its associated objective has been
                completed. These checkpoints no longer serve an active purpose and can be safely
                removed to keep the list tidy.
              </p>
            </PopoverContent>
          </Popover>
          <LoadingButton
            buttonState={staleCount === 0 ? 'disabled' : pruneAllState}
            setButtonState={setPruneAllState}
            text={`Prune stale${staleCount > 0 ? ` (${staleCount})` : ''}`}
            loadingText="Pruning…"
            successText="Pruned"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            onClick={handlePruneAll}
          />
        </div>
      </div>

      {pruneAllError ? <p className="text-xs text-destructive">{pruneAllError}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading checkpoints…</p>
      ) : checkpoints.length === 0 ? (
        <p className="text-xs text-muted-foreground">No checkpoints yet for this project.</p>
      ) : (
        <div className="max-h-[400px] overflow-y-auto rounded-md border">
          {/* Header */}
          <div className="grid grid-cols-[90px_1fr_80px_150px_40px] items-center gap-2 border-b bg-muted/50 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Commit</span>
            <span className="text-xs font-medium text-muted-foreground">Summary</span>
            <span className="text-xs font-medium text-muted-foreground">Kind</span>
            <span className="text-xs font-medium text-muted-foreground">Date</span>
            <span />
          </div>
          {/* Rows */}
          <div className="divide-y">
            {checkpoints.map(checkpoint => {
              const stale = isStale(checkpoint);
              const commit = shortSha(checkpoint.git_commit_id) ?? shortSha(checkpoint.head_sha);
              const label = checkpoint.summary ?? checkpoint.git_ref_name ?? null;
              return (
                <div
                  key={checkpoint.id}
                  className={`grid grid-cols-[90px_1fr_80px_150px_40px] items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/30 ${stale ? 'opacity-50' : ''}`}
                >
                  <span className="font-mono flex items-center gap-1 truncate">
                    {commit ? (
                      <>
                        <GitCommit className="h-3 w-3 shrink-0 text-muted-foreground" />
                        {commit}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                  <span className="truncate text-muted-foreground" title={label ?? undefined}>
                    {label ?? '—'}
                  </span>
                  <span className="capitalize text-muted-foreground">
                    {checkpoint.checkpoint_kind}
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {format(new Date(checkpoint.created_at), 'MMM d, yyyy HH:mm')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete checkpoint"
                    disabled={deletingIds.has(checkpoint.id)}
                    onClick={() => handleDelete(checkpoint.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
