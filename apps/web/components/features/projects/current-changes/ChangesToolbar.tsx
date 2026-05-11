'use client';

import {
  ArrowLeft,
  ChevronDown,
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { GitBranchPanel } from './GitBranchPanel';
import { PullRequestPanel } from './PullRequestPanel';
import { PushToGithubPanel } from './PushToGithubPanel';
import { TicketFilterPopover } from './TicketFilterPopover';
import type { GitBranchEntry, GitStatusResponse, TicketSummary } from './types';

type ChangesToolbarProps = {
  backHref: string;
  branchesResponse: {
    branches: GitBranchEntry[];
    currentBranch: string | null;
    defaultBranch: string | null;
  } | null;
  statusResponse: GitStatusResponse | null;
  workingDirectory: string;
  projectName: string;
  tickets: TicketSummary[];
  selectedTicketIds: Set<string>;
  fileCountsByTicketId: Map<string, number>;
  onRefresh: () => void;
  onToggleTicketFilter: (ticketId: string) => void;
  onClearTicketFilter: () => void;
};

export function ChangesToolbar({
  backHref,
  branchesResponse,
  statusResponse,
  workingDirectory,
  projectName,
  tickets,
  selectedTicketIds,
  fileCountsByTicketId,
  onRefresh,
  onToggleTicketFilter,
  onClearTicketFilter
}: ChangesToolbarProps) {
  const branch = branchesResponse?.currentBranch ?? statusResponse?.branch ?? null;
  const defaultBranch = branchesResponse?.defaultBranch ?? null;
  const hasChanges = (statusResponse?.files.length ?? 0) > 0;

  return (
    <div className="flex items-center gap-1 border-b bg-background/80 px-3 py-2 backdrop-blur">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Link href={backHref} aria-label="Back to project">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Back to {projectName}</TooltipContent>
      </Tooltip>

      <div className="mx-1 h-5 w-px bg-border" />

      <span className="truncate text-sm font-medium text-foreground" title={projectName}>
        {projectName}
      </span>
      <span className="mx-1 text-muted-foreground/60">/</span>
      <span className="truncate text-sm text-muted-foreground">Changes</span>

      <div className="ml-auto flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 min-w-0 max-w-72 gap-1.5 px-2 text-xs">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{branch ?? 'no branch'}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
            <GitBranchPanel
              branches={branchesResponse?.branches ?? []}
              currentBranch={branch}
              defaultBranch={defaultBranch}
              workingDirectory={workingDirectory}
              onChanged={onRefresh}
            />
          </PopoverContent>
        </Popover>

        <TicketFilterPopover
          fileCountsByTicketId={fileCountsByTicketId}
          selectedTicketIds={selectedTicketIds}
          tickets={tickets}
          onClear={onClearTicketFilter}
          onToggle={onToggleTicketFilter}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={onRefresh}
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-border" />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={hasChanges ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={!hasChanges}
            >
              <GitCommit className="h-3.5 w-3.5" />
              Commit
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96">
            <PushToGithubPanel
              branch={branch}
              hasChanges={hasChanges}
              workingDirectory={workingDirectory}
              onPushed={onRefresh}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
              <GitPullRequest className="h-3.5 w-3.5" />
              PR
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[420px]">
            <PullRequestPanel
              baseBranch={defaultBranch}
              currentBranch={branch}
              workingDirectory={workingDirectory}
              onCreated={onRefresh}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
