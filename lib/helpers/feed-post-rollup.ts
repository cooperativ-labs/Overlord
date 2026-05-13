/**
 * Normalizes ticket rollup fields on feed_posts for UI rendering (web + mobile).
 * Shape is produced by supabase/functions/generate-feed-post.
 */

export type FeedRollupFileChange = {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  note?: string;
};

export type FeedRollupTradeoff = {
  decision: string;
  alternatives_considered: string;
  rationale: string;
};

export type FeedRollupObjectiveSection = {
  id: string;
  objective_id: string;
  index: number;
  title: string;
  state: string;
  position: number;
  duration: string | null;
  events: number;
  takeaway: string;
  body: string;
  file_changes: FeedRollupFileChange[];
  action_required: string[];
  tradeoffs: FeedRollupTradeoff[];
  event_ids: string[];
  updated_at: string | null;
  agent_identifier: string | null;
  model_identifier: string | null;
};

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sanitizeTradeoffs(raw: unknown): FeedRollupTradeoff[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedRollupTradeoff[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const decision = String(row.decision ?? '').trim();
    const alternatives = String(row.alternatives_considered ?? '').trim();
    const rationale = String(row.rationale ?? '').trim();
    if (!decision) continue;
    out.push({
      decision,
      alternatives_considered: alternatives,
      rationale
    });
  }
  return out.slice(0, 20);
}

function optionalTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function sanitizeFileChanges(raw: unknown): FeedRollupFileChange[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedRollupFileChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const path = String(row.path ?? '').trim();
    if (!path) continue;
    const status =
      String(row.status ?? 'modified')
        .trim()
        .toLowerCase() || 'modified';
    const noteRaw = optionalTrimmedString(row.note) ?? '';
    out.push({
      path,
      status,
      additions: numOrNull(row.additions),
      deletions: numOrNull(row.deletions),
      ...(noteRaw ? { note: noteRaw } : {})
    });
  }
  return out.slice(0, 200);
}

function sanitizeStringList(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeFeedRollupObjectiveSections(raw: unknown): FeedRollupObjectiveSection[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedRollupObjectiveSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const objectiveId = String(row.objective_id ?? '').trim();
    if (!objectiveId) continue;
    const id = String(row.id ?? '').trim() || objectiveId;
    const index = typeof row.index === 'number' && Number.isFinite(row.index) ? row.index : 0;
    const position =
      typeof row.position === 'number' && Number.isFinite(row.position) ? row.position : index;

    out.push({
      id,
      objective_id: objectiveId,
      index,
      title: String(row.title ?? '').trim() || 'Objective',
      state: String(row.state ?? '').trim() || 'unknown',
      position,
      duration: optionalTrimmedString(row.duration),
      events: typeof row.events === 'number' && Number.isFinite(row.events) ? row.events : 0,
      takeaway: String(row.takeaway ?? '').trim(),
      body: String(row.body ?? '').trim(),
      file_changes: sanitizeFileChanges(row.file_changes),
      action_required: sanitizeStringList(row.action_required, 50),
      tradeoffs: sanitizeTradeoffs(row.tradeoffs),
      event_ids: sanitizeStringList(row.event_ids, 200),
      updated_at: optionalTrimmedString(row.updated_at),
      agent_identifier: optionalTrimmedString(row.agent_identifier),
      model_identifier: optionalTrimmedString(row.model_identifier)
    });
  }

  return out.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    if (a.position !== b.position) return a.position - b.position;
    return a.title.localeCompare(b.title);
  });
}

export function normalizeFeedRollupOrphanFiles(raw: unknown): FeedRollupFileChange[] {
  return sanitizeFileChanges(raw).slice(0, 100);
}

export function feedPostUsesRollupStructuredUi(input: { objective_sections?: unknown }): boolean {
  return normalizeFeedRollupObjectiveSections(input.objective_sections).length > 0;
}

export function lastRollupObjectiveId(sections: FeedRollupObjectiveSection[]): string | null {
  if (sections.length === 0) return null;
  return sections[sections.length - 1]?.objective_id?.trim() || null;
}
