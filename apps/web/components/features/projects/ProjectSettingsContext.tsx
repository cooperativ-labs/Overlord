'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

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

export function resolveExecutionWorkspace(
  preferredWorkspace: ProjectExecutionWorkspace,
  hasLocalDirectory: boolean,
  hasSshDirectory: boolean
): ProjectExecutionWorkspace {
  if (preferredWorkspace === 'ssh' && hasSshDirectory) return 'ssh';
  if (preferredWorkspace === 'local' && hasLocalDirectory) return 'local';
  if (hasLocalDirectory) return 'local';
  if (hasSshDirectory) return 'ssh';
  return 'local';
}

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
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
  sshFeatureEnabled: boolean;
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
  initialStatuses,
  hasEverhourApiKey,
  sshFeatureEnabled
}: ProjectSettingsProviderProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialNav, setModalInitialNav] = useState<ProjectSettingsNavSection | undefined>();
  const [executionWorkspace, setExecutionWorkspaceState] =
    useState<ProjectExecutionWorkspace>('local');

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
  const resolvedExecutionWorkspace = resolveExecutionWorkspace(
    executionWorkspace,
    hasLocalDirectory,
    hasSshDirectory
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedValue = window.localStorage.getItem(
      `${PROJECT_EXECUTION_WORKSPACE_KEY}:${projectId}`
    );
    const preferredWorkspace =
      storedValue === 'ssh' || storedValue === 'local'
        ? storedValue
        : hasLocalDirectory
          ? 'local'
          : hasSshDirectory
            ? 'ssh'
            : 'local';
    setExecutionWorkspaceState(
      resolveExecutionWorkspace(preferredWorkspace, hasLocalDirectory, hasSshDirectory)
    );
  }, [hasLocalDirectory, hasSshDirectory, projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `${PROJECT_EXECUTION_WORKSPACE_KEY}:${projectId}`,
      resolvedExecutionWorkspace
    );
  }, [projectId, resolvedExecutionWorkspace]);

  const openProjectSettings = useCallback((initialNav?: ProjectSettingsNavSection) => {
    setModalInitialNav(initialNav);
    setModalOpen(true);
  }, []);

  const setExecutionWorkspace = useCallback(
    (workspace: ProjectExecutionWorkspace) => {
      const resolved = resolveExecutionWorkspace(workspace, hasLocalDirectory, hasSshDirectory);
      setExecutionWorkspaceState(resolved);
      // Dispatch a custom event so components outside this provider (e.g. the SidePanel)
      // can react to workspace changes via useWorkspacePreference.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_CHANGED_EVENT, {
            detail: { projectId, workspace: resolved }
          })
        );
      }
    },
    [hasLocalDirectory, hasSshDirectory, projectId]
  );

  const value: ProjectSettingsContextValue = useMemo(
    () => ({
      projectId,
      openProjectSettings,
      executionWorkspace: resolvedExecutionWorkspace,
      setExecutionWorkspace,
      hasLocalDirectory,
      hasSshDirectory,
      localWorkingDirectory,
      sshCommand,
      sshConnectionConfig,
      remoteWorkingDirectory,
      effectiveWorkingDirectory:
        resolvedExecutionWorkspace === 'local' ? localWorkingDirectory : null,
      effectiveSshCommand: resolvedExecutionWorkspace === 'ssh' ? sshCommand : null,
      effectiveSshConnectionConfig:
        resolvedExecutionWorkspace === 'ssh' ? sshConnectionConfig : null,
      effectiveRemoteWorkingDirectory:
        resolvedExecutionWorkspace === 'ssh' ? remoteWorkingDirectory : null
    }),
    [
      hasLocalDirectory,
      hasSshDirectory,
      localWorkingDirectory,
      openProjectSettings,
      projectId,
      remoteWorkingDirectory,
      resolvedExecutionWorkspace,
      setExecutionWorkspace,
      sshCommand,
      sshConnectionConfig
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
        initialStatuses={initialStatuses}
        hasEverhourApiKey={hasEverhourApiKey}
        sshFeatureEnabled={sshFeatureEnabled}
        initialNav={modalInitialNav}
      />
    </ProjectSettingsContext.Provider>
  );
}
