'use client';

import { Bot, FileCode2, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  DEMO_CURRENT_CHANGES_BRANCH,
  DEMO_CURRENT_CHANGES_DIRECTORY,
  DEMO_CURRENT_CHANGES_FILES,
  type DemoCurrentChangeFile,
  type DemoTicket
} from './mock-data';

type DemoCurrentChangesPageProps = {
  projectName: string;
  reviewTickets: DemoTicket[];
};

function formatLineNumber(value: number | null) {
  return value === null ? '' : String(value);
}

function formatAgentName(agent: DemoTicket['recent_agent']) {
  if (agent === 'claude-code') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return 'Agent';
}

export function DemoCurrentChangesPage({
  projectName,
  reviewTickets
}: DemoCurrentChangesPageProps) {
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    DEMO_CURRENT_CHANGES_FILES[0]?.id ?? null
  );

  const ticketsById = useMemo(
    () => new Map(reviewTickets.map(ticket => [ticket.id, ticket])),
    [reviewTickets]
  );

  const filteredFiles = useMemo(() => {
    if (selectedTicketIds.size === 0) return DEMO_CURRENT_CHANGES_FILES;
    return DEMO_CURRENT_CHANGES_FILES.filter(file => selectedTicketIds.has(file.ticketId));
  }, [selectedTicketIds]);

  useEffect(() => {
    if (filteredFiles.some(file => file.id === selectedFileId)) return;
    setSelectedFileId(filteredFiles[0]?.id ?? null);
  }, [filteredFiles, selectedFileId]);

  const selectedFile =
    filteredFiles.find(file => file.id === selectedFileId) ?? filteredFiles[0] ?? null;
  const selectedTicket = selectedFile ? (ticketsById.get(selectedFile.ticketId) ?? null) : null;

  function toggleTicketFilter(ticketId: string) {
    setSelectedTicketIds(previous => {
      const next = new Set(previous);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }

  function statusClassName(status: DemoCurrentChangeFile['status']) {
    return status === 'A'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Current Changes</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Mock uncommitted changes for {projectName}, limited to the two tickets currently in
            review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            {DEMO_CURRENT_CHANGES_BRANCH}
          </div>
          <Badge variant="outline" className="rounded-full">
            Demo data
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium text-foreground">Uncommitted files</p>
              <p className="text-xs text-muted-foreground">{DEMO_CURRENT_CHANGES_DIRECTORY}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              {reviewTickets.map(ticket => {
                const isActive = selectedTicketIds.has(ticket.id);
                return (
                  <Button
                    key={ticket.id}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 max-w-full rounded-full px-3 text-xs"
                    onClick={() => toggleTicketFilter(ticket.id)}
                  >
                    <span className="truncate">{ticket.title}</span>
                  </Button>
                );
              })}
              {selectedTicketIds.size > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2 text-xs"
                  onClick={() => setSelectedTicketIds(new Set())}
                >
                  Clear
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="space-y-2">
                {filteredFiles.map(file => {
                  const ticket = ticketsById.get(file.ticketId);
                  const isSelected = file.id === selectedFile?.id;

                  return (
                    <button
                      key={file.id}
                      type="button"
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary/40 bg-primary/5'
                          : 'hover:border-border hover:bg-muted/40'
                      )}
                      onClick={() => setSelectedFileId(file.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{file.path}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {file.summary}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn('shrink-0', statusClassName(file.status))}
                        >
                          {file.status}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="max-w-[210px] truncate text-[10px]">
                          {ticket?.title ?? 'Review ticket'}
                        </Badge>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="text-emerald-600 dark:text-emerald-300">
                            +{file.linesAdded}
                          </span>
                          <span className="text-rose-600 dark:text-rose-300">
                            -{file.linesRemoved}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-auto">
            {selectedFile && selectedTicket ? (
              <>
                <div className="border-b px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{selectedFile.path}</p>
                      <p className="text-xs text-muted-foreground">
                        Mock diff linked to a review ticket delivery.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="h-3.5 w-3.5" />
                      {formatAgentName(selectedTicket.recent_agent)}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">Review ticket</Badge>
                      <p className="font-medium text-foreground">{selectedTicket.title}</p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{selectedTicket.objective}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-md border bg-background p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Change
                        </p>
                        <p className="mt-1 text-sm text-foreground">
                          {selectedFile.rationaleLabel}
                        </p>
                      </div>
                      <div className="rounded-md border bg-background p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Why
                        </p>
                        <p className="mt-1 text-sm text-foreground">{selectedFile.rationaleWhy}</p>
                      </div>
                      <div className="rounded-md border bg-background p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Impact
                        </p>
                        <p className="mt-1 text-sm text-foreground">
                          {selectedFile.rationaleImpact}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <div className="border-b bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                      {selectedFile.diffHeader}
                    </div>
                    <div className="font-mono text-xs">
                      {selectedFile.lines.map((line, index) => (
                        <div
                          key={`${selectedFile.id}:${index}`}
                          className={cn(
                            'grid grid-cols-[56px_56px_minmax(0,1fr)] gap-3 px-3 py-1.5',
                            line.kind === 'add' && 'bg-emerald-500/10',
                            line.kind === 'del' && 'bg-rose-500/10'
                          )}
                        >
                          <span className="text-right text-[11px] text-muted-foreground">
                            {formatLineNumber(line.oldNumber)}
                          </span>
                          <span className="text-right text-[11px] text-muted-foreground">
                            {formatLineNumber(line.newNumber)}
                          </span>
                          <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                            {line.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                Select a file to inspect its mock diff.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
