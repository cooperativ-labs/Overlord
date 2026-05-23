'use client';

import { Check, Laptop, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ResourceDirectoryList } from '@/components/features/projects/ResourceDirectoryList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteOrganizationExecutionTargetAction,
  getUserDevicesAction,
  updateDeviceLabelAction,
  type UserDevice
} from '@/lib/actions/devices';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';

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
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function refreshDevices(options?: { showLoading?: boolean }) {
    const showLoading = options?.showLoading !== false;
    if (showLoading) setLoadingDevices(true);
    try {
      const data = await getUserDevicesAction();
      setDevices(data);
    } finally {
      if (showLoading) setLoadingDevices(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshDevices({ showLoading: true });
  }, [open, projectId]);

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

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Your devices</h3>
          <p className="text-xs text-muted-foreground">
            Devices that have connected to Overlord with your account. Rename a device to make it
            easier to recognize in resource lists. Admins can remove a device from the organization
            if it has no linked resource directories.
          </p>
        </div>

        {loadingDevices ? (
          <p className="text-xs text-muted-foreground">Loading devices…</p>
        ) : devices.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No devices registered yet. Connect a device via Overlord Desktop or the{' '}
            <code className="rounded bg-muted px-1">ovld</code> CLI.
          </p>
        ) : (
          <div className="grid gap-1.5">
            {devices.map(device => {
              const isEditing = editingDeviceId === device.id;
              const isSaving = savingDeviceId === device.id;
              const isDeleting = deletingDeviceId === device.id;
              const isConfirming = confirmDeleteId === device.id;
              const isBusy = isSaving || isDeleting;
              return (
                <div
                  key={device.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                >
                  <Laptop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <Input
                        value={editingLabel}
                        onChange={event => setEditingLabel(event.target.value)}
                        className="h-7 text-xs"
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
        )}
      </section>

      <section className="grid gap-3 ">
        <ResourceDirectoryList
          projectId={projectId}
          onResourceDirectoriesChanged={() => void refreshDevices({ showLoading: false })}
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
