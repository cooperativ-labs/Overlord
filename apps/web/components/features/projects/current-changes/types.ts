import type { ParsedUnifiedDiff } from '@/lib/git/unified-diff';
import type { Json } from '@/types/database.types';

export type GitStatusFile = {
  linesAdded?: number | null;
  linesRemoved?: number | null;
  originalPath?: string | null;
  path: string;
  stagedStatus: string;
  status: string;
  unstagedStatus: string;
};

export type GitStatusResponse = {
  branch: string | null;
  error?: string;
  files: GitStatusFile[];
  linkedDirectory: string | null;
  repoRoot: string | null;
};

export type GitBranchEntry = {
  current: boolean;
  name: string;
  upstream: string | null;
};

export type GitBranchesResponse = {
  branches: GitBranchEntry[];
  currentBranch: string | null;
  defaultBranch: string | null;
  repoRoot: string | null;
  error?: string;
};

export type GitBranchActionResponse = {
  ok: boolean;
  branch: string | null;
  error?: string;
};

export type GitPullResponse = {
  ok: boolean;
  branch: string | null;
  output: string;
  error?: string;
};

export type GitPushResponse = {
  ok: boolean;
  branch: string | null;
  pushed: boolean;
  output: string;
  error?: string;
};

export type GitCreatePullRequestResponse = {
  ok: boolean;
  branch: string | null;
  number: number | null;
  url: string | null;
  error?: string;
};

export type PullRequestDraft = {
  body: string;
  title: string;
};

export type GitDiffResponse = {
  diff: string;
  error?: string;
  path: string | null;
  repoRoot: string | null;
  status: string | null;
};

export type RationaleHunk = {
  header?: string;
  new_lines?: number;
  new_start?: number;
  old_lines?: number;
  old_start?: number;
};

export type FileChangeRecord = {
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
  file_name: string;
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
    ticket_id?: string | null;
    objective?: string | null;
    latest_objective_agent?: string | null;
    status: string;
    title: string | null;
  } | null;
  updated_at: string;
  why: string;
};

export type DiffState = {
  error: string | null;
  isLoading: boolean;
  parsed: ParsedUnifiedDiff | null;
};

export type TicketSummary = {
  id: string;
  ticket_id?: string | null;
  objective?: string | null;
  latest_objective_agent?: string | null;
  status: string | null;
  title: string | null;
};

export type EnrichedCurrentChangeFile = {
  fileChangeCount: number;
  file: GitStatusFile;
  path: string;
  primaryFileChange: FileChangeRecord | null;
  primaryTicket: TicketSummary | null;
  rationales: FileChangeRecord[];
  summary: string;
  tickets: TicketSummary[];
};
