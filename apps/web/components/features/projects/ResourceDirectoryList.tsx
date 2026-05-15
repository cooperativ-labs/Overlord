'use client';

import { Folder, Star, StarOff, Trash2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  addProjectResourceDirectoryAction,
  getProjectResourceDirectoriesAction,
  type ProjectResourceDirectory,
  removeProjectResourceDirectoryAction,
  setResourceDirectoryPrimaryAction
} from '@/lib/actions/resource-directories';

type Props = {
  projectId: string;
};

export function ResourceDirectoryList({ projectId }: Props) {
  const [items, setItems] = useState<ProjectResourceDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPath, setNewPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    try {
      const data = await getProjectResourceDirectoriesAction(projectId);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleAdd() {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const isFirst = items.length === 0;
      await addProjectResourceDirectoryAction({
        projectId,
        directoryPath: trimmed,
        isPrimary: isFirst
      });
      setNewPath('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add directory.');
    } finally {
      setAdding(false);
    }
  }

  function handleRemove(directoryId: string) {
    startTransition(async () => {
      try {
        await removeProjectResourceDirectoryAction({ directoryId, projectId });
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to remove directory.');
      }
    });
  }

  function handleSetPrimary(directoryId: string) {
    startTransition(async () => {
      try {
        await setResourceDirectoryPrimaryAction({ directoryId, projectId });
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to set primary directory.');
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <label className="text-xs font-medium text-muted-foreground">Resource directories</label>
        <p className="text-xs text-muted-foreground">
          Per-device working directories for this project. Agent flows match the running
          cwd against this list to resolve the project.
        </p>
      </div>

      <div className="grid gap-1">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">No directories configured yet.</p>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1" title={item.directoryPath}>
                {item.directoryPath}
              </span>
              {item.deviceLabel ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {item.deviceLabel}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title={item.isPrimary ? 'Primary directory' : 'Set as primary'}
                onClick={() => (item.isPrimary ? undefined : handleSetPrimary(item.id))}
              >
                {item.isPrimary ? (
                  <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
                ) : (
                  <StarOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(item.id)}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newPath}
          onChange={event => setNewPath(event.target.value)}
          placeholder="/absolute/path/to/project"
          className="h-8 text-xs"
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleAdd();
            }
          }}
        />
        <LoadingButton
          type="button"
          size="sm"
          buttonState={adding ? 'loading' : 'default'}
          text="Add"
          onClick={() => void handleAdd()}
          disabled={!newPath.trim()}
        />
      </div>
    </div>
  );
}
