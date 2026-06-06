'use client';

import { Check, ChevronDown, Laptop, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  SELECTED_DEVICE_KEY,
  useProjectSettings
} from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getProjectDevicesAction, type ProjectDevice } from '@/lib/actions/devices';
import { cn } from '@/lib/utils';

type ProjectExecutionWorkspaceSelectorProps = {
  projectId?: string;
};

export function resolveSelectedDeviceId({
  devices,
  storedDeviceId,
  matchedDeviceId,
  isElectron
}: {
  devices: Pick<ProjectDevice, 'id'>[];
  storedDeviceId: string | null;
  matchedDeviceId: string | null;
  isElectron: boolean;
}): string | null {
  if (storedDeviceId && devices.some(device => device.id === storedDeviceId)) {
    return storedDeviceId;
  }

  if (isElectron && matchedDeviceId && devices.some(device => device.id === matchedDeviceId)) {
    return matchedDeviceId;
  }

  return devices[0]?.id ?? null;
}

export function ProjectExecutionWorkspaceSelector({
  projectId
}: ProjectExecutionWorkspaceSelectorProps) {
  const projectSettings = useProjectSettings();
  const { api, isElectron } = useElectron();
  const [devices, setDevices] = useState<ProjectDevice[]>([]);
  const [matchedDeviceId, setMatchedDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedDeviceId = projectSettings?.selectedDeviceId ?? null;

  useEffect(() => {
    if (!projectId) {
      setDevices([]);
      setMatchedDeviceId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function loadDevices() {
      setLoading(true);
      try {
        let deviceFingerprint: string | null = null;
        if (api?.app?.getDeviceIdentity) {
          try {
            const identity = await api.app.getDeviceIdentity();
            deviceFingerprint = identity.deviceFingerprint?.trim()
              ? identity.deviceFingerprint.trim()
              : null;
          } catch {
            deviceFingerprint = null;
          }
        }
        const payload = await getProjectDevicesAction({
          projectId: projectId!,
          deviceFingerprint
        });
        if (!cancelled) {
          setDevices(payload.devices);
          setMatchedDeviceId(payload.matchedDeviceId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, [projectId, api]);

  // Restore an explicit project preference before applying platform defaults.
  useEffect(() => {
    if (loading || !projectSettings || !projectId) return;
    if (devices.length === 0) return;

    const storedId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(`${SELECTED_DEVICE_KEY}:${projectId}`)
        : null;

    const targetId = resolveSelectedDeviceId({
      devices,
      storedDeviceId: storedId,
      matchedDeviceId,
      isElectron
    });

    const targetDevice = devices.find(d => d.id === targetId);
    const targetPrimaryDirectory =
      targetDevice?.resources.find(r => r.isPrimary)?.directoryPath ?? null;
    if (
      targetId &&
      (targetId !== selectedDeviceId ||
        projectSettings.selectedDeviceWorkingDirectory !== targetPrimaryDirectory)
    ) {
      projectSettings.setSelectedDevice(targetId, targetPrimaryDirectory);
    }
  }, [loading, devices, matchedDeviceId, isElectron, projectId, projectSettings, selectedDeviceId]);

  function handleSelectDevice(device: ProjectDevice) {
    if (!projectSettings) return;
    const primaryResource = device.resources.find(r => r.isPrimary);
    projectSettings.setSelectedDevice(device.id, primaryResource?.directoryPath ?? null);
  }

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  const selectedLabel = selectedDevice?.label ?? null;
  const hasProject = !!projectId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
            devices.length > 0 ? 'border-border' : 'border-dashed border-muted-foreground/60'
          )}
          aria-label="Execution device"
          title={hasProject ? 'Switch execution device for this project' : 'Execution device'}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Laptop className="h-3 w-3" />}
          <span className="max-w-[12rem] truncate sm:max-w-[16rem]">
            {loading
              ? 'Devices'
              : !hasProject
                ? 'No project selected'
                : selectedLabel
                  ? selectedLabel
                  : devices.length === 0
                    ? 'No devices'
                    : `${devices.length} device${devices.length === 1 ? '' : 's'}`}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80 max-h-[min(24rem,70vh)] overflow-y-auto p-0"
      >
        <div className="border-b px-3 py-2">
          <p className="text-xs font-medium text-foreground">Execution device</p>
          <p className="text-[11px] text-muted-foreground">
            {hasProject
              ? 'Select which device to use as the execution target for this project.'
              : 'Select a project to see available execution devices.'}
          </p>
        </div>
        {!hasProject ? (
          <div className="px-3 py-4 text-xs italic text-muted-foreground">
            No project selected. Choose a project to view and select execution devices.
          </div>
        ) : loading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Loading...</div>
        ) : devices.length === 0 ? (
          <div className="px-3 py-4 text-xs italic text-muted-foreground">
            No devices registered for this project yet. Add a resource directory in project
            settings.
          </div>
        ) : (
          <ul className="py-1">
            {devices.map(device => {
              const isSelected = device.id === selectedDeviceId;
              const isThisDevice = matchedDeviceId === device.id;
              const primaryResource = device.resources.find(r => r.isPrimary);
              return (
                <li key={device.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full gap-2 border-b border-border/60 px-3 py-2 text-left text-xs last:border-b-0 transition-colors',
                      isSelected ? 'bg-primary/5' : 'hover:bg-muted/60 cursor-pointer'
                    )}
                    onClick={() => handleSelectDevice(device)}
                    disabled={isSelected}
                    title={
                      isSelected
                        ? 'Current execution device'
                        : `Switch execution to ${device.label}`
                    }
                  >
                    <div className="flex shrink-0 items-start pt-0.5">
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <span className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Laptop className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">{device.label}</span>
                        {device.platform ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {device.platform}
                          </span>
                        ) : null}
                        {isSelected ? (
                          <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Active
                          </span>
                        ) : null}
                      </div>
                      {primaryResource ? (
                        <p
                          className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                          title={primaryResource.directoryPath}
                        >
                          {primaryResource.directoryPath}
                        </p>
                      ) : device.resources.length === 0 ? (
                        <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                          No resource directories
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                      {isThisDevice ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                          This device
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                            aria-hidden
                          />
                          Remote
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {projectSettings ? (
          <>
            <DropdownMenuSeparator className="my-0" />
            <button
              type="button"
              className="w-full cursor-pointer px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
              onClick={() => projectSettings.openProjectSettings('Resources')}
            >
              Manage devices &amp; resources...
            </button>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
