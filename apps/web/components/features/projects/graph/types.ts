import type { Json } from '@/types/database.types';

export interface GraphTicketData {
  id: string;
  ticket_id: string;
  title: string;
  status: string;
  project_id: string;
  status_type: string | null;
}

export interface GraphFileChangeRecord {
  id: string;
  file_name: string;
  file_path: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  change_kind: string;
  attribution_source: string;
  confidence: string;
  hunks: Json;
  created_at: string;
  updated_at: string;
  ticket_id: string;
  event_id: string;
  session_id: string;
  checkpoint_id: string | null;
  objective_id: string | null;
  ticket: GraphTicketData | null;
  event: {
    id: string;
    event_type: string;
    summary: string | null;
    created_at: string;
  } | null;
  session: {
    id: string;
    agent_identifier: string;
  } | null;
  checkpoint: {
    id: string;
    checkpoint_kind: string;
    created_at: string;
    diff_stat: string | null;
    git_commit_id: string | null;
    git_ref_name: string | null;
    head_sha: string | null;
  } | null;
  objective: {
    id: string;
    objective: string | null;
  } | null;
}

export interface GraphApiResponse {
  fileChanges: GraphFileChangeRecord[];
  tickets: GraphTicketData[];
}

export interface TicketNodeData {
  type: 'ticket';
  ticketId: string;
  shortId: string;
  title: string;
  status: string;
  statusType: string | null;
  fileCount: number;
}

export interface FileNodeData {
  type: 'file';
  filePath: string;
  fileName: string;
  directory: string;
  ticketCount: number;
  changeKinds: string[];
  impacts: string[];
}

export interface RationaleEdgeData {
  fileChangeId: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  changeKind: string;
  confidence: string;
}

export interface CoChangeEdgeData {
  type: 'co-change';
  sharedFiles: string[];
  sharedFileCount: number;
}

export interface GraphFilters {
  changeKinds: Set<string>;
  impacts: Set<string>;
  directories: Set<string>;
  statusTypes: Set<string>;
  /** ISO timestamp upper bound; rationale edges newer than this are hidden. Null = no cap. */
  maxTime: string | null;
}

export type GraphMode = 'compare' | 'hotspot' | 'replay' | 'diff';

export interface HotspotRecord {
  file_path: string;
  file_name: string;
  ticket_count: number;
  rationale_count: number;
  high_impact_count: number;
  medium_impact_count: number;
  low_impact_count: number;
  impact_score: number;
  last_activity: string;
  ticket_ids: string[];
}

export interface HotspotApiResponse {
  hotspots: HotspotRecord[];
  windowDays: number;
}

export interface GraphPreferences {
  mode: GraphMode;
  hotspotWindowDays: number;
  filters: {
    changeKinds: string[];
    impacts: string[];
    directories: string[];
    statusTypes: string[];
  };
}

export const DEFAULT_HOTSPOT_WINDOW_DAYS = 90;

export function emptyFilters(): GraphFilters {
  return {
    changeKinds: new Set(),
    impacts: new Set(),
    directories: new Set(),
    statusTypes: new Set(),
    maxTime: null
  };
}

export function hasActiveFilters(filters: GraphFilters): boolean {
  return (
    filters.changeKinds.size > 0 ||
    filters.impacts.size > 0 ||
    filters.directories.size > 0 ||
    filters.statusTypes.size > 0 ||
    filters.maxTime !== null
  );
}

export const STATUS_TYPE_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  execute: '#3b82f6',
  review: '#f59e0b',
  complete: '#22c55e'
};

export const CHANGE_KIND_COLORS: Record<string, string> = {
  create: '#22c55e',
  modify: '#3b82f6',
  delete: '#ef4444',
  rename: '#a855f7',
  refactor: '#8b5cf6'
};

export const IMPACT_STROKE_WIDTH: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1
};
