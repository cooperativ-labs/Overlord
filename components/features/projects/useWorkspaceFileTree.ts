'use client';

import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { areStringArraysEqual } from '@/lib/helpers/array-utils';

import { useProjectSettings } from './ProjectSettingsContext';

const EMPTY_PATHS: string[] = [];

type UseWorkspaceFileTreeOptions = {
  /** Server-provided file paths to use as fallback when Electron IPC is unavailable */
  fileMentionPaths?: string[];
  /** Override local working directory (used when ProjectSettingsContext is unavailable) */
  workingDirectory?: string | null;
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
 * File mentions and tree browsing always use the project's local workspace.
 * Falls back to prop overrides for components rendered outside a project layout.
 */
export function useWorkspaceFileTree(
  options: UseWorkspaceFileTreeOptions = {}
): UseWorkspaceFileTreeResult {
  const {
    fileMentionPaths = EMPTY_PATHS,
    workingDirectory: propWorkingDirectory,
    enabled = true
  } = options;

  const { api, isElectron } = useElectron();
  const projectSettings = useProjectSettings();

  // File mentions intentionally ignore the execution workspace selector.
  const effectiveWorkingDirectory =
    projectSettings?.localWorkingDirectory ?? propWorkingDirectory ?? null;

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

    const payload = effectiveWorkingDirectory?.trim()
      ? { directory: effectiveWorkingDirectory.trim() }
      : null;

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
  }, [api, effectiveWorkingDirectory, enabled, fileMentionPaths, isElectron, syncFiles]);

  return { files, loading, error, truncated };
}
