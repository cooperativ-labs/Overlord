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

export type ChangeRationaleRecord = {
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
    objective?: string | null;
    recent_agent?: string | null;
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
  objective?: string | null;
  recent_agent?: string | null;
  status: string | null;
  title: string | null;
};

export type FileAttribution = {
  file_path: string;
  ticket_id: string;
  ticket_title: string | null;
};

export type EnrichedCurrentChangeFile = {
  attributionCount: number;
  file: GitStatusFile;
  path: string;
  primaryRationale: ChangeRationaleRecord | null;
  primaryTicket: TicketSummary | null;
  rationaleCount: number;
  rationales: ChangeRationaleRecord[];
  summary: string;
  tickets: TicketSummary[];
};
