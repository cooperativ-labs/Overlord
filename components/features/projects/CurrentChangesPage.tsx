'use client';

import { ArrowLeft, FileCode2, GitBranch, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DiffPane } from '@/components/features/projects/current-changes/DiffPane';
import { FileListPane } from '@/components/features/projects/current-changes/FileListPane';
import { getRationalePaths } from '@/components/features/projects/current-changes/helpers';
import {
  type DiffState,
  type EnrichedCurrentChangeFile,
  type FileChangeRecord,
  type GitDiffResponse,
  type GitStatusResponse
} from '@/components/features/projects/current-changes/types';
import { UnavailableStateCard } from '@/components/features/projects/current-changes/UnavailableStateCard';
import { buildEnrichedCurrentChangeFiles } from '@/components/features/projects/current-changes/view-model';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { parseUnifiedDiff } from '@/lib/git/unified-diff';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';
import { buildProjectPath } from '@/lib/helpers/ticket-path';

type CurrentChangesPageProps = {
  projectId: string;
  projectName: string;
  workingDirectory: string | null;
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  initialFilePath?: string | null;
};

export function CurrentChangesPage({
  projectId,
  projectName,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  initialFilePath
}: CurrentChangesPageProps) {
  const { api, isElectron } = useElectron();
  const [statusResponse, setStatusResponse] = useState<GitStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [fileChanges, setFileChanges] = useState<FileChangeRecord[]>([]);
  const [rationalesError, setRationalesError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<DiffState>({
    error: null,
    isLoading: false,
    parsed: null
  });
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());

  const enrichedFiles = useMemo(
    () =>
      buildEnrichedCurrentChangeFiles({
        files: statusResponse?.files ?? [],
        rationales: fileChanges
      }),
    [fileChanges, statusResponse?.files]
  );

  const uniqueTickets = useMemo(() => {
    const ticketMap = new Map<string, EnrichedCurrentChangeFile['tickets'][number]>();
    for (const file of enrichedFiles) {
      for (const ticket of file.tickets) {
        if (!ticketMap.has(ticket.id)) {
          ticketMap.set(ticket.id, ticket);
        }
      }
    }
    return [...ticketMap.values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }, [enrichedFiles]);

  const filteredFiles = useMemo(() => {
    if (selectedTicketIds.size === 0) return enrichedFiles;
    return enrichedFiles.filter(file =>
      file.tickets.some(ticket => selectedTicketIds.has(ticket.id))
    );
  }, [enrichedFiles, selectedTicketIds]);

  function toggleTicketFilter(ticketId: string) {
    setSelectedTicketIds(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }

  function clearTicketFilter() {
    setSelectedTicketIds(new Set());
  }

  const hasLocalDirectory = !!workingDirectory && !isWorkingDirectoryNone(workingDirectory);
  const hasSshConfig = !!sshCommand?.trim() && !!remoteWorkingDirectory?.trim();
  const canInspectChanges = hasLocalDirectory || hasSshConfig;
  const gitPayload = useMemo(() => {
    if (hasLocalDirectory) return { directory: workingDirectory! };
    return {
      sshCommand: sshCommand ?? undefined,
      remoteDirectory: remoteWorkingDirectory ?? undefined
    };
  }, [hasLocalDirectory, remoteWorkingDirectory, sshCommand, workingDirectory]);

  async function loadStatus(): Promise<GitStatusResponse | null> {
    if (!api?.filesystem?.getGitStatus || !canInspectChanges) return null;
    setStatusLoading(true);
    const result = (await api.filesystem.getGitStatus(gitPayload)) as GitStatusResponse;
    setStatusResponse(result);
    setSelectedPath(current => {
      if (!result.files.length) return null;
      if (initialFilePath && result.files.some(file => file.path === initialFilePath)) {
        return initialFilePath;
      }
      if (current && result.files.some(file => file.path === current)) return current;
      return result.files[0]?.path ?? null;
    });
    setStatusLoading(false);
    return result;
  }

  async function loadFileChanges(files: GitStatusResponse['files']) {
    setRationalesError(null);
    try {
      const filePaths = getRationalePaths(files);
      if (filePaths.length === 0) {
        setFileChanges([]);
        return;
      }

      const searchParams = new URLSearchParams();
      for (const filePath of filePaths) {
        searchParams.append('filePath', filePath);
      }

      const response = await fetch(`/api/projects/${projectId}/file-changes?${searchParams}`, {
        cache: 'no-store'
      });
      const payload = (await response.json()) as {
        error?: string;
        fileChanges?: FileChangeRecord[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load file changes.');
      }
      setFileChanges(payload.fileChanges ?? []);
    } catch (error) {
      setFileChanges([]);
      setRationalesError(error instanceof Error ? error.message : 'Failed to load file changes.');
    }
  }

  useEffect(() => {
    if (!isElectron || !canInspectChanges) {
      setStatusLoading(false);
      return;
    }

    void (async () => {
      const result = await loadStatus();
      const files = result?.files ?? [];
      await loadFileChanges(files);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    canInspectChanges,
    isElectron,
    projectId,
    remoteWorkingDirectory,
    sshCommand,
    workingDirectory
  ]);

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedPath(null);
      return;
    }

    if (selectedPath && filteredFiles.some(file => file.path === selectedPath)) {
      return;
    }

    setSelectedPath(filteredFiles[0]?.path ?? null);
  }, [filteredFiles, selectedPath]);

  useEffect(() => {
    const selectedFile = statusResponse?.files.find(file => file.path === selectedPath);
    if (!isElectron || !api?.filesystem?.getGitDiff || !selectedFile || !canInspectChanges) {
      setDiffState({
        error: null,
        isLoading: false,
        parsed: null
      });
      return;
    }

    let cancelled = false;

    const run = async () => {
      setDiffState(previous => ({ ...previous, error: null, isLoading: true }));
      const result = (await api.filesystem.getGitDiff({
        ...gitPayload,
        originalPath: selectedFile.originalPath ?? undefined,
        path: selectedFile.path,
        status: selectedFile.status
      })) as GitDiffResponse;

      if (cancelled) return;

      setDiffState({
        error: result.error ?? null,
        isLoading: false,
        parsed: result.diff ? parseUnifiedDiff(result.diff) : null
      });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [api, canInspectChanges, gitPayload, isElectron, selectedPath, statusResponse]);

  const backHref = buildProjectPath({ projectId });

  if (!isElectron) {
    return (
      <UnavailableStateCard
        backHref={backHref}
        description="This view is only available in the Electron app because it reads your linked Git working directory locally."
      />
    );
  }

  if (!canInspectChanges) {
    return (
      <UnavailableStateCard
        backHref={backHref}
        description="Link a local working directory or configure an SSH remote workspace in project settings to inspect uncommitted changes."
      />
    );
  }

  const displayDirectory = hasLocalDirectory ? workingDirectory! : (remoteWorkingDirectory ?? '');
  const selectedFile = enrichedFiles.find(file => file.path === selectedPath) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Current Changes</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore uncommitted Git changes for {projectName} and inspect the ticket rationale
            attached to each hunk.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusResponse?.branch ? (
            <div className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {statusResponse.branch}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void (async () => {
                const result = await loadStatus();
                const files = result?.files ?? [];
                await loadFileChanges(files);
              })()
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to project
            </Link>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
          <FileListPane
            filteredFiles={filteredFiles}
            selectedPath={selectedPath}
            selectedTicketIds={selectedTicketIds}
            statusLoading={statusLoading}
            statusResponse={statusResponse}
            tickets={uniqueTickets}
            workingDirectory={displayDirectory}
            onClearTicketFilter={clearTicketFilter}
            onSelectFile={setSelectedPath}
            onToggleTicketFilter={toggleTicketFilter}
          />

          <div className="min-h-0">
            {rationalesError ? (
              <div className="border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800">
                {rationalesError}
              </div>
            ) : null}
            {selectedFile ? (
              <DiffPane
                diff={diffState.parsed}
                diffError={diffState.error}
                file={selectedFile}
                isLoading={diffState.isLoading}
                projectId={projectId}
                selectedFilePath={selectedFile.path}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                Select a file to inspect its diff.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
