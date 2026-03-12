'use client';

import { ArrowLeft, FileCode2, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  type ParsedDiffHunk,
  type ParsedUnifiedDiff,
  parseUnifiedDiff
} from '@/lib/git/unified-diff';
import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';
import type { Json } from '@/types/database.types';

type GitStatusFile = {
  originalPath?: string | null;
  path: string;
  stagedStatus: string;
  status: string;
  unstagedStatus: string;
};

type GitStatusResponse = {
  branch: string | null;
  error?: string;
  files: GitStatusFile[];
  linkedDirectory: string | null;
  repoRoot: string | null;
};

type GitDiffResponse = {
  diff: string;
  error?: string;
  path: string | null;
  repoRoot: string | null;
  status: string | null;
};

type RationaleHunk = {
  header?: string;
  new_lines?: number;
  new_start?: number;
  old_lines?: number;
  old_start?: number;
};

type ChangeRationaleRecord = {
  attribution_source: string;
  change_kind: string;
  confidence: string;
  created_at: string;
  event: {
    created_at: string;
    event_type: string;
    id: string;
    summary: string | null;
  } | null;
  file_path: string;
  hunks: Json;
  id: string;
  impact: string;
  label: string;
  session: {
    agent_identifier: string;
    id: string;
  } | null;
  summary: string;
  ticket: {
    id: string;
    title: string | null;
  } | null;
  updated_at: string;
  why: string;
};

type CurrentChangesPageProps = {
  projectId: string;
  projectName: string;
  workingDirectory: string | null;
};

function formatStatus(status: string): string {
  switch (status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type';
    case 'untracked':
      return 'Untracked';
    default:
      return 'Modified';
  }
}

function getStatusClasses(status: string): string {
  switch (status) {
    case 'added':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    case 'deleted':
      return 'bg-rose-500/10 text-rose-700 border-rose-500/20';
    case 'renamed':
      return 'bg-sky-500/10 text-sky-700 border-sky-500/20';
    case 'untracked':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function parseRationaleHunks(value: Json): RationaleHunk[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, Json>;

    return [
      {
        header: typeof candidate.header === 'string' ? candidate.header : undefined,
        new_lines: typeof candidate.new_lines === 'number' ? candidate.new_lines : undefined,
        new_start: typeof candidate.new_start === 'number' ? candidate.new_start : undefined,
        old_lines: typeof candidate.old_lines === 'number' ? candidate.old_lines : undefined,
        old_start: typeof candidate.old_start === 'number' ? candidate.old_start : undefined
      }
    ];
  });
}

function rangesOverlap(
  startA: number | undefined,
  lengthA: number | undefined,
  startB: number,
  lengthB: number
): boolean {
  if (typeof startA !== 'number') return false;
  const aEnd = startA + Math.max((lengthA ?? 1) - 1, 0);
  const bEnd = startB + Math.max(lengthB - 1, 0);
  return startA <= bEnd && startB <= aEnd;
}

function hunkMatchesRationale(hunk: ParsedDiffHunk, rationale: ChangeRationaleRecord): boolean {
  const rationaleHunks = parseRationaleHunks(rationale.hunks);
  if (rationaleHunks.length === 0) return false;

  return rationaleHunks.some(candidate => {
    if (candidate.header && candidate.header === hunk.header) return true;
    if (rangesOverlap(candidate.new_start, candidate.new_lines, hunk.newStart, hunk.newLines)) {
      return true;
    }
    return rangesOverlap(candidate.old_start, candidate.old_lines, hunk.oldStart, hunk.oldLines);
  });
}

function lineNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

function buildHunkMatches(
  rationales: ChangeRationaleRecord[],
  file: GitStatusFile,
  hunk: ParsedDiffHunk
): ChangeRationaleRecord[] {
  const candidatePaths = new Set([file.path, file.originalPath].filter(Boolean));
  return rationales.filter(
    rationale => candidatePaths.has(rationale.file_path) && hunkMatchesRationale(hunk, rationale)
  );
}

function FileListItem({
  file,
  isSelected,
  onSelect,
  rationaleCount
}: {
  file: GitStatusFile;
  isSelected: boolean;
  onSelect: () => void;
  rationaleCount: number;
}) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left transition',
        isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
          {directory ? <p className="truncate text-xs text-muted-foreground">{directory}</p> : null}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
            getStatusClasses(file.status)
          )}
        >
          {formatStatus(file.status)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">
          {file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
        </span>
        {rationaleCount > 0 ? <span>{rationaleCount} rationale</span> : null}
      </div>
    </button>
  );
}

function HunkPopoverContent({
  matches,
  projectId
}: {
  matches: ChangeRationaleRecord[];
  projectId: string;
}) {
  if (matches.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">No rationale recorded</p>
        <p className="text-xs text-muted-foreground">
          This changed hunk does not have a linked Overlord rationale yet.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-96 space-y-3 overflow-auto">
      {matches.map(match => (
        <div key={match.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">{match.label}</p>
              <p className="text-xs text-muted-foreground">{match.summary}</p>
            </div>
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {match.confidence}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <p>
              <span className="font-medium text-foreground">Why:</span> {match.why}
            </p>
            <p>
              <span className="font-medium text-foreground">Impact:</span> {match.impact}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {match.ticket ? (
              <Link
                className="rounded underline-offset-4 hover:underline"
                href={buildTicketPath({ projectId, ticketId: match.ticket.id })}
              >
                {match.ticket.title?.trim() || `Ticket ${match.ticket.id.slice(-8)}`}
              </Link>
            ) : null}
            {match.event ? <span>{match.event.event_type}</span> : null}
            {match.session ? <span>{match.session.agent_identifier}</span> : null}
            <span>{new Date(match.created_at).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffPane({
  diff,
  diffError,
  file,
  isLoading,
  projectId,
  rationales,
  selectedFilePath
}: {
  diff: ParsedUnifiedDiff | null;
  diffError: string | null;
  file: GitStatusFile;
  isLoading: boolean;
  projectId: string;
  rationales: ChangeRationaleRecord[];
  selectedFilePath: string | null;
}) {
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);

  useEffect(() => {
    setOpenPopoverKey(null);
  }, [selectedFilePath]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (diffError) {
    return <div className="p-6 text-sm text-destructive">{diffError}</div>;
  }

  if (!diff || diff.hunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        No diff preview is available for this file yet.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="border-b px-4 py-3">
        <p className="font-medium text-foreground">
          {diff.newPath ?? diff.oldPath ?? selectedFilePath}
        </p>
        <p className="text-xs text-muted-foreground">
          Click a changed line to inspect linked rationale.
        </p>
      </div>
      <div className="space-y-4 p-4">
        {diff.hunks.map(hunk => {
          const matches = buildHunkMatches(rationales, file, hunk);

          return (
            <div key={hunk.id} className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between gap-3 bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                <span className="truncate">{hunk.header}</span>
                {matches.length > 0 ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    {matches.length} linked
                  </span>
                ) : null}
              </div>
              <div className="font-mono text-xs">
                {hunk.lines.map(line => {
                  const isChanged = line.kind !== 'context';
                  const popoverKey = `${hunk.id}:${line.key}`;
                  const row = (
                    <div
                      className={cn(
                        'grid grid-cols-[56px_56px_minmax(0,1fr)] items-start gap-3 px-3 py-1.5 text-left',
                        line.kind === 'add' && 'bg-emerald-500/5',
                        line.kind === 'del' && 'bg-rose-500/5',
                        isChanged && 'hover:bg-muted/60'
                      )}
                    >
                      <span className="select-none text-right text-[11px] text-muted-foreground">
                        {lineNumber(line.oldLineNumber)}
                      </span>
                      <span className="select-none text-right text-[11px] text-muted-foreground">
                        {lineNumber(line.newLineNumber)}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                        {line.content}
                      </span>
                    </div>
                  );

                  if (!isChanged) {
                    return <div key={line.key}>{row}</div>;
                  }

                  return (
                    <Popover
                      key={line.key}
                      open={openPopoverKey === popoverKey}
                      onOpenChange={open => setOpenPopoverKey(open ? popoverKey : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-full"
                          onClick={() => setOpenPopoverKey(popoverKey)}
                        >
                          {row}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[420px]">
                        <HunkPopoverContent matches={matches} projectId={projectId} />
                      </PopoverContent>
                    </Popover>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CurrentChangesPage({
  projectId,
  projectName,
  workingDirectory
}: CurrentChangesPageProps) {
  const { api, isElectron } = useElectron();
  const [statusResponse, setStatusResponse] = useState<GitStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [rationales, setRationales] = useState<ChangeRationaleRecord[]>([]);
  const [rationalesError, setRationalesError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<{
    error: string | null;
    isLoading: boolean;
    parsed: ParsedUnifiedDiff | null;
  }>({
    error: null,
    isLoading: false,
    parsed: null
  });

  function getRationalePaths(files: GitStatusFile[]): string[] {
    return [
      ...new Set(
        files.flatMap(file =>
          [file.path, file.originalPath].filter((value): value is string => Boolean(value))
        )
      )
    ];
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
      if (current && result.files.some(file => file.path === current)) return current;
      return result.files[0]?.path ?? null;
    });
    setStatusLoading(false);
    return result;
  }

  async function loadRationales(files: GitStatusFile[]) {
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
      await loadRationales(result?.files ?? []);
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
      <div className="rounded-xl border p-6">
        <div className="flex items-center gap-2 text-foreground">
          <FileCode2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Current Changes</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This view is only available in the Electron app because it reads your linked Git working
          directory locally.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={backHref}>Back to project</Link>
        </Button>
      </div>
    );
  }

  if (!workingDirectory) {
    return (
      <div className="rounded-xl border p-6">
        <div className="flex items-center gap-2 text-foreground">
          <FileCode2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Current Changes</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Link a project working directory in settings to inspect local uncommitted changes.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={backHref}>Back to project</Link>
        </Button>
      </div>
    );
  }

  const selectedFile = statusResponse?.files.find(file => file.path === selectedPath) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pl-4">
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
                await loadRationales(result?.files ?? []);
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
          <div className="flex min-h-0 flex-col border-r">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium text-foreground">Uncommitted files</p>
              <p className="text-xs text-muted-foreground">{workingDirectory}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {statusLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading repository changes…
                </div>
              ) : statusResponse?.error ? (
                <p className="text-sm text-destructive">{statusResponse.error}</p>
              ) : !statusResponse?.files.length ? (
                <p className="text-sm text-muted-foreground">No uncommitted changes found.</p>
              ) : (
                <div className="space-y-2">
                  {statusResponse.files.map(file => {
                    const candidatePaths = new Set([file.path, file.originalPath].filter(Boolean));
                    const rationaleCount = rationales.filter(rationale =>
                      candidatePaths.has(rationale.file_path)
                    ).length;

                    return (
                      <FileListItem
                        key={`${file.status}:${file.path}`}
                        file={file}
                        isSelected={selectedPath === file.path}
                        onSelect={() => setSelectedPath(file.path)}
                        rationaleCount={rationaleCount}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

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
