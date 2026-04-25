'use client';

import { useQuery } from '@tanstack/react-query';

import { getRationalePaths } from '@/components/features/projects/current-changes/helpers';
import type {
  DiffState,
  FileChangeRecord,
  GitBranchesResponse,
  GitDiffResponse,
  GitStatusFile,
  GitStatusResponse
} from '@/components/features/projects/current-changes/types';
import { fetchWithElectronRetry } from '@/lib/electron-auth/fetch-retry';
import { parseUnifiedDiff } from '@/lib/git/unified-diff';

type ElectronFilesystemApi = {
  getGitBranches?: (input: { directory: string }) => Promise<unknown>;
  getGitStatus?: (input: { directory: string }) => Promise<unknown>;
  getGitDiff?: (input: {
    directory: string;
    originalPath?: string;
    path: string;
    status: string;
  }) => Promise<unknown>;
};

export const currentChangesQueryKeys = {
  all: ['current-changes'] as const,
  branches: (directory: string | null) => ['current-changes', 'branches', directory] as const,
  status: (directory: string | null) => ['current-changes', 'status', directory] as const,
  fileChanges: (projectId: string, filePaths: string[]) =>
    ['current-changes', 'file-changes', projectId, filePaths] as const,
  diff: (
    directory: string | null,
    file?: Pick<GitStatusFile, 'path' | 'originalPath' | 'status'> | null
  ) =>
    [
      'current-changes',
      'diff',
      directory,
      file?.path ?? null,
      file?.originalPath ?? null,
      file?.status ?? null
    ] as const
};

export function useGitBranchesQuery(input: {
  api: ElectronFilesystemApi | undefined;
  canInspectChanges: boolean;
  directory: string | null;
  isElectron: boolean;
}) {
  return useQuery<GitBranchesResponse | null, Error>({
    queryKey: currentChangesQueryKeys.branches(input.directory),
    queryFn: async () => {
      if (!input.api?.getGitBranches || !input.directory) return null;
      return (await input.api.getGitBranches({
        directory: input.directory
      })) as GitBranchesResponse;
    },
    enabled: input.isElectron && input.canInspectChanges && Boolean(input.api?.getGitBranches),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
}

export function useGitStatusQuery(input: {
  api: ElectronFilesystemApi | undefined;
  canInspectChanges: boolean;
  directory: string | null;
  isElectron: boolean;
}) {
  return useQuery<GitStatusResponse | null, Error>({
    queryKey: currentChangesQueryKeys.status(input.directory),
    queryFn: async () => {
      if (!input.api?.getGitStatus || !input.directory) return null;
      return (await input.api.getGitStatus({ directory: input.directory })) as GitStatusResponse;
    },
    enabled: input.isElectron && input.canInspectChanges && Boolean(input.api?.getGitStatus),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
}

export function useCurrentChangeFileChanges(input: { projectId: string; files: GitStatusFile[] }) {
  const filePaths = getRationalePaths(input.files);
  return useQuery<FileChangeRecord[], Error>({
    queryKey: currentChangesQueryKeys.fileChanges(input.projectId, filePaths),
    queryFn: async () => {
      if (filePaths.length === 0) return [];

      const searchParams = new URLSearchParams();
      for (const filePath of filePaths) {
        searchParams.append('filePath', filePath);
      }

      const response = await fetchWithElectronRetry(
        `/api/projects/${input.projectId}/file-changes?${searchParams}`,
        {
          cache: 'no-store'
        }
      );
      const payload = (await response.json()) as {
        error?: string;
        fileChanges?: FileChangeRecord[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load file changes.');
      }
      return payload.fileChanges ?? [];
    },
    enabled: input.files.length > 0,
    initialData: [],
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
}

export function useGitDiffQuery(input: {
  api: ElectronFilesystemApi | undefined;
  canInspectChanges: boolean;
  directory: string | null;
  file: GitStatusFile | null;
  isElectron: boolean;
}) {
  return useQuery<DiffState, Error>({
    queryKey: currentChangesQueryKeys.diff(input.directory, input.file),
    queryFn: async () => {
      if (!input.api?.getGitDiff || !input.directory || !input.file) {
        return { error: null, isLoading: false, parsed: null };
      }

      const result = (await input.api.getGitDiff({
        directory: input.directory,
        originalPath: input.file.originalPath ?? undefined,
        path: input.file.path,
        status: input.file.status
      })) as GitDiffResponse;

      return {
        error: result.error ?? null,
        isLoading: false,
        parsed: result.diff ? parseUnifiedDiff(result.diff) : null
      };
    },
    enabled:
      input.isElectron &&
      input.canInspectChanges &&
      Boolean(input.api?.getGitDiff) &&
      Boolean(input.file),
    staleTime: 15_000,
    refetchOnWindowFocus: false
  });
}
