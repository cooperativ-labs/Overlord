'use client';

import { ArrowLeft, FileCode2, GitBranch, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DiffPane } from '@/components/features/projects/current-changes/DiffPane';
import { FileListPane } from '@/components/features/projects/current-changes/FileListPane';
import { GitBranchPanel } from '@/components/features/projects/current-changes/GitBranchPanel';
import { PullRequestPanel } from '@/components/features/projects/current-changes/PullRequestPanel';
import { PushToGithubPanel } from '@/components/features/projects/current-changes/PushToGithubPanel';
import type { EnrichedCurrentChangeFile } from '@/components/features/projects/current-changes/types';
import { UnavailableStateCard } from '@/components/features/projects/current-changes/UnavailableStateCard';
import { buildEnrichedCurrentChangeFiles } from '@/components/features/projects/current-changes/view-model';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import {
  useCurrentChangeFileChanges,
  useGitBranchesQuery,
  useGitDiffQuery,
  useGitStatusQuery
} from '@/lib/client-data/current-changes/hooks';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';
import { buildProjectPath } from '@/lib/helpers/ticket-path';

type CurrentChangesPageProps = {
  projectId: string;
  projectName: string;
  workingDirectory: string | null;
  initialFilePath?: string | null;
};

export function CurrentChangesPage({
  projectId,
  projectName,
  workingDirectory,
  initialFilePath
}: CurrentChangesPageProps) {
  const { api, isElectron } = useElectron();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const hasLocalDirectory = !!workingDirectory && !isWorkingDirectoryNone(workingDirectory);
  const canInspectChanges = hasLocalDirectory;
  const branchesQuery = useGitBranchesQuery({
    api: api?.filesystem,
    canInspectChanges,
    directory: workingDirectory,
    isElectron
  });
  const statusQuery = useGitStatusQuery({
    api: api?.filesystem,
    canInspectChanges,
    directory: workingDirectory,
    isElectron
  });
  const statusResponse = statusQuery.data ?? null;
  const fileChangesQuery = useCurrentChangeFileChanges({
    projectId,
    files: statusResponse?.files ?? []
  });
  const fileChanges = useMemo(() => fileChangesQuery.data ?? [], [fileChangesQuery.data]);
  const selectedStatusFile = statusResponse?.files.find(file => file.path === selectedPath) ?? null;
  const diffQuery = useGitDiffQuery({
    api: api?.filesystem,
    canInspectChanges,
    directory: workingDirectory,
    file: selectedStatusFile,
    isElectron
  });
  const diffState = diffQuery.data ?? {
    error: null,
    isLoading: diffQuery.isFetching,
    parsed: null
  };
  const branchesResponse = branchesQuery.data ?? null;
  const statusLoading = statusQuery.isLoading || statusQuery.isFetching;
  const rationalesError = fileChangesQuery.error?.message ?? null;

  async function refreshAll() {
    await branchesQuery.refetch();
    await statusQuery.refetch();
    await fileChangesQuery.refetch();
    await diffQuery.refetch();
  }

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

  useEffect(() => {
    const result = statusResponse;
    if (!isElectron || !canInspectChanges || !result) return;
    setSelectedPath(current => {
      if (!result.files.length) return null;
      if (initialFilePath && result.files.some(file => file.path === initialFilePath)) {
        return initialFilePath;
      }
      if (current && result.files.some(file => file.path === current)) return current;
      return result.files[0]?.path ?? null;
    });
  }, [canInspectChanges, initialFilePath, isElectron, statusResponse]);

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
        description="Link a local working directory in project settings to inspect uncommitted changes."
      />
    );
  }

  const displayDirectory = workingDirectory!;
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
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshAll()}>
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

      <div className="grid gap-4 xl:grid-cols-3">
        <GitBranchPanel
          branches={branchesResponse?.branches ?? []}
          currentBranch={branchesResponse?.currentBranch ?? statusResponse?.branch ?? null}
          defaultBranch={branchesResponse?.defaultBranch ?? null}
          workingDirectory={displayDirectory}
          onChanged={() => void refreshAll()}
        />

        <PushToGithubPanel
          branch={statusResponse?.branch ?? null}
          hasChanges={(statusResponse?.files.length ?? 0) > 0}
          workingDirectory={displayDirectory}
          onPushed={() => void refreshAll()}
        />

        <PullRequestPanel
          baseBranch={branchesResponse?.defaultBranch ?? null}
          currentBranch={branchesResponse?.currentBranch ?? statusResponse?.branch ?? null}
          workingDirectory={displayDirectory}
          onCreated={() => void refreshAll()}
        />
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
