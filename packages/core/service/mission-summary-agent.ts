import { lintSte } from '@overlord/automations';
import { formatObjectiveDisplayId } from '@overlord/contract';
import {
  type DatabaseClient,
  MISSION_ITEM_CLOSED_STATUSES,
  MISSION_ITEM_STATUS_REASON_MAX_LENGTH,
  type MissionItemClosedStatus,
  type MissionItemKind
} from '@overlord/database';

import { ServiceError } from './errors.js';
import {
  closeMissionItem,
  listMissionItems,
  type MissionItemChangeAttribution,
  type MissionItemWriteProblem
} from './mission-items.js';
import { MISSION_SUMMARY_LIMITS } from './mission-summary-compose.js';
import { nowIso, sqlPlaceholders } from './util.js';
import { lockMissionSummaryRow, recordMissionSummaryChange } from './worker-jobs.js';

/**
 * The agent-facing mission summary surface (coo:1260, ADR 0060, plan 3.2-3.4).
 *
 * - Attach and resume-follow-up return an editing baseline: the current
 *   headline and summary, the `content_revision` concurrency token, and a
 *   capped list of the mission's open items with their ids.
 * - Deliver and record-work accept `missionSummary`: a replacement headline and
 *   summary, written with `generated_by = 'agent'`, and `closeItems` that close
 *   this mission's open items with agent provenance. Both are written in the
 *   delivery transaction under the summary row lock.
 * - A stale `baseContentRevision` rejects the whole delivery with 409
 *   `mission_summary_conflict` and a fresh baseline. A skipped close entry only
 *   produces a warning.
 */

/** Open items returned in the attach baseline, at most this many. */
export const MISSION_SUMMARY_BASELINE_ITEM_LIMIT = 60;
/** Item text in the baseline is cut to this many characters. */
export const MISSION_SUMMARY_BASELINE_ITEM_TEXT_MAX = 400;
/** `closeItems` entries accepted in one delivery. */
export const MISSION_SUMMARY_CLOSE_ITEMS_MAX = 50;
/** Advisory style warnings returned for the prose, at most this many. */
export const MISSION_SUMMARY_MAX_STYLE_WARNINGS = 10;
/** Every warning returned for one write, at most this many. */
export const MISSION_SUMMARY_MAX_WARNINGS = 30;

export type MissionSummaryAuthorKind = 'agent' | 'gemini' | 'deterministic';

export type MissionSummaryBaselineItem = {
  id: string;
  kind: MissionItemKind;
  /** Display id of the objective whose delivery reported the item. */
  objective: string | null;
  text: string;
  /** Human actions only. */
  blocking?: boolean;
};

/** The editing baseline: the attach shape and the conflict body. */
export type MissionSummaryBaseline = {
  contentRevision: number;
  headline: string;
  summary: string;
  /** Who wrote the current headline and summary; null before the first write. */
  author: MissionSummaryAuthorKind | null;
  openItems: MissionSummaryBaselineItem[];
  /** More open items exist than `openItems` carries. */
  truncated: boolean;
};

export type MissionSummaryCloseEntry = {
  id: string;
  status: MissionItemClosedStatus;
  reason: string;
};

/** Validated `missionSummary` delivery input. */
export type MissionSummaryWriteInput = {
  baseContentRevision: number | null;
  narrative: { headline: string; summary: string } | null;
  closeItems: MissionSummaryCloseEntry[];
};

export type MissionSummaryWarning = {
  code: 'mission_summary_item_skipped' | 'mission_summary_style' | 'mission_summary_disabled';
  message: string;
  itemId?: string;
  rule?: string;
  excerpt?: string;
  suggestion?: string;
};

/** Outcome of a `missionSummary` write, returned on deliver and record-work. */
export type MissionSummaryWriteResult = {
  /** `content_revision` after the write; null when the mission has no summary. */
  contentRevision: number | null;
  narrativeWritten: boolean;
  closedItemIds: string[];
  warnings: MissionSummaryWarning[];
};

function isSummaryEnabled(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

function invalidInput(message: string): ServiceError {
  return new ServiceError(`missionSummary: ${message}`, 'invalid_input', 400);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The attach baseline for one mission, or null when the mission has no
 * summary (`summary_enabled` false, or the mission does not exist).
 */
export async function readMissionSummaryBaseline(
  db: DatabaseClient,
  missionId: string
): Promise<MissionSummaryBaseline | null> {
  const mission = await db.get<{ summary_enabled: unknown; display_id: string }>(
    `SELECT summary_enabled, display_id FROM missions WHERE id = ? AND deleted_at IS NULL`,
    [missionId]
  );
  if (!mission || !isSummaryEnabled(mission.summary_enabled)) return null;

  const row = await db.get<{
    content_revision: number | string;
    headline: string;
    summary_markdown: string;
    generated_by: string;
  }>(
    `SELECT content_revision, headline, summary_markdown, generated_by
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
  const { items, truncated } = await listMissionItems(db, {
    missionId,
    limit: MISSION_SUMMARY_BASELINE_ITEM_LIMIT
  });
  const objectiveIds = [...new Set(items.map(item => item.objectiveId))];
  const keys = new Map<string, string>();
  if (objectiveIds.length > 0) {
    const rows = await db.all<{ id: string; display_key: string }>(
      `SELECT id, display_key FROM objectives WHERE id IN (${sqlPlaceholders(objectiveIds.length)})`,
      objectiveIds
    );
    for (const objective of rows) {
      keys.set(
        objective.id,
        formatObjectiveDisplayId({
          missionDisplayId: mission.display_id,
          displayKey: objective.display_key
        })
      );
    }
  }

  const hasProse = Boolean(row && (row.headline.trim() || row.summary_markdown.trim()));
  return {
    contentRevision: Number(row?.content_revision ?? 0),
    headline: row?.headline ?? '',
    summary: row?.summary_markdown ?? '',
    author: hasProse ? (row!.generated_by as MissionSummaryAuthorKind) : null,
    openItems: items.map(item => ({
      id: item.id,
      kind: item.kind,
      objective: keys.get(item.objectiveId) ?? null,
      text: cut(item.text, MISSION_SUMMARY_BASELINE_ITEM_TEXT_MAX),
      ...(item.kind === 'human_action' ? { blocking: item.detail.blocking === true } : {})
    })),
    truncated
  };
}

const INPUT_KEYS = new Set(['baseContentRevision', 'headline', 'summary', 'closeItems']);
const CLOSE_KEYS = new Set(['id', 'status', 'reason']);

/**
 * Validates `missionSummary` before any write. Throws 400 `invalid_input` for
 * a malformed object, over-long or partial prose, a missing base revision when
 * prose is written, or a close entry without a valid status and reason.
 * Returns null when the input is absent or carries nothing to write.
 */
export function parseMissionSummaryInput(
  value: unknown,
  { requireBase }: { requireBase: boolean }
): MissionSummaryWriteInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInput('must be an object');
  }
  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter(key => !INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw invalidInput(`unsupported field(s): ${unknownKeys.join(', ')}`);
  }

  let baseContentRevision: number | null = null;
  if (input.baseContentRevision !== undefined && input.baseContentRevision !== null) {
    const base = input.baseContentRevision;
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) {
      throw invalidInput('baseContentRevision must be a non-negative integer');
    }
    baseContentRevision = base;
  }

  const hasHeadline = input.headline !== undefined && input.headline !== null;
  const hasSummary = input.summary !== undefined && input.summary !== null;
  let narrative: MissionSummaryWriteInput['narrative'] = null;
  if (hasHeadline || hasSummary) {
    if (!hasHeadline || !hasSummary) {
      throw invalidInput('headline and summary must be sent together');
    }
    if (typeof input.headline !== 'string' || typeof input.summary !== 'string') {
      throw invalidInput('headline and summary must be strings');
    }
    const headline = input.headline.trim();
    const summary = input.summary.trim();
    if (!headline) throw invalidInput('headline must not be empty');
    if (!summary) throw invalidInput('summary must not be empty');
    if (/[\r\n]/.test(headline)) throw invalidInput('headline must be one line');
    if (headline.length > MISSION_SUMMARY_LIMITS.headline) {
      throw invalidInput(
        `headline must be at most ${MISSION_SUMMARY_LIMITS.headline} characters (got ${headline.length})`
      );
    }
    if (summary.length > MISSION_SUMMARY_LIMITS.summary) {
      throw invalidInput(
        `summary must be at most ${MISSION_SUMMARY_LIMITS.summary} characters (got ${summary.length})`
      );
    }
    if (requireBase && baseContentRevision === null) {
      throw invalidInput(
        'baseContentRevision is required with headline and summary; use missionSummary.contentRevision from attach'
      );
    }
    narrative = { headline, summary };
  }

  const closeItems: MissionSummaryCloseEntry[] = [];
  if (input.closeItems !== undefined && input.closeItems !== null) {
    if (!Array.isArray(input.closeItems)) throw invalidInput('closeItems must be an array');
    if (input.closeItems.length > MISSION_SUMMARY_CLOSE_ITEMS_MAX) {
      throw invalidInput(`closeItems accepts at most ${MISSION_SUMMARY_CLOSE_ITEMS_MAX} entries`);
    }
    input.closeItems.forEach((entry: unknown, index) => {
      const where = `closeItems[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw invalidInput(`${where} must be an object { id, status, reason }`);
      }
      const record = entry as Record<string, unknown>;
      const extra = Object.keys(record).filter(key => !CLOSE_KEYS.has(key));
      if (extra.length > 0)
        throw invalidInput(`${where} has unsupported field(s): ${extra.join(', ')}`);
      if (typeof record.id !== 'string' || !record.id.trim()) {
        throw invalidInput(`${where}.id must be an item id from the attach baseline`);
      }
      if (
        typeof record.status !== 'string' ||
        !(MISSION_ITEM_CLOSED_STATUSES as readonly string[]).includes(record.status)
      ) {
        throw invalidInput(`${where}.status must be 'done' or 'dismissed'`);
      }
      const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
      if (!reason) throw invalidInput(`${where}.reason is required`);
      if (reason.length > MISSION_ITEM_STATUS_REASON_MAX_LENGTH) {
        throw invalidInput(
          `${where}.reason must be at most ${MISSION_ITEM_STATUS_REASON_MAX_LENGTH} characters`
        );
      }
      closeItems.push({
        id: record.id.trim(),
        status: record.status as MissionItemClosedStatus,
        reason
      });
    });
  }

  if (!narrative && closeItems.length === 0) return null;
  return { baseContentRevision, narrative, closeItems };
}

/** Advisory Simplified Technical English warnings for agent prose. Never blocking. */
export function missionSummaryStyleWarnings(narrative: {
  headline: string;
  summary: string;
}): MissionSummaryWarning[] {
  return [...lintSte(narrative.headline), ...lintSte(narrative.summary)]
    .slice(0, MISSION_SUMMARY_MAX_STYLE_WARNINGS)
    .map(issue => ({
      code: 'mission_summary_style' as const,
      rule: issue.code,
      message: issue.message,
      ...('excerpt' in issue && issue.excerpt ? { excerpt: cut(issue.excerpt, 300) } : {}),
      ...('suggestion' in issue && issue.suggestion ? { suggestion: issue.suggestion } : {})
    }));
}

/**
 * Raised inside the delivery transaction when the base revision is stale. The
 * caller rolls back, reads a fresh baseline and rethrows it with
 * {@link missionSummaryConflictError}, so the baseline never shows rows of the
 * rejected delivery.
 */
export class MissionSummaryConflict extends Error {
  constructor(
    readonly missionId: string,
    readonly baseContentRevision: number,
    readonly currentContentRevision: number
  ) {
    super('mission_summary_conflict');
    this.name = 'MissionSummaryConflict';
  }
}

/** The 409 returned to the agent: nothing was written; reconcile and retry once. */
export async function missionSummaryConflictError(
  db: DatabaseClient,
  conflict: MissionSummaryConflict
): Promise<ServiceError> {
  const baseline = await readMissionSummaryBaseline(db, conflict.missionId);
  return new ServiceError(
    `The mission summary changed since you attached (base content revision ${conflict.baseContentRevision}, current ${conflict.currentContentRevision}). Nothing was delivered. Rewrite the headline and summary from details.missionSummary and deliver again with its contentRevision as baseContentRevision; if this happens twice, deliver without headline and summary.`,
    'mission_summary_conflict',
    409,
    {
      baseContentRevision: conflict.baseContentRevision,
      missionSummary: baseline
    }
  );
}

type MissionScope = { id: string; workspaceId: string; projectId: string };

/** A prepared write: the base check passed and the summary row is locked. */
export type PreparedMissionSummaryWrite = {
  input: MissionSummaryWriteInput;
  enabled: boolean;
  created: boolean;
};

/**
 * First step inside the delivery transaction, before any delivery row is
 * written. When prose is sent to a summary-enabled mission, ensures the summary
 * row exists, takes its lock and compares `baseContentRevision` (when
 * `checkBase`). A stale base throws {@link MissionSummaryConflict}.
 */
export async function prepareMissionSummaryWrite(
  tx: DatabaseClient,
  {
    mission,
    input,
    checkBase,
    now = nowIso()
  }: {
    mission: MissionScope;
    input: MissionSummaryWriteInput;
    checkBase: boolean;
    now?: string;
  }
): Promise<PreparedMissionSummaryWrite> {
  const row = await tx.get<{ summary_enabled: unknown }>(
    `SELECT summary_enabled FROM missions WHERE id = ?`,
    [mission.id]
  );
  const enabled = isSummaryEnabled(row?.summary_enabled);
  if (!enabled || !input.narrative) return { input, enabled, created: false };

  // The shell insert serializes two first writers on the primary key; the
  // second then locks the row the first committed and sees its revision.
  const inserted = await tx.run(
    `INSERT INTO mission_summaries
         (mission_id, workspace_id, project_id, revision, requested_generation,
          completed_generation, status, headline, summary_markdown,
          source_delivery_id, generated_by, generated_at, model, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, 0, 'composed', '', '', NULL, 'deterministic', NULL, NULL, ?, ?)
       ON CONFLICT (mission_id) DO NOTHING`,
    [mission.id, mission.workspaceId, mission.projectId, now, now]
  );
  await lockMissionSummaryRow(tx, mission.id);
  if (checkBase && input.baseContentRevision !== null) {
    const current = await tx.get<{ content_revision: number | string }>(
      `SELECT content_revision FROM mission_summaries WHERE mission_id = ?`,
      [mission.id]
    );
    const currentRevision = Number(current?.content_revision ?? 0);
    if (currentRevision !== input.baseContentRevision) {
      throw new MissionSummaryConflict(mission.id, input.baseContentRevision, currentRevision);
    }
  }
  return { input, enabled, created: inserted.changes > 0 };
}

const SKIP_MESSAGES: Record<MissionItemWriteProblem | 'duplicate', string> = {
  not_found: 'no item has this id',
  other_mission: 'the item belongs to another mission',
  not_open: 'the item is no longer open',
  superseded: 'the item was superseded by a later delivery of its objective',
  duplicate: 'the id is listed more than once'
};

/**
 * Second step inside the delivery transaction, after the delivery and its
 * items are written: closes the listed open items of this mission with agent
 * provenance, then writes the narrative (`generated_by = 'agent'`,
 * `narrative_*`, `content_revision + 1`). Skipped close entries become bounded
 * warnings and never reject the delivery.
 */
export async function applyMissionSummaryWrite(
  tx: DatabaseClient,
  {
    prepared,
    mission,
    objectiveId,
    deliveryId,
    model,
    attribution,
    now = nowIso()
  }: {
    prepared: PreparedMissionSummaryWrite;
    mission: MissionScope;
    objectiveId: string;
    deliveryId: string;
    model: string | null;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<MissionSummaryWriteResult> {
  const { input, enabled } = prepared;
  const warnings: MissionSummaryWarning[] = [];
  const closedItemIds: string[] = [];
  const seen = new Set<string>();

  for (const entry of input.closeItems) {
    let problem: MissionItemWriteProblem | 'duplicate' | null = null;
    if (seen.has(entry.id)) {
      problem = 'duplicate';
    } else {
      seen.add(entry.id);
      const result = await closeMissionItem(tx, {
        itemId: entry.id,
        missionId: mission.id,
        status: entry.status,
        reason: entry.reason,
        resolver: { kind: 'agent', objectiveId, deliveryId },
        attribution,
        now
      });
      if (result.ok) closedItemIds.push(entry.id);
      else problem = result.problem;
    }
    if (problem !== null) {
      warnings.push({
        code: 'mission_summary_item_skipped',
        itemId: cut(entry.id, 80),
        message: `Item ${cut(entry.id, 80)} was not closed: ${SKIP_MESSAGES[problem]}.`
      });
    }
  }

  let contentRevision: number | null = null;
  let narrativeWritten = false;
  if (input.narrative && !enabled) {
    warnings.push({
      code: 'mission_summary_disabled',
      message: 'This mission has no summary, so the headline and summary were not stored.'
    });
  } else if (input.narrative) {
    const updated = await tx.get<{ revision: number | string; content_revision: number | string }>(
      `UPDATE mission_summaries
          SET status = 'composed', headline = ?, summary_markdown = ?,
              source_delivery_id = ?, generated_by = 'agent', generated_at = ?, model = ?,
              narrative_delivery_id = ?, narrative_objective_id = ?,
              content_revision = content_revision + 1, revision = revision + 1,
              completed_generation = requested_generation, updated_at = ?
        WHERE mission_id = ?
        RETURNING revision, content_revision`,
      [
        input.narrative.headline,
        input.narrative.summary,
        deliveryId,
        now,
        model,
        deliveryId,
        objectiveId,
        now,
        mission.id
      ]
    );
    if (updated) {
      narrativeWritten = true;
      contentRevision = Number(updated.content_revision);
      await recordMissionSummaryChange(tx, {
        workspaceId: mission.workspaceId,
        projectId: mission.projectId,
        missionId: mission.id,
        revision: Number(updated.revision),
        operation: prepared.created ? 'insert' : 'update',
        changedFields: [
          'status',
          'headline',
          'summary_markdown',
          'generated_by',
          'content_revision',
          'narrative_delivery_id',
          'narrative_objective_id'
        ],
        actorWorkspaceUserId: attribution.actorWorkspaceUserId,
        actorTokenId: attribution.actorTokenId ?? null,
        source: attribution.source
      });
      warnings.push(...missionSummaryStyleWarnings(input.narrative));
    }
  }
  if (contentRevision === null && enabled) {
    const row = await tx.get<{ content_revision: number | string }>(
      `SELECT content_revision FROM mission_summaries WHERE mission_id = ?`,
      [mission.id]
    );
    contentRevision = row ? Number(row.content_revision) : 0;
  }

  return {
    contentRevision,
    narrativeWritten,
    closedItemIds,
    warnings: warnings.slice(0, MISSION_SUMMARY_MAX_WARNINGS)
  };
}
