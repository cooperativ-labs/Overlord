'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { ProjectSettingsNavSection } from '@/components/modals/ProjectSettingsModal';
import { ProjectSettingsModal } from '@/components/modals/ProjectSettingsModal';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';
import { parseLegacySshCommand } from '@/lib/workspace/parse-ssh-command';
import type { SshAuthMethod, SshConnectionConfig } from '@/lib/workspace/types';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];
export type ProjectExecutionWorkspace = 'local' | 'ssh';

export const PROJECT_EXECUTION_WORKSPACE_KEY = 'overlord-project-execution-workspace';
export const WORKSPACE_CHANGED_EVENT = 'overlord-workspace-changed';

/** @deprecated Project execution is always treated as local; SSH workspace selection is disabled. */
export function resolveExecutionWorkspace(
  _preferredWorkspace: ProjectExecutionWorkspace,
  _hasLocalDirectory: boolean,
  _hasSshDirectory: boolean
): ProjectExecutionWorkspace {
  return 'local';
}

export const SELECTED_DEVICE_KEY = 'overlord-selected-device';

type ProjectSettingsContextValue = {
  projectId: string;
  openProjectSettings: (initialNav?: ProjectSettingsNavSection) => void;
  executionWorkspace: ProjectExecutionWorkspace;
  setExecutionWorkspace: (workspace: ProjectExecutionWorkspace) => void;
  hasLocalDirectory: boolean;
  hasSshDirectory: boolean;
  localWorkingDirectory: string | null;
  sshCommand: string | null;
  sshConnectionConfig: SshConnectionConfig | null;
  remoteWorkingDirectory: string | null;
  effectiveWorkingDirectory: string | null;
  effectiveSshCommand: string | null;
  effectiveSshConnectionConfig: SshConnectionConfig | null;
  effectiveRemoteWorkingDirectory: string | null;
  selectedDeviceId: string | null;
  setSelectedDevice: (deviceId: string | null, workingDirectory: string | null) => void;
  selectedDeviceWorkingDirectory: string | null;
};

const ProjectSettingsContext = createContext<ProjectSettingsContextValue | null>(null);

export function useProjectSettings() {
  const ctx = useContext(ProjectSettingsContext);
  return ctx;
}

type ProjectSettingsProviderProps = {
  children: ReactNode;
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
  initialSshHost?: string | null;
  initialSshPort?: number | null;
  initialSshUser?: string | null;
  initialSshAuthMethod?: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath?: string | null;
  initialEverhourProjectId: string | null;
  initialEverhourProjectName: string | null;
  isArchived?: boolean;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
  sshFeatureEnabled: boolean;
  slackEnabled?: boolean;
};

export function ProjectSettingsProvider({
  children,
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  initialSshCommand,
  initialRemoteWorkingDirectory,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialEverhourProjectId,
  initialEverhourProjectName,
  isArchived = false,
  initialStatuses,
  hasEverhourApiKey,
  sshFeatureEnabled,
  slackEnabled = false
}: ProjectSettingsProviderProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialNav, setModalInitialNav] = useState<ProjectSettingsNavSection | undefined>();
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(`${SELECTED_DEVICE_KEY}:${projectId}`) ?? null;
  });
  const [selectedDeviceWorkingDirectory, setSelectedDeviceWorkingDirectory] = useState<
    string | null
  >(null);

  const setSelectedDevice = useCallback(
    (deviceId: string | null, workingDirectory: string | null) => {
      setSelectedDeviceIdState(deviceId);
      setSelectedDeviceWorkingDirectory(workingDirectory);
      if (typeof window !== 'undefined') {
        if (deviceId) {
          window.localStorage.setItem(`${SELECTED_DEVICE_KEY}:${projectId}`, deviceId);
        } else {
          window.localStorage.removeItem(`${SELECTED_DEVICE_KEY}:${projectId}`);
        }
      }
    },
    [projectId]
  );

  const hasLocalDirectory =
    typeof initialWorkingDirectory === 'string' &&
    initialWorkingDirectory.trim().length > 0 &&
    !isWorkingDirectoryNone(initialWorkingDirectory);
  const hasSshDirectory =
    sshFeatureEnabled &&
    typeof initialSshCommand === 'string' &&
    initialSshCommand.trim().length > 0;
  const localWorkingDirectory = hasLocalDirectory ? initialWorkingDirectory.trim() : null;
  const sshCommand = hasSshDirectory ? initialSshCommand.trim() : null;
  const remoteWorkingDirectory =
    sshFeatureEnabled &&
    typeof initialRemoteWorkingDirectory === 'string' &&
    initialRemoteWorkingDirectory.trim().length > 0
      ? initialRemoteWorkingDirectory.trim()
      : null;
  const sshConnectionConfig = useMemo<SshConnectionConfig | null>(() => {
    if (!sshFeatureEnabled) return null;

    const host = initialSshHost?.trim();
    const user = initialSshUser?.trim();
    if (host && user) {
      return {
        host,
        port: initialSshPort ?? undefined,
        user,
        authMethod: (initialSshAuthMethod as SshAuthMethod | null) ?? 'agent',
        privateKeyPath: initialSshPrivateKeyPath?.trim() || undefined
      };
    }
    return parseLegacySshCommand(sshCommand);
  }, [
    initialSshAuthMethod,
    initialSshHost,
    initialSshPort,
    initialSshPrivateKeyPath,
    initialSshUser,
    sshFeatureEnabled,
    sshCommand
  ]);

  const openProjectSettings = useCallback((initialNav?: ProjectSettingsNavSection) => {
    setModalInitialNav(initialNav);
    setModalOpen(true);
  }, []);

  const setExecutionWorkspace = useCallback((_workspace: ProjectExecutionWorkspace) => {
    // Execution is always local; SSH workspace selection is disabled.
  }, []);

  const effectiveWorkingDirectory = selectedDeviceWorkingDirectory ?? localWorkingDirectory;

  const value: ProjectSettingsContextValue = useMemo(
    () => ({
      projectId,
      openProjectSettings,
      executionWorkspace: 'local',
      setExecutionWorkspace,
      hasLocalDirectory: hasLocalDirectory || Boolean(selectedDeviceWorkingDirectory),
      hasSshDirectory,
      localWorkingDirectory,
      sshCommand,
      sshConnectionConfig,
      remoteWorkingDirectory,
      effectiveWorkingDirectory,
      effectiveSshCommand: null,
      effectiveSshConnectionConfig: null,
      effectiveRemoteWorkingDirectory: null,
      selectedDeviceId,
      setSelectedDevice,
      selectedDeviceWorkingDirectory
    }),
    [
      effectiveWorkingDirectory,
      hasLocalDirectory,
      hasSshDirectory,
      localWorkingDirectory,
      openProjectSettings,
      projectId,
      selectedDeviceId,
      selectedDeviceWorkingDirectory,
      setExecutionWorkspace,
      setSelectedDevice,
      sshCommand,
      sshConnectionConfig,
      remoteWorkingDirectory
    ]
  );

  return (
    <ProjectSettingsContext.Provider value={value}>
      {children}
      <ProjectSettingsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        projectId={projectId}
        organizationId={organizationId}
        initialName={initialName}
        initialColor={initialColor}
        initialWorkingDirectory={initialWorkingDirectory}
        initialSshCommand={initialSshCommand}
        initialRemoteWorkingDirectory={initialRemoteWorkingDirectory}
        initialSshHost={initialSshHost ?? null}
        initialSshPort={initialSshPort ?? null}
        initialSshUser={initialSshUser ?? null}
        initialSshAuthMethod={initialSshAuthMethod ?? null}
        initialSshPrivateKeyPath={initialSshPrivateKeyPath ?? null}
        initialEverhourProjectId={initialEverhourProjectId}
        initialEverhourProjectName={initialEverhourProjectName}
        isArchived={isArchived}
        initialStatuses={initialStatuses}
        hasEverhourApiKey={hasEverhourApiKey}
        sshFeatureEnabled={sshFeatureEnabled}
        slackEnabled={slackEnabled}
        initialNav={modalInitialNav}
      />
    </ProjectSettingsContext.Provider>
  );
}
