'use client';

import { ArrowLeft, FileCode2, GitBranch, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DiffPane } from '@/components/features/projects/current-changes/DiffPane';
import { FileListPane } from '@/components/features/projects/current-changes/FileListPane';
import { getRationalePaths } from '@/components/features/projects/current-changes/helpers';
import {
  type ChangeRationaleRecord,
  type DiffState,
  type FileAttribution,
  type GitDiffResponse,
  type GitStatusResponse
} from '@/components/features/projects/current-changes/types';
import { UnavailableStateCard } from '@/components/features/projects/current-changes/UnavailableStateCard';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { parseUnifiedDiff } from '@/lib/git/unified-diff';
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
  const [statusResponse, setStatusResponse] = useState<GitStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [rationales, setRationales] = useState<ChangeRationaleRecord[]>([]);
  const [rationalesError, setRationalesError] = useState<string | null>(null);
  const [fileAttributions, setFileAttributions] = useState<FileAttribution[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<DiffState>({
    error: null,
    isLoading: false,
    parsed: null
  });
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());

  const uniqueTickets = useMemo(() => {
    const ticketMap = new Map<string, { id: string; status: string | null; title: string | null }>();
    for (const rationale of rationales) {
      if (rationale.ticket && !ticketMap.has(rationale.ticket.id)) {
        ticketMap.set(rationale.ticket.id, rationale.ticket);
      }
    }
    for (const attr of fileAttributions) {
      if (!ticketMap.has(attr.ticket_id)) {
        ticketMap.set(attr.ticket_id, {
          id: attr.ticket_id,
          status: null,
          title: attr.ticket_title
        });
      }
    }
    return [...ticketMap.values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }, [rationales, fileAttributions]);

  const filteredFiles = useMemo(() => {
    const files = statusResponse?.files ?? [];
    if (selectedTicketIds.size === 0) return files;
    const filePathsWithMatchingRationales = new Set(
      rationales.filter(r => r.ticket && selectedTicketIds.has(r.ticket.id)).map(r => r.file_path)
    );
    const filePathsWithMatchingAttributions = new Set(
      fileAttributions.filter(a => selectedTicketIds.has(a.ticket_id)).map(a => a.file_path)
    );
    return files.filter(
      file =>
        filePathsWithMatchingRationales.has(file.path) ||
        filePathsWithMatchingAttributions.has(file.path) ||
        (file.originalPath &&
          (filePathsWithMatchingRationales.has(file.originalPath) ||
            filePathsWithMatchingAttributions.has(file.originalPath)))
    );
  }, [statusResponse?.files, rationales, fileAttributions, selectedTicketIds]);

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

  async function loadStatus(): Promise<GitStatusResponse | null> {
    if (!api?.filesystem?.getGitStatus || !workingDirectory) return null;
    setStatusLoading(true);
    const result = (await api.filesystem.getGitStatus({
      directory: workingDirectory
    })) as GitStatusResponse;
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

  async function loadFileAttributions(files: GitStatusResponse['files']) {
    try {
      const filePaths = getRationalePaths(files);
      if (filePaths.length === 0) {
        setFileAttributions([]);
        return;
      }
      const searchParams = new URLSearchParams();
      for (const filePath of filePaths) {
        searchParams.append('filePath', filePath);
      }
      const response = await fetch(`/api/projects/${projectId}/file-attribution?${searchParams}`, {
        cache: 'no-store'
      });
      const payload = (await response.json()) as {
        error?: string;
        attributions?: FileAttribution[];
      };
      if (response.ok) {
        setFileAttributions(payload.attributions ?? []);
      }
    } catch {
      // Non-critical: file attribution is supplementary
    }
  }

  async function loadRationales(files: GitStatusResponse['files']) {
    setRationalesError(null);
    try {
      const filePaths = getRationalePaths(files);
      if (filePaths.length === 0) {
        setRationales([]);
        return;
      }

      const searchParams = new URLSearchParams();
      for (const filePath of filePaths) {
        searchParams.append('filePath', filePath);
      }

      const response = await fetch(`/api/projects/${projectId}/change-rationales?${searchParams}`, {
        cache: 'no-store'
      });
      const payload = (await response.json()) as {
        error?: string;
        rationales?: ChangeRationaleRecord[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load change rationales.');
      }
      setRationales(payload.rationales ?? []);
    } catch (error) {
      setRationales([]);
      setRationalesError(
        error instanceof Error ? error.message : 'Failed to load change rationales.'
      );
    }
  }

  useEffect(() => {
    if (!isElectron || !workingDirectory) {
      setStatusLoading(false);
      return;
    }

    void (async () => {
      const result = await loadStatus();
      const files = result?.files ?? [];
      await Promise.all([loadRationales(files), loadFileAttributions(files)]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron, workingDirectory, projectId, api]);

  useEffect(() => {
    const selectedFile = statusResponse?.files.find(file => file.path === selectedPath);
    if (!isElectron || !api?.filesystem?.getGitDiff || !workingDirectory || !selectedFile) {
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
        directory: workingDirectory,
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
  }, [api, isElectron, selectedPath, statusResponse, workingDirectory]);

  const backHref = buildProjectPath({ projectId });

  if (!isElectron) {
    return (
      <UnavailableStateCard
        backHref={backHref}
        description="This view is only available in the Electron app because it reads your linked Git working directory locally."
      />
    );
  }

  if (!workingDirectory) {
    return (
      <UnavailableStateCard
        backHref={backHref}
        description="Link a project working directory in settings to inspect local uncommitted changes."
      />
    );
  }

  const selectedFile = statusResponse?.files.find(file => file.path === selectedPath) ?? null;

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
                await Promise.all([loadRationales(files), loadFileAttributions(files)]);
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
            fileAttributions={fileAttributions}
            filteredFiles={filteredFiles}
            rationales={rationales}
            selectedPath={selectedPath}
            selectedTicketIds={selectedTicketIds}
            statusLoading={statusLoading}
            statusResponse={statusResponse}
            tickets={uniqueTickets}
            workingDirectory={workingDirectory}
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
                fileAttributions={fileAttributions}
                isLoading={diffState.isLoading}
                projectId={projectId}
                rationales={rationales}
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
