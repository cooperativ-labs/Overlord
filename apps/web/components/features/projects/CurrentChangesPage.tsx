'use client';

import { FileCode2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChangesToolbar } from '@/components/features/projects/current-changes/ChangesToolbar';
import { DiffPane } from '@/components/features/projects/current-changes/DiffPane';
import { FileListPane } from '@/components/features/projects/current-changes/FileListPane';
import { getRationalePaths } from '@/components/features/projects/current-changes/helpers';
import type { EnrichedCurrentChangeFile } from '@/components/features/projects/current-changes/types';
import { UnavailableStateCard } from '@/components/features/projects/current-changes/UnavailableStateCard';
import {
  buildEnrichedCurrentChangeFiles,
  countFilesPerTicket,
  pruneTicketFilterSelection,
  ticketFilterSelectionsEqual,
  ticketIdsTouchingCurrentChanges
} from '@/components/features/projects/current-changes/view-model';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  useCurrentChangeFileChanges,
  useCurrentChangesRealtime,
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
  initialTicketIds?: string[];
};

export type DiffViewMode = 'inline' | 'side-by-side';

export function CurrentChangesPage({
  projectId,
  projectName,
  workingDirectory,
  initialFilePath,
  initialTicketIds
}: CurrentChangesPageProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    () => new Set(initialTicketIds ?? [])
  );
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('inline');
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
  useCurrentChangesRealtime({
    enabled: isElectron && canInspectChanges,
    projectId
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

  const fileCountsByTicketId = useMemo(() => countFilesPerTicket(enrichedFiles), [enrichedFiles]);

  const ticketIdsTouchingChanges = useMemo(
    () => ticketIdsTouchingCurrentChanges(enrichedFiles),
    [enrichedFiles]
  );

  const rationalePathCount = useMemo(
    () => getRationalePaths(statusResponse?.files ?? []).length,
    [statusResponse?.files]
  );

  const canPruneStaleTicketFilters =
    (statusQuery.isFetched || statusQuery.isError) &&
    (rationalePathCount === 0 ? true : fileChangesQuery.isFetched || fileChangesQuery.isError);

  const filteredFiles = useMemo(() => {
    if (selectedTicketIds.size === 0) return enrichedFiles;
    return enrichedFiles.filter(file =>
      file.tickets.some(ticket => selectedTicketIds.has(ticket.id))
    );
  }, [enrichedFiles, selectedTicketIds]);

  const syncTicketSelectionToUrl = useCallback(
    (next: Set<string>) => {
      if (!pathname) return;
      const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
      nextParams.delete('ticket');
      for (const ticketId of next) {
        nextParams.append('ticket', ticketId);
      }
      const queryString = nextParams.toString();
      const nextHref = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(nextHref, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setTicketSelection = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setSelectedTicketIds(previous => {
        const next = updater(previous);
        syncTicketSelectionToUrl(next);
        return next;
      });
    },
    [syncTicketSelectionToUrl]
  );

  const toggleTicketFilter = useCallback(
    (ticketId: string) => {
      setTicketSelection(previous => {
        const next = new Set(previous);
        if (next.has(ticketId)) {
          next.delete(ticketId);
        } else {
          next.add(ticketId);
        }
        return next;
      });
    },
    [setTicketSelection]
  );

  const clearTicketFilter = useCallback(() => {
    setTicketSelection(() => new Set());
  }, [setTicketSelection]);

  const focusTicketFilter = useCallback(
    (ticketId: string) => {
      setTicketSelection(() => new Set([ticketId]));
    },
    [setTicketSelection]
  );

  useEffect(() => {
    if (!canPruneStaleTicketFilters) return;

    setTicketSelection(current => {
      const next = pruneTicketFilterSelection({
        selectedTicketIds: current,
        validTicketIds: ticketIdsTouchingChanges
      });
      if (ticketFilterSelectionsEqual(current, next)) {
        return current;
      }
      return next;
    });
  }, [canPruneStaleTicketFilters, setTicketSelection, ticketIdsTouchingChanges]);

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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ChangesToolbar
        backHref={backHref}
        branchesResponse={branchesResponse}
        statusResponse={statusResponse}
        workingDirectory={displayDirectory}
        projectName={projectName}
        tickets={uniqueTickets}
        selectedTicketIds={selectedTicketIds}
        fileCountsByTicketId={fileCountsByTicketId}
        onRefresh={() => void refreshAll()}
        onToggleTicketFilter={toggleTicketFilter}
        onClearTicketFilter={clearTicketFilter}
      />

      {rationalesError ? (
        <div className="border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-800">
          {rationalesError}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
        <FileListPane
          fileCountsByTicketId={fileCountsByTicketId}
          filteredFiles={filteredFiles}
          selectedPath={selectedPath}
          selectedTicketIds={selectedTicketIds}
          statusLoading={statusLoading}
          statusResponse={statusResponse}
          tickets={uniqueTickets}
          workingDirectory={displayDirectory}
          onClearTicketFilter={clearTicketFilter}
          onSelectFile={setSelectedPath}
        />

        <div className="min-h-0">
          {selectedFile ? (
            <DiffPane
              diff={diffState.parsed}
              diffError={diffState.error}
              file={selectedFile}
              isLoading={diffState.isLoading}
              projectId={projectId}
              selectedFilePath={selectedFile.path}
              selectedTicketIds={selectedTicketIds}
              viewMode={diffViewMode}
              onFilterByTicket={focusTicketFilter}
              onToggleTicketFilter={toggleTicketFilter}
              onViewModeChange={setDiffViewMode}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <FileCode2 className="h-8 w-8 opacity-40" />
              <p>Select a file to inspect its diff.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
