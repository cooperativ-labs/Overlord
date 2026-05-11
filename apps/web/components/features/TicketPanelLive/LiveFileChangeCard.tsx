'use client';

import { ChevronDown, ChevronRight, FileCode2, GitCompare } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ExternalLink } from '@/components/features/ExternalLink';
import { Button } from '@/components/ui/button';
import { buildDiffHref } from '@/lib/helpers/file-changes';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type FileChange = Database['public']['Tables']['file_changes']['Row'];

export function LiveFileChangeCard({
  editorScheme,
  fileChange,
  projectId,
  ticketId,
  workspaceRoot
}: {
  editorScheme: string;
  fileChange: FileChange;
  projectId: string | null;
  ticketId: string;
  workspaceRoot: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const href = workspaceRoot
    ? buildDiffHref(fileChange.file_path, workspaceRoot, editorScheme)
    : undefined;
  const currentChangesHref = projectId
    ? `/projects/${projectId}/current-changes?ticket=${encodeURIComponent(ticketId)}&file=${encodeURIComponent(fileChange.file_path)}`
    : null;

  const dateStr = new Date(fileChange.created_at).toLocaleString();
  const snapshotSummary = [
    fileChange.snapshot_backend
      ? fileChange.snapshot_backend === 'jj'
        ? 'JJ'
        : fileChange.snapshot_backend
      : null,
    fileChange.jj_change_id ? `change ${fileChange.jj_change_id.slice(0, 8)}` : null,
    fileChange.jj_commit_id ? `commit ${fileChange.jj_commit_id.slice(0, 8)}` : null,
    fileChange.jj_operation_id ? `op ${fileChange.jj_operation_id.slice(0, 8)}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  return (
    <article className="rounded-lg border bg-muted/20">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-muted',
          expanded && 'bg-muted'
        )}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{fileChange.file_name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{dateStr}</span>
      </button>

      {expanded ? (
        <div className="border-t px-3 pb-3 pt-2 bg-muted">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {href ? (
              <ExternalLink
                className="inline-flex items-center gap-2 break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={href}
                title={`Open ${fileChange.file_path} in your editor`}
              >
                {fileChange.file_path}
              </ExternalLink>
            ) : (
              <p className="break-all text-xs text-muted-foreground">{fileChange.file_path}</p>
            )}
            {currentChangesHref ? (
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Link href={currentChangesHref}>
                  <GitCompare className="h-3 w-3" />
                  Open diff
                </Link>
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Change</p>
              <p className="text-foreground">{fileChange.label}</p>
              <p className="mt-1 text-muted-foreground">{fileChange.summary}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why</p>
                <p className="text-foreground">{fileChange.why}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Impact</p>
                <p className="text-foreground">{fileChange.impact}</p>
              </div>
            </div>
            {snapshotSummary ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Snapshot
                </p>
                <p className="text-xs text-muted-foreground">{snapshotSummary}</p>
                {fileChange.workspace_name || fileChange.workspace_path ? (
                  <p className="mt-1 break-all text-[11px] text-muted-foreground">
                    {fileChange.workspace_name}
                    {fileChange.workspace_name && fileChange.workspace_path ? ' · ' : ''}
                    {fileChange.workspace_path}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
