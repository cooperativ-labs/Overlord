'use client';

import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import { useState } from 'react';

import { buildDiffHref } from '@/lib/helpers/file-changes';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type FileChange = Database['public']['Tables']['file_changes']['Row'];

export function LiveFileChangeCard({
  editorScheme,
  fileChange,
  workspaceRoot
}: {
  editorScheme: string;
  fileChange: FileChange;
  workspaceRoot: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const href = workspaceRoot
    ? buildDiffHref(fileChange.file_path, workspaceRoot, editorScheme)
    : undefined;

  const dateStr = new Date(fileChange.created_at).toLocaleString();

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
          <div className="mb-2">
            {href ? (
              <a
                className="inline-flex items-center gap-2 break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={href}
                title={`Open ${fileChange.file_path} in your editor`}
              >
                {fileChange.file_path}
              </a>
            ) : (
              <p className="break-all text-xs text-muted-foreground">{fileChange.file_path}</p>
            )}
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
          </div>
        </div>
      ) : null}
    </article>
  );
}
