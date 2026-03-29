'use client';

import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { areStringArraysEqual } from '@/lib/helpers/array-utils';

import { useProjectSettings } from './ProjectSettingsContext';

const EMPTY_PATHS: string[] = [];

type UseWorkspaceFileTreeOptions = {
  /** Server-provided file paths to use as fallback when Electron IPC is unavailable */
  fileMentionPaths?: string[];
  /** Override working directory (used when ProjectSettingsContext is unavailable) */
  workingDirectory?: string | null;
  /** Override SSH command (used when ProjectSettingsContext is unavailable) */
  sshCommand?: string | null;
  /** Override remote working directory (used when ProjectSettingsContext is unavailable) */
  remoteWorkingDirectory?: string | null;
  /** Whether file tree loading is enabled (defaults to true) */
  enabled?: boolean;
};

type UseWorkspaceFileTreeResult = {
  files: string[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
};

/**
 * Centralized hook for loading project file trees, workspace-aware.
 *
 * Automatically uses ProjectSettingsContext when available to determine
 * whether to fetch files from a local directory or via SSH. Falls back
 * to prop overrides for components rendered outside a project layout.
 */
export function useWorkspaceFileTree(
  options: UseWorkspaceFileTreeOptions = {}
): UseWorkspaceFileTreeResult {
  const {
    fileMentionPaths = EMPTY_PATHS,
    workingDirectory: propWorkingDirectory,
    sshCommand: propSshCommand,
    remoteWorkingDirectory: propRemoteWorkingDirectory,
    enabled = true
  } = options;

  const { api, isElectron } = useElectron();
  const projectSettings = useProjectSettings();

  // Resolve effective values: prefer context, fall back to props
  const effectiveWorkingDirectory =
    projectSettings?.effectiveWorkingDirectory ?? propWorkingDirectory ?? null;
  const effectiveSshCommand = projectSettings?.effectiveSshCommand ?? propSshCommand ?? null;
  const effectiveRemoteWorkingDirectory =
    projectSettings?.effectiveRemoteWorkingDirectory ?? propRemoteWorkingDirectory ?? null;

  const [files, setFiles] = useState<string[]>(fileMentionPaths);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const syncFiles = useCallback((nextPaths: string[]) => {
    setFiles(current => (areStringArraysEqual(current, nextPaths) ? current : nextPaths));
  }, []);

  useEffect(() => {
    if (!enabled) {
      syncFiles(fileMentionPaths);
      return;
    }

    if (!isElectron || !api?.filesystem?.listProjectFiles) {
      syncFiles(fileMentionPaths);
      return;
    }

    // Build the IPC payload based on workspace type
    let payload: {
      directory?: string;
      sshCommand?: string;
      remoteDirectory?: string;
    } | null = null;

    if (effectiveSshCommand?.trim() && effectiveRemoteWorkingDirectory?.trim()) {
      payload = {
        sshCommand: effectiveSshCommand.trim(),
        remoteDirectory: effectiveRemoteWorkingDirectory.trim()
      };
    } else if (effectiveWorkingDirectory?.trim()) {
      payload = { directory: effectiveWorkingDirectory.trim() };
    }

    if (!payload) {
      syncFiles(fileMentionPaths);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void api.filesystem
      .listProjectFiles(payload)
      .then(result => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          syncFiles(fileMentionPaths);
        } else {
          syncFiles(result.files ?? EMPTY_PATHS);
        }
        setTruncated(Boolean(result.truncated));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load file tree.');
        syncFiles(fileMentionPaths);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    api,
    effectiveRemoteWorkingDirectory,
    effectiveSshCommand,
    effectiveWorkingDirectory,
    enabled,
    fileMentionPaths,
    isElectron,
    syncFiles
  ]);

  return { files, loading, error, truncated };
}
