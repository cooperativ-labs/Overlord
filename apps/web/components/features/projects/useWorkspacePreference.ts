'use client';

import { useCallback, useEffect, useState } from 'react';

import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';

import {
  PROJECT_EXECUTION_WORKSPACE_KEY,
  type ProjectExecutionWorkspace,
  resolveExecutionWorkspace,
  useProjectSettings,
  WORKSPACE_CHANGED_EVENT
} from './ProjectSettingsContext';

/**
 * Returns the effective workspace values for a project.
 *
 * When the component is inside a ProjectSettingsProvider (e.g. the project
 * layout), it delegates to the context. When the context is unavailable
 * (e.g. ticket panel rendered inside the SidePanel, which is teleported
 * outside the ProjectSettingsProvider), it reads the user's workspace
 * preference from localStorage and computes the effective values locally.
 *
 * A custom window event (`WORKSPACE_CHANGED_EVENT`) keeps this hook in
 * sync when the workspace selector changes the preference from within
 * the context.
 */
export function useWorkspacePreference({
  projectId,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  sshEnabled = true
}: {
  projectId?: string | null;
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  isElectron?: boolean;
  sshEnabled?: boolean;
}) {
  const projectSettings = useProjectSettings();

  const hasLocalDirectory =
    typeof workingDirectory === 'string' &&
    workingDirectory.trim().length > 0 &&
    !isWorkingDirectoryNone(workingDirectory);
  const hasSshDirectory =
    sshEnabled && typeof sshCommand === 'string' && sshCommand.trim().length > 0;

  const readFromStorage = useCallback((): ProjectExecutionWorkspace => {
    if (typeof window === 'undefined' || !projectId) return 'local';
    const stored = window.localStorage.getItem(`${PROJECT_EXECUTION_WORKSPACE_KEY}:${projectId}`);
    const preferred: ProjectExecutionWorkspace =
      stored === 'ssh' || stored === 'local'
        ? stored
        : hasLocalDirectory
          ? 'local'
          : hasSshDirectory
            ? 'ssh'
            : 'local';
    return resolveExecutionWorkspace(preferred, hasLocalDirectory, hasSshDirectory);
  }, [hasLocalDirectory, hasSshDirectory, projectId]);

  const [storageBased, setStorageBased] = useState<ProjectExecutionWorkspace>(readFromStorage);

  // Re-read when the workspace selector dispatches a change event.
  useEffect(() => {
    if (projectSettings || typeof window === 'undefined') return;

    setStorageBased(readFromStorage());

    const handleWorkspaceChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        projectId: string;
        workspace: ProjectExecutionWorkspace;
      } | null;
      if (detail && detail.projectId === projectId) {
        setStorageBased(detail.workspace);
      }
    };

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, [projectId, projectSettings, readFromStorage]);

  // When the context is available, use it directly.
  if (projectSettings) {
    return {
      executionWorkspace: projectSettings.executionWorkspace,
      effectiveWorkingDirectory: projectSettings.effectiveWorkingDirectory,
      effectiveSshCommand: projectSettings.effectiveSshCommand,
      effectiveRemoteWorkingDirectory: projectSettings.effectiveRemoteWorkingDirectory,
      hasLocalDirectory: projectSettings.hasLocalDirectory,
      hasSshDirectory: projectSettings.hasSshDirectory
    };
  }

  // Fallback: compute effective values from localStorage preference.
  const localDir = hasLocalDirectory ? workingDirectory!.trim() : null;
  const ssh = hasSshDirectory ? sshCommand!.trim() : null;
  const remoteDir =
    sshEnabled &&
    typeof remoteWorkingDirectory === 'string' &&
    remoteWorkingDirectory.trim().length > 0
      ? remoteWorkingDirectory.trim()
      : null;

  return {
    executionWorkspace: storageBased,
    effectiveWorkingDirectory: storageBased === 'local' ? localDir : null,
    effectiveSshCommand: sshEnabled && storageBased === 'ssh' ? ssh : null,
    effectiveRemoteWorkingDirectory: sshEnabled && storageBased === 'ssh' ? remoteDir : null,
    hasLocalDirectory,
    hasSshDirectory
  };
}
