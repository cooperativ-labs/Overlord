'use client';

import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Laptop,
  Monitor,
  Pencil,
  Star,
  StarOff,
  Trash2,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { TruncatedPath } from '@/components/ui/truncated-path';
import {
  deleteOrganizationExecutionTargetAction,
  getProjectDevicesAction,
  getUserDevicesAction,
  type ProjectDevice,
  type ProjectDeviceResource,
  updateDeviceLabelAction,
  type UserDevice
} from '@/lib/actions/devices';
import {
  addProjectResourceDirectoryAction,
  getUserExecutionTargetsAction,
  removeProjectResourceDirectoryAction,
  setResourceDirectoryPrimaryAction,
  updateResourceDirectoryLabelAction,
  type UserExecutionTarget
} from '@/lib/actions/resource-directories';
import { defaultDirectoryLabel } from '@/lib/resource-directories/labels';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  projectId: string;
};

export function DeviceResourceList({ open, projectId }: Props) {
  const { api, isElectron } = useElectron();
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [projectDevices, setProjectDevices] = useState<ProjectDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingDeviceLabel, setEditingDeviceLabel] = useState('');
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());

  // Resource editing state
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [editingResourceLabel, setEditingResourceLabel] = useState('');
  const [savingResourceId, setSavingResourceId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Add new resource directory state
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [executionTargets, setExecutionTargets] = useState<UserExecutionTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const labelManuallyEditedRef = useRef(false);

  const allResourceLabels = projectDevices.flatMap(d => d.resources.map(r => r.label));

  const refreshAll = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading !== false;
      if (showLoading) setLoadingDevices(true);
      try {
        const [allDevices, projectDevPayload] = await Promise.all([
          getUserDevicesAction(),
          getProjectDevicesAction({ projectId })
        ]);
        setDevices(allDevices);
        setProjectDevices(projectDevPayload.devices);
      } finally {
        if (showLoading) setLoadingDevices(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!open) return;
    void refreshAll({ showLoading: true });
  }, [open, refreshAll]);

  useEffect(() => {
    if (isElectron) return;
    void getUserExecutionTargetsAction().then(targets => {
      setExecutionTargets(targets);
      if (targets.length === 1) setSelectedTargetId(targets[0].id);
    });
  }, [isElectron]);

  // Device actions

  function toggleExpanded(deviceId: string) {
    setExpandedDeviceIds(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }

  function handleStartEditDevice(device: UserDevice) {
    setEditingDeviceId(device.id);
    setEditingDeviceLabel(device.label);
  }

  function handleCancelEditDevice() {
    setEditingDeviceId(null);
    setEditingDeviceLabel('');
  }

  async function handleSaveDeviceLabel(deviceId: string) {
    const next = editingDeviceLabel.trim();
    if (!next) return;
    setSavingDeviceId(deviceId);
    try {
      await updateDeviceLabelAction({ deviceId, label: next });
      setDevices(prev =>
        prev.map(device => (device.id === deviceId ? { ...device, label: next } : device))
      );
      setProjectDevices(prev =>
        prev.map(device => (device.id === deviceId ? { ...device, label: next } : device))
      );
      setEditingDeviceId(null);
      setEditingDeviceLabel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update device label.');
    } finally {
      setSavingDeviceId(null);
    }
  }

  async function handleDeleteDevice(device: UserDevice) {
    if (!device.organizationId) return;
    setDeletingDeviceId(device.id);
    setConfirmDeleteId(null);
    try {
      await deleteOrganizationExecutionTargetAction({
        organizationId: device.organizationId,
        executionTargetId: device.id
      });
      setDevices(prev => prev.filter(d => d.id !== device.id));
      toast.success(`"${device.label}" removed from organization.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove execution target.');
    } finally {
      setDeletingDeviceId(null);
    }
  }

  // Resource actions

  function handleStartEditResource(resource: ProjectDeviceResource) {
    setEditingResourceId(resource.id);
    setEditingResourceLabel(resource.label ?? '');
  }

  function handleCancelEditResource() {
    setEditingResourceId(null);
    setEditingResourceLabel('');
  }

  async function handleSaveResourceLabel(resourceId: string) {
    const next = editingResourceLabel.trim();
    setSavingResourceId(resourceId);
    try {
      await updateResourceDirectoryLabelAction({
        directoryId: resourceId,
        projectId,
        label: next || null
      });
      setProjectDevices(prev =>
        prev.map(device => ({
          ...device,
          resources: device.resources.map(r =>
            r.id === resourceId ? { ...r, label: next || null } : r
          )
        }))
      );
      setEditingResourceId(null);
      setEditingResourceLabel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update directory label.');
    } finally {
      setSavingResourceId(null);
    }
  }

  function handleSetPrimary(resourceId: string) {
    startTransition(async () => {
      try {
        await setResourceDirectoryPrimaryAction({ directoryId: resourceId, projectId });
        await refreshAll({ showLoading: false });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to set primary directory.');
      }
    });
  }

  function handleRemoveResource(resourceId: string) {
    startTransition(async () => {
      try {
        const removed = projectDevices.flatMap(d => d.resources).find(r => r.id === resourceId);
        await removeProjectResourceDirectoryAction({ directoryId: resourceId, projectId });
        if (removed && isElectron && api?.filesystem?.removeOverlordConfigProject) {
          const result = await api.filesystem.removeOverlordConfigProject({
            directory: removed.directoryPath,
            projectId
          });
          if (!result.ok) {
            toast.warning(
              `Removed directory, but could not update .overlord/project.json: ${result.error}`
            );
          }
        }
        await refreshAll({ showLoading: false });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to remove directory.');
      }
    });
  }

  async function handleRevealInFinder(directoryPath: string) {
    if (!api?.app?.revealFile) return;
    try {
      await api.app.revealFile(directoryPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open in Finder.');
    }
  }

  // Add new directory

  function applyDefaultLabelForPath(path: string) {
    if (labelManuallyEditedRef.current) return;
    const label = defaultDirectoryLabel({
      directoryPath: path,
      existingLabels: allResourceLabels
    });
    setNewLabel(label ?? '');
  }

  function handlePathChange(path: string) {
    setNewPath(path);
    applyDefaultLabelForPath(path);
  }

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
    const trimmed = newPath.trim();
    if (!trimmed) return;

    setAdding(true);
    try {
      if (isElectron) {
        let deviceFromElectron:
          | { deviceFingerprint: string; deviceHostname: string; devicePlatform: string }
          | undefined;
        if (api?.app?.getDeviceIdentity) {
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
          ...(deviceFromElectron
            ? {
                deviceFingerprint: deviceFromElectron.deviceFingerprint,
                deviceHostname: deviceFromElectron.deviceHostname,
                devicePlatform: deviceFromElectron.devicePlatform
              }
            : {})
        });
        if (api?.filesystem?.writeOverlordConfig) {
          const result = await api.filesystem.writeOverlordConfig({
            directory: trimmed,
            projectId,
            projectName
          });
          if (!result.ok) {
            toast.warning(
              `Added directory, but could not write .overlord/project.json: ${result.error}`
            );
          }
        }
      } else {
        if (!selectedTargetId) {
          toast.error('Select a registered machine before adding a directory.');
          return;
        }
        await addProjectResourceDirectoryAction({
          projectId,
          directoryPath: trimmed,
          label: newLabel.trim() || null,
          deviceId: selectedTargetId
        });
      }

      setNewPath('');
      setNewLabel('');
      labelManuallyEditedRef.current = false;
      await refreshAll({ showLoading: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add directory.');
    } finally {
      setAdding(false);
    }
  }

  // Computed

  const projectDeviceIds = new Set(projectDevices.map(d => d.id));
  const projectDeviceMap = new Map(projectDevices.map(d => [d.id, d]));

  const devicesWithProjectInfo = devices.map(device => ({
    device,
    projectDevice: projectDeviceMap.get(device.id) ?? null,
    hasResources: projectDeviceIds.has(device.id)
  }));

  const devicesInProject = devicesWithProjectInfo.filter(d => d.hasResources);
  const devicesNotInProject = devicesWithProjectInfo.filter(d => !d.hasResources);

  const selectedTarget = executionTargets.find(t => t.id === selectedTargetId);
  const canAddInBrowser = !isElectron && executionTargets.length > 0;
  const canAdd = isElectron || canAddInBrowser;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Devices &amp; resources</h3>
        <p className="text-xs text-muted-foreground">
          Devices associated with this project and their resource directories. Each device can have
          multiple working directories; the primary one is used for execution.
        </p>
      </div>

      {loadingDevices ? (
        <p className="text-xs text-muted-foreground">Loading devices…</p>
      ) : devicesInProject.length === 0 && devicesNotInProject.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No devices registered yet. Connect a device via Overlord Desktop or the{' '}
          <code className="rounded bg-muted px-1">ovld</code> CLI.
        </p>
      ) : (
        <div className="grid gap-2">
          {devicesInProject.map(({ device, projectDevice }) => {
            const isEditing = editingDeviceId === device.id;
            const isSaving = savingDeviceId === device.id;
            const isDeleting = deletingDeviceId === device.id;
            const isConfirming = confirmDeleteId === device.id;
            const isBusy = isSaving || isDeleting;
            const resources = projectDevice?.resources ?? [];
            const primaryResource = resources.find(r => r.isPrimary);
            const isExpanded = expandedDeviceIds.has(device.id);

            return (
              <div key={device.id} className="rounded-md border">
                <div className="flex items-center gap-2 px-2.5 py-2 text-xs">
                  <button
                    type="button"
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => toggleExpanded(device.id)}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <ChevronRight
                      className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                    />
                  </button>
                  <Laptop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <Input
                        value={editingDeviceLabel}
                        onChange={event => setEditingDeviceLabel(event.target.value)}
                        className="h-7 text-xs"
                        placeholder="e.g. my-raspberry-pi"
                        disabled={isSaving}
                        autoFocus
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSaveDeviceLabel(device.id);
                          }
                          if (event.key === 'Escape') {
                            handleCancelEditDevice();
                          }
                        }}
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{device.label}</span>
                        {device.hostname && device.hostname !== device.label ? (
                          <span className="text-muted-foreground">· {device.hostname}</span>
                        ) : null}
                        {device.platform ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {device.platform}
                          </span>
                        ) : null}
                        {primaryResource ? (
                          <span className="text-muted-foreground">
                            · {primaryResource.label ?? primaryResource.directoryPath}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {resources.length} resource{resources.length !== 1 ? 's' : ''}
                  </span>

                  {isEditing ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => void handleSaveDeviceLabel(device.id)}
                        disabled={isSaving || !editingDeviceLabel.trim()}
                        title="Save"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={handleCancelEditDevice}
                        disabled={isSaving}
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => handleStartEditDevice(device)}
                        disabled={isBusy}
                        title="Rename device"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>

                      {device.isAdmin && device.organizationId ? (
                        isConfirming ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              Remove?
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              onClick={() => void handleDeleteDevice(device)}
                              disabled={isDeleting}
                              title="Confirm removal"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isDeleting}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmDeleteId(device.id)}
                            disabled={isBusy}
                            title="Remove from organization"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )
                      ) : null}
                    </>
                  )}
                </div>

                {isExpanded && resources.length > 0 ? (
                  <div className="border-t bg-muted/30 px-2.5 py-1.5">
                    {resources.map(resource => {
                      const isEditingRes = editingResourceId === resource.id;
                      const isSavingRes = savingResourceId === resource.id;
                      return (
                        <div key={resource.id} className="flex items-center gap-2 py-1.5 text-xs">
                          <Folder className="ml-5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            {isEditingRes ? (
                              <Input
                                value={editingResourceLabel}
                                onChange={event => setEditingResourceLabel(event.target.value)}
                                placeholder="Label (optional)"
                                className="h-7 text-xs"
                                disabled={isSavingRes}
                                autoFocus
                                onKeyDown={event => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void handleSaveResourceLabel(resource.id);
                                  }
                                  if (event.key === 'Escape') {
                                    handleCancelEditResource();
                                  }
                                }}
                              />
                            ) : (
                              <div className="min-w-0">
                                {resource.label ? (
                                  <span className="font-medium">{resource.label}</span>
                                ) : null}
                                <TruncatedPath
                                  path={resource.directoryPath}
                                  className={cn(
                                    'font-mono text-[11px]',
                                    resource.label ? 'text-muted-foreground' : 'text-foreground'
                                  )}
                                />
                              </div>
                            )}
                          </div>
                          {isEditingRes ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => void handleSaveResourceLabel(resource.id)}
                                disabled={isSavingRes}
                                title="Save label"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={handleCancelEditResource}
                                disabled={isSavingRes}
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
                                  onClick={() => void handleRevealInFinder(resource.directoryPath)}
                                  title="See in Finder"
                                >
                                  <FolderOpen className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground"
                                onClick={() => handleStartEditResource(resource)}
                                title={resource.label ? 'Edit label' : 'Add label'}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title={resource.isPrimary ? 'Primary directory' : 'Set as primary'}
                                onClick={() =>
                                  resource.isPrimary ? undefined : handleSetPrimary(resource.id)
                                }
                              >
                                {resource.isPrimary ? (
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
                                onClick={() => handleRemoveResource(resource.id)}
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {isExpanded && resources.length === 0 ? (
                  <div className="border-t bg-muted/30 px-2.5 py-2">
                    <p className="ml-5 text-xs italic text-muted-foreground">
                      No resource directories on this device.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}

          {devicesNotInProject.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1.5">
                Other devices (no resources for this project):
              </p>
              <div className="grid gap-1.5">
                {devicesNotInProject.map(({ device }) => {
                  const isEditing = editingDeviceId === device.id;
                  const isSaving = savingDeviceId === device.id;
                  const isDeleting = deletingDeviceId === device.id;
                  const isConfirming = confirmDeleteId === device.id;
                  const isBusy = isSaving || isDeleting;

                  return (
                    <div
                      key={device.id}
                      className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs"
                    >
                      <Laptop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <Input
                            value={editingDeviceLabel}
                            onChange={event => setEditingDeviceLabel(event.target.value)}
                            className="h-7 text-xs"
                            placeholder="e.g. my-raspberry-pi"
                            disabled={isSaving}
                            autoFocus
                            onKeyDown={event => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleSaveDeviceLabel(device.id);
                              }
                              if (event.key === 'Escape') {
                                handleCancelEditDevice();
                              }
                            }}
                          />
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-muted-foreground">
                              {device.label}
                            </span>
                            {device.hostname && device.hostname !== device.label ? (
                              <span className="text-muted-foreground">· {device.hostname}</span>
                            ) : null}
                            {device.platform ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                {device.platform}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => void handleSaveDeviceLabel(device.id)}
                            disabled={isSaving || !editingDeviceLabel.trim()}
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={handleCancelEditDevice}
                            disabled={isSaving}
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground"
                            onClick={() => handleStartEditDevice(device)}
                            disabled={isBusy}
                            title="Rename device"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>

                          {device.isAdmin && device.organizationId ? (
                            isConfirming ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  Remove?
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                  onClick={() => void handleDeleteDevice(device)}
                                  disabled={isDeleting}
                                  title="Confirm removal"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={isDeleting}
                                  title="Cancel"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => setConfirmDeleteId(device.id)}
                                disabled={isBusy}
                                title="Remove from organization"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {canAdd ? (
        <div className="grid gap-2 mt-4">
          <h4 className="text-xs font-medium">Add a new resource directory</h4>

          {!isElectron && executionTargets.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-[11px] text-muted-foreground">
                Select the registered machine this path belongs to.
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {selectedTarget ? selectedTarget.label : 'Select a machine…'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {executionTargets.map(target => (
                    <DropdownMenuItem
                      key={target.id}
                      className="gap-2 text-xs"
                      onClick={() => setSelectedTargetId(target.id)}
                    >
                      <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{target.label}</div>
                        {target.hostname ? (
                          <div className="truncate text-[10px] text-muted-foreground">
                            {target.hostname}
                          </div>
                        ) : null}
                      </div>
                      {target.id === selectedTargetId ? (
                        <Check className="ml-auto h-3 w-3 shrink-0" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

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
              disabled={!newPath.trim() || (!isElectron && !selectedTargetId)}
            />
          </div>
        </div>
      ) : !isElectron && executionTargets.length === 0 && !loadingDevices ? (
        <p className="text-xs text-muted-foreground">
          No registered machines found. Install and run the Overlord CLI (<code>ovld</code>) on a
          machine first, then you can add its resource directories here.
        </p>
      ) : null}
    </div>
  );
}
