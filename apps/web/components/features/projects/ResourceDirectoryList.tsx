'use client';

import { Check, Folder, FolderOpen, Pencil, Star, StarOff, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  addProjectResourceDirectoryAction,
  getProjectResourceDirectoriesAction,
  type ProjectResourceDirectory,
  removeProjectResourceDirectoryAction,
  setResourceDirectoryPrimaryAction,
  updateResourceDirectoryLabelAction
} from '@/lib/actions/resource-directories';
import { defaultDirectoryLabel } from '@/lib/resource-directories/labels';

type Props = {
  projectId: string;
  /** When directories change (e.g. added from this UI), parent can refetch related data (e.g. device list). */
  onResourceDirectoriesChanged?: () => void;
};

export function ResourceDirectoryList({ projectId, onResourceDirectoriesChanged }: Props) {
  const { api, isElectron } = useElectron();
  const canManageDirectories = isElectron;
  const [items, setItems] = useState<ProjectResourceDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [editingDirectoryId, setEditingDirectoryId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [savingDirectoryId, setSavingDirectoryId] = useState<string | null>(null);
  const labelManuallyEditedRef = useRef(false);
  const [, startTransition] = useTransition();

  function applyDefaultLabelForPath(path: string) {
    if (labelManuallyEditedRef.current) return;
    const label = defaultDirectoryLabel({
      directoryPath: path,
      existingLabels: items.map(item => item.label)
    });
    setNewLabel(label ?? '');
  }

  function handlePathChange(path: string) {
    setNewPath(path);
    applyDefaultLabelForPath(path);
  }

  async function refresh() {
    setLoading(true);
    try {
      const { resources } = await getProjectResourceDirectoriesAction({ projectId });
      setItems(resources);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleBrowseDirectory() {
    if (!isElectron || !api?.terminal?.chooseDirectory) return;

    setBrowsing(true);
    try {
      const chosenPath = await api.terminal.chooseDirectory();
      if (chosenPath) handlePathChange(chosenPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the directory picker.');
    } finally {
      setBrowsing(false);
    }
  }

  async function handleAdd() {
    if (!canManageDirectories) return;

    const trimmed = newPath.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const isFirst = items.length === 0;
      let deviceFromElectron:
        | { deviceFingerprint: string; deviceHostname: string; devicePlatform: string }
        | undefined;
      if (isElectron && api?.app?.getDeviceIdentity) {
        try {
          const identity = await api.app.getDeviceIdentity();
          deviceFromElectron = {
            deviceFingerprint: identity.deviceFingerprint,
            deviceHostname: identity.hostname,
            devicePlatform: identity.platform
          };
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Could not read this computer’s device id.'
          );
          return;
        }
      }
      const { projectName } = await addProjectResourceDirectoryAction({
        projectId,
        directoryPath: trimmed,
        label: newLabel.trim() || null,
        isPrimary: isFirst,
        ...(deviceFromElectron
          ? {
              deviceFingerprint: deviceFromElectron.deviceFingerprint,
              deviceHostname: deviceFromElectron.deviceHostname,
              devicePlatform: deviceFromElectron.devicePlatform
            }
          : {})
      });
      if (isElectron && api?.filesystem?.writeOverlordConfig) {
        const result = await api.filesystem.writeOverlordConfig({
          directory: trimmed,
          projectId,
          projectName
        });
        if (!result.ok) {
          toast.warning(`Added directory, but could not write overlord.json: ${result.error}`);
        }
      }
      setNewPath('');
      setNewLabel('');
      labelManuallyEditedRef.current = false;
      await refresh();
      onResourceDirectoriesChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add directory.');
    } finally {
      setAdding(false);
    }
  }

  function handleRemove(directoryId: string) {
    if (!canManageDirectories) return;

    const removed = items.find(item => item.id === directoryId);

    startTransition(async () => {
      try {
        await removeProjectResourceDirectoryAction({ directoryId, projectId });
        if (removed && isElectron && api?.filesystem?.removeOverlordConfigProject) {
          const result = await api.filesystem.removeOverlordConfigProject({
            directory: removed.directoryPath,
            projectId
          });
          if (!result.ok) {
            toast.warning(`Removed directory, but could not update overlord.json: ${result.error}`);
          }
        }
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to remove directory.');
      }
    });
  }

  function handleSetPrimary(directoryId: string) {
    if (!canManageDirectories) return;

    startTransition(async () => {
      try {
        await setResourceDirectoryPrimaryAction({ directoryId, projectId });
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to set primary directory.');
      }
    });
  }

  function handleStartEditLabel(item: ProjectResourceDirectory) {
    setEditingDirectoryId(item.id);
    setEditingLabel(item.label ?? '');
  }

  function handleCancelEditLabel() {
    setEditingDirectoryId(null);
    setEditingLabel('');
  }

  async function handleRevealInFinder(directoryPath: string) {
    if (!api?.app?.revealFile) return;

    try {
      await api.app.revealFile(directoryPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open in Finder.');
    }
  }

  async function handleSaveLabel(directoryId: string) {
    if (!canManageDirectories) return;

    const next = editingLabel.trim();
    setSavingDirectoryId(directoryId);
    try {
      await updateResourceDirectoryLabelAction({
        directoryId,
        projectId,
        label: next || null
      });
      setItems(prev =>
        prev.map(item => (item.id === directoryId ? { ...item, label: next || null } : item))
      );
      setEditingDirectoryId(null);
      setEditingLabel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update directory label.');
    } finally {
      setSavingDirectoryId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Resource directories</h3>

        <p className="text-xs text-muted-foreground">
          Per-device working directories for this project. Agent flows match the running cwd against
          this list to resolve the project.
        </p>
      </div>

      <div className="grid gap-1">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">No directories configured yet.</p>
        ) : (
          items.map(item => {
            const isEditingLabel = editingDirectoryId === item.id;
            const isSavingLabel = savingDirectoryId === item.id;
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {isEditingLabel ? (
                    <Input
                      value={editingLabel}
                      onChange={event => setEditingLabel(event.target.value)}
                      placeholder="Label (optional)"
                      className="h-7 text-xs"
                      disabled={isSavingLabel}
                      autoFocus
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleSaveLabel(item.id);
                        }
                        if (event.key === 'Escape') {
                          handleCancelEditLabel();
                        }
                      }}
                    />
                  ) : (
                    <div className="min-w-0">
                      {item.label ? (
                        <div className="break-all font-medium" title={item.label}>
                          {item.label}
                        </div>
                      ) : null}
                      <div
                        className={`break-all ${item.label ? 'text-muted-foreground' : ''}`}
                        title={item.directoryPath}
                      >
                        {item.directoryPath}
                      </div>
                    </div>
                  )}
                </div>
                {!isEditingLabel && item.deviceLabel ? (
                  <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item.deviceLabel}
                  </span>
                ) : null}
                {canManageDirectories ? (
                  <>
                    {isEditingLabel ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void handleSaveLabel(item.id)}
                          disabled={isSavingLabel}
                          title="Save label"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={handleCancelEditLabel}
                          disabled={isSavingLabel}
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {isElectron && api?.app?.revealFile ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground"
                            onClick={() => void handleRevealInFinder(item.directoryPath)}
                            title="See in finder"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => handleStartEditLabel(item)}
                          title={item.label ? 'Edit label' : 'Add label'}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
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
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canManageDirectories ? (
        <div className="grid gap-2 mt-4">
          <h3 className="text-sm font-medium">Add a new resource directory</h3>
          <Input
            value={newLabel}
            onChange={event => {
              labelManuallyEditedRef.current = true;
              setNewLabel(event.target.value);
            }}
            placeholder="Label (optional)"
            className="h-8 text-xs"
          />
          <div className="flex items-center gap-2">
            <Input
              value={newPath}
              onChange={event => handlePathChange(event.target.value)}
              placeholder="/absolute/path/to/project"
              className="h-8 min-w-0 flex-1 text-xs"
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleAdd();
                }
              }}
            />
            {isElectron ? (
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                onClick={() => void handleBrowseDirectory()}
                disabled={browsing || adding}
                title="Browse for folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
            ) : null}
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
      ) : (
        <p className="text-xs text-muted-foreground">
          Open the Overlord desktop app to add, edit, or remove resource directories.
        </p>
      )}
    </div>
  );
}
