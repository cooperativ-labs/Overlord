'use client';

import { Check, ChevronRight, Folder, Laptop, Pencil, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ResourceDirectoryList } from '@/components/features/projects/ResourceDirectoryList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteOrganizationExecutionTargetAction,
  getProjectDevicesAction,
  getUserDevicesAction,
  type ProjectDevice,
  updateDeviceLabelAction,
  type UserDevice
} from '@/lib/actions/devices';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import { cn } from '@/lib/utils';

import { SshWorkspaceSection } from './SshWorkspaceSection';

type ResourcesPageProps = {
  open: boolean;
  projectId: string;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
  initialRemoteWorkingDirectory: string | null;
  sshFeatureEnabled: boolean;
};

export function ResourcesPage({
  open,
  projectId,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialRemoteWorkingDirectory,
  sshFeatureEnabled
}: ResourcesPageProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [projectDevices, setProjectDevices] = useState<ProjectDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());

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

  function handleStartEdit(device: UserDevice) {
    setEditingDeviceId(device.id);
    setEditingLabel(device.label);
  }

  function handleCancelEdit() {
    setEditingDeviceId(null);
    setEditingLabel('');
  }

  async function handleSaveLabel(deviceId: string) {
    const next = editingLabel.trim();
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
      setEditingLabel('');
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

  const projectDeviceIds = new Set(projectDevices.map(d => d.id));
  const projectDeviceMap = new Map(projectDevices.map(d => [d.id, d]));

  const devicesWithProjectInfo = devices.map(device => ({
    device,
    projectDevice: projectDeviceMap.get(device.id) ?? null,
    hasResources: projectDeviceIds.has(device.id)
  }));

  const devicesInProject = devicesWithProjectInfo.filter(d => d.hasResources);
  const devicesNotInProject = devicesWithProjectInfo.filter(d => !d.hasResources);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Devices &amp; resources</h3>
          <p className="text-xs text-muted-foreground">
            Devices associated with this project and their resource directories. Each device can
            have multiple working directories; the primary one is used for execution.
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
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          isExpanded && 'rotate-90'
                        )}
                      />
                    </button>
                    <Laptop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          value={editingLabel}
                          onChange={event => setEditingLabel(event.target.value)}
                          className="h-7 text-xs"
                          placeholder="e.g. my-raspberry-pi"
                          disabled={isSaving}
                          autoFocus
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void handleSaveLabel(device.id);
                            }
                            if (event.key === 'Escape') {
                              handleCancelEdit();
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
                          onClick={() => void handleSaveLabel(device.id)}
                          disabled={isSaving || !editingLabel.trim()}
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={handleCancelEdit}
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
                          onClick={() => handleStartEdit(device)}
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
                      {resources.map(resource => (
                        <div key={resource.id} className="flex items-center gap-2 py-1 text-xs">
                          <Folder className="ml-5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            {resource.label ? (
                              <span className="font-medium">{resource.label}</span>
                            ) : null}
                            <span
                              className={cn(
                                'block truncate font-mono text-[11px]',
                                resource.label ? 'text-muted-foreground' : 'text-foreground'
                              )}
                              title={resource.directoryPath}
                            >
                              {resource.directoryPath}
                            </span>
                          </div>
                          {resource.isPrimary ? (
                            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                              Primary
                            </span>
                          ) : null}
                        </div>
                      ))}
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
                              value={editingLabel}
                              onChange={event => setEditingLabel(event.target.value)}
                              className="h-7 text-xs"
                              placeholder="e.g. my-raspberry-pi"
                              disabled={isSaving}
                              autoFocus
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void handleSaveLabel(device.id);
                                }
                                if (event.key === 'Escape') {
                                  handleCancelEdit();
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
                              onClick={() => void handleSaveLabel(device.id)}
                              disabled={isSaving || !editingLabel.trim()}
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={handleCancelEdit}
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
                              onClick={() => handleStartEdit(device)}
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
      </section>

      <section className="grid gap-3 ">
        <ResourceDirectoryList
          projectId={projectId}
          onResourceDirectoriesChanged={() => void refreshAll({ showLoading: false })}
        />
      </section>

      {sshFeatureEnabled ? (
        <section className="grid gap-3 ">
          <SshWorkspaceSection
            projectId={projectId}
            initialSshHost={initialSshHost}
            initialSshPort={initialSshPort}
            initialSshUser={initialSshUser}
            initialSshAuthMethod={initialSshAuthMethod}
            initialSshPrivateKeyPath={initialSshPrivateKeyPath}
            initialRemoteWorkingDirectory={initialRemoteWorkingDirectory}
          />
        </section>
      ) : null}
    </div>
  );
}
