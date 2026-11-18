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
  getMissionItem,
  linkSessionMissionItems,
  listMissionItems,
  type MissionItem,
  type MissionItemChangeAttribution,
  type MissionItemWriteProblem
} from './mission-items.js';
import {
  advanceMissionNarrativeEvidence,
  createDeliveryPublication,
  ensureMissionSummaryRow,
  isSummaryEnabled,
  type MissionNarrative,
  type NarrativeWithheldReason,
  readMissionNarrative,
  writeAgentNarrative
} from './mission-narrative.js';
import { MISSION_SUMMARY_LIMITS } from './mission-summary-evidence.js';
import { nowIso, sqlPlaceholders } from './util.js';
import { lockMissionSummaryRow } from './worker-jobs.js';

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
 * - Agent-only narrative (ADR 0076): every accepted delivery of a
 *   summary-eligible mission advances the narrative evidence basis and gets one
 *   publication opportunity. Inline prose publishes only when both
 *   `baseContentRevision` and `baseEvidenceRevision` match the pre-delivery
 *   state; stale, legacy (no evidence base) or absent prose never rejects the
 *   delivery: it is withheld and the opportunity stays outstanding for
 *   `publish-delivery-summary`. A skipped close entry only produces a warning.
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
  /** The narrative evidence basis; send it back as `baseEvidenceRevision`. */
  evidenceRevision: number;
  /** Server-derived freshness of the current headline and summary. */
  narrative: MissionNarrative;
  headline: string;
  summary: string;
  /** Who wrote the current headline and summary; null before the first write. */
  author: MissionSummaryAuthorKind | null;
  openItems: MissionSummaryBaselineItem[];
  totalOpenItems: number;
  /** Count only, attached execution context; draft observations excluded. */
  otherMissionOpenItems?: number;
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
  /** Absent from legacy clients: their prose is withheld, never published. */
  baseEvidenceRevision: number | null;
  narrative: { headline: string; summary: string } | null;
  closeItems: MissionSummaryCloseEntry[];
};

export type MissionSummaryWarning = {
  code:
    | 'mission_summary_item_skipped'
    | 'mission_summary_style'
    | 'mission_summary_disabled'
    | 'mission_summary_withheld';
  message: string;
  itemId?: string;
  problem?: MissionItemWriteProblem | 'duplicate';
  currentStatus?: MissionItem['status'];
  resolvedBy?: MissionItem['resolvedBy'];
  rule?: string;
  excerpt?: string;
  suggestion?: string;
};

/** The publication opportunity an accepted delivery received, as of acceptance. */
export type MissionSummaryPublicationRef = {
  id: string;
  /** True while it can still be published (the inline prose was withheld or absent). */
  available: boolean;
  /** Why inline prose was not published; null when it was. */
  withheldReason: NarrativeWithheldReason | null;
};

/** Outcome of a `missionSummary` write, returned on deliver and record-work. */
export type MissionSummaryWriteResult = {
  /** `content_revision` after the write; null when the mission has no summary. */
  contentRevision: number | null;
  narrativeWritten: boolean;
  closedItemIds: string[];
  warnings: MissionSummaryWarning[];
  targets?: { missionDisplayId: string; closed: number }[];
  /** Eligible accepted deliveries only. Absent for close-only writes. */
  publication?: MissionSummaryPublicationRef;
  /** Fresh editing baseline after acceptance, for reconciliation. */
  baseline?: MissionSummaryBaseline;
};

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
    evidence_revision: number | string;
    headline: string;
    summary_markdown: string;
    generated_by: string;
  }>(
    `SELECT content_revision, evidence_revision, headline, summary_markdown, generated_by
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
  const narrative = await readMissionNarrative(db, missionId);
  const { items, truncated, total } = await listMissionItems(db, {
    missionId,
    limit: MISSION_SUMMARY_BASELINE_ITEM_LIMIT,
    order: 'blocking'
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
    evidenceRevision: Number(row?.evidence_revision ?? 0),
    narrative,
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
    totalOpenItems: total,
    truncated
  };
}

const INPUT_KEYS = new Set([
  'baseContentRevision',
  'baseEvidenceRevision',
  'headline',
  'summary',
  'closeItems'
]);
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
  let baseEvidenceRevision: number | null = null;
  if (input.baseEvidenceRevision !== undefined && input.baseEvidenceRevision !== null) {
    const base = input.baseEvidenceRevision;
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) {
      throw invalidInput('baseEvidenceRevision must be a non-negative integer');
    }
    baseEvidenceRevision = base;
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
  return { baseContentRevision, baseEvidenceRevision, narrative, closeItems };
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

type MissionScope = { id: string; workspaceId: string; projectId: string };

/**
 * How a write uses the narrative basis: `deliver` checks both bases,
 * `record_work` publishes on its new mission without a base, and `close_only`
 * (live-session closes) never touches narrative or evidence.
 */
export type MissionSummaryWriteMode = 'deliver' | 'record_work' | 'close_only';

/** A prepared write: the summary row is locked and the inline decision is made. */
export type PreparedMissionSummaryWrite = {
  input: MissionSummaryWriteInput | null;
  mode: MissionSummaryWriteMode;
  enabled: boolean;
  created: boolean;
  /** Null when inline prose will publish; otherwise why not (eligible deliveries only). */
  withheldReason: NarrativeWithheldReason | null;
};

/**
 * First step inside the delivery transaction, after the mission lock and
 * before any delivery row is written. For an eligible delivery it ensures the
 * summary row, takes its lock and compares both bases with the pre-delivery
 * state (R1): inline prose publishes only when `baseContentRevision` and
 * `baseEvidenceRevision` both match. A mismatch, a missing evidence base or
 * absent prose never throws; the delivery is accepted and its prose withheld.
 */
export async function prepareMissionSummaryWrite(
  tx: DatabaseClient,
  {
    mission,
    input,
    mode,
    now = nowIso()
  }: {
    mission: MissionScope;
    input: MissionSummaryWriteInput | null;
    mode: MissionSummaryWriteMode;
    now?: string;
  }
): Promise<PreparedMissionSummaryWrite> {
  const row = await tx.get<{ summary_enabled: unknown }>(
    `SELECT summary_enabled FROM missions WHERE id = ?`,
    [mission.id]
  );
  const enabled = isSummaryEnabled(row?.summary_enabled);
  if (!enabled || mode === 'close_only') {
    return { input, mode, enabled, created: false, withheldReason: null };
  }

  const { created } = await ensureMissionSummaryRow(tx, mission, now);
  const current = await lockMissionSummaryRow(tx, mission.id);
  let withheldReason: NarrativeWithheldReason | null = null;
  if (!input?.narrative) {
    withheldReason = 'absent';
  } else if (mode === 'deliver') {
    if (input.baseContentRevision !== (current?.content_revision ?? 0)) {
      withheldReason = 'stale_content';
    } else if (input.baseEvidenceRevision === null) {
      withheldReason = 'missing_evidence_base';
    } else if (input.baseEvidenceRevision !== (current?.evidence_revision ?? 0)) {
      withheldReason = 'stale_evidence';
    }
  }
  return { input, mode, enabled, created, withheldReason };
}

const WITHHELD_MESSAGES: Record<Exclude<NarrativeWithheldReason, 'absent'>, string> = {
  stale_content:
    'The mission summary changed since your baseline (baseContentRevision is stale), so your headline and summary were not published.',
  stale_evidence:
    'Other accepted work changed the mission since your baseline (baseEvidenceRevision is stale), so your headline and summary were not published.',
  missing_evidence_base:
    'The headline and summary were sent without baseEvidenceRevision, so they could not be verified against the current mission and were not published.'
};

const SKIP_MESSAGES: Record<MissionItemWriteProblem | 'duplicate', string> = {
  not_found: 'no item has this id',
  other_mission: 'the item belongs to another mission',
  forbidden: 'mission:update permission is required on the target',
  restored_by_person: 'a person restored this item; only a person or its own mission may close it',
  not_open: 'the item is no longer open',
  superseded: 'the item was superseded by a later delivery of its objective',
  duplicate: 'the id is listed more than once'
};

/**
 * What the agent does about a skipped close entry (plan coo:1294 D6): the
 * warning carries its own instruction, so attach does not have to.
 */
const STAYS_OPEN = 'Say in your final message which item stays open and why.';
const SKIP_ACTIONS: Record<MissionItemWriteProblem | 'duplicate', string> = {
  not_found: `If you meant an open item of this mission, it stays open. ${STAYS_OPEN}`,
  forbidden: STAYS_OPEN,
  restored_by_person: STAYS_OPEN,
  other_mission: `If you meant an open item of this mission, it stays open. ${STAYS_OPEN}`,
  not_open: 'No action is needed.',
  superseded: `Its replacement from the later delivery may still be open. ${STAYS_OPEN}`,
  duplicate: 'The first entry applies; no action is needed.'
};

/**
 * Second step inside the delivery transaction, after the delivery and its
 * items are written: closes the listed open items of this mission with agent
 * provenance. For an eligible delivery it then advances the narrative evidence
 * basis (superseding older outstanding opportunities), creates this delivery's
 * publication row, and publishes the inline prose when the prepare step
 * allowed it. Skipped close entries and withheld prose are bounded warnings
 * and never reject the delivery.
 */
export async function applyMissionSummaryWrite(
  tx: DatabaseClient,
  {
    prepared,
    mission,
    objectiveId,
    deliveryId,
    sessionId = null,
    canCloseForeign = false,
    model,
    attribution,
    now = nowIso()
  }: {
    prepared: PreparedMissionSummaryWrite;
    mission: MissionScope;
    objectiveId: string;
    deliveryId: string | null;
    sessionId?: string | null;
    canCloseForeign?: boolean;
    model: string | null;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<MissionSummaryWriteResult> {
  const { input, enabled, mode } = prepared;
  const warnings: MissionSummaryWarning[] = [];
  const closedItemIds: string[] = [];
  const seen = new Set<string>();
  const targets = new Map<string, number>();

  for (const entry of input?.closeItems ?? []) {
    let problem: MissionItemWriteProblem | 'duplicate' | null = null;
    let current: MissionItem | null = null;
    if (seen.has(entry.id)) {
      problem = 'duplicate';
    } else {
      seen.add(entry.id);
      const item = await getMissionItem(tx, entry.id);
      const target = item
        ? await tx.get<{ display_id: string }>(
            `SELECT m.display_id FROM missions m
        JOIN deliveries d ON d.id = ? AND d.deleted_at IS NULL
        WHERE m.id = ? AND m.workspace_id = ? AND m.project_id = ? AND m.deleted_at IS NULL`,
            [item.deliveryId, item.missionId, mission.workspaceId, mission.projectId]
          )
        : undefined;
      if (
        !item ||
        !target ||
        item.workspaceId !== mission.workspaceId ||
        item.projectId !== mission.projectId
      ) {
        problem = 'not_found';
      } else if (item.missionId !== mission.id && !canCloseForeign) {
        problem = 'forbidden';
      } else {
        const result = await closeMissionItem(tx, {
          itemId: entry.id,
          missionId: item.missionId,
          status: entry.status,
          reason: entry.reason,
          resolver: { kind: 'agent', objectiveId, deliveryId, missionId: mission.id, sessionId },
          attribution,
          now
        });
        if (result.ok) {
          closedItemIds.push(entry.id);
          if (item.missionId !== mission.id)
            targets.set(target.display_id, (targets.get(target.display_id) ?? 0) + 1);
        } else {
          problem = result.problem;
          current = result.item;
        }
      }
    }
    if (problem !== null) {
      warnings.push({
        code: 'mission_summary_item_skipped',
        itemId: cut(entry.id, 80),
        problem,
        ...(current ? { currentStatus: current.status, resolvedBy: current.resolvedBy } : {}),
        message: `Item ${cut(entry.id, 80)} was not closed: ${SKIP_MESSAGES[problem]}. ${SKIP_ACTIONS[problem]}`
      });
    }
  }

  if (mode === 'deliver' && deliveryId && sessionId) {
    await linkSessionMissionItems(tx, {
      sessionId,
      missionId: mission.id,
      workspaceId: mission.workspaceId,
      projectId: mission.projectId,
      deliveryId,
      attribution,
      now
    });
  }
  let contentRevision: number | null = null;
  let narrativeWritten = false;
  let publication: MissionSummaryPublicationRef | undefined;
  if (input?.narrative && !enabled) {
    warnings.push({
      code: 'mission_summary_disabled',
      message: 'This mission has no summary, so the headline and summary were not stored.'
    });
  } else if (enabled && mode !== 'close_only' && deliveryId) {
    const advanced = await advanceMissionNarrativeEvidence(tx, {
      mission,
      reason: 'delivery',
      attribution,
      now
    });
    const evidenceRevision = advanced?.evidenceRevision ?? 0;
    const created = await createDeliveryPublication(tx, {
      mission,
      objectiveId,
      deliveryId,
      actorWorkspaceUserId: attribution.actorWorkspaceUserId,
      sessionId,
      evidenceRevision,
      proposal: input?.narrative ?? null,
      withheldReason: prepared.withheldReason,
      now
    });
    if (prepared.withheldReason === null && input?.narrative) {
      const written = await writeAgentNarrative(tx, {
        mission,
        narrative: input.narrative,
        deliveryId,
        objectiveId,
        model,
        evidenceRevision,
        publicationId: created.id,
        publishOperation: null,
        attribution,
        created: prepared.created,
        now
      });
      narrativeWritten = true;
      contentRevision = written.contentRevision;
      warnings.push(...missionSummaryStyleWarnings(input.narrative));
    } else if (
      input?.narrative &&
      prepared.withheldReason &&
      prepared.withheldReason !== 'absent'
    ) {
      warnings.push({
        code: 'mission_summary_withheld',
        message: `${WITHHELD_MESSAGES[prepared.withheldReason]} The delivery and item closes were accepted. Read the current summary and publish once for this delivery.`
      });
    }
    publication = {
      id: created.id,
      available: !narrativeWritten,
      withheldReason: prepared.withheldReason
    };
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
    targets: [...targets]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([missionDisplayId, closed]) => ({ missionDisplayId, closed })),
    warnings: warnings.slice(0, MISSION_SUMMARY_MAX_WARNINGS),
    ...(publication ? { publication } : {})
  };
}
