/**
 * Objective brief state (coo:1275, contract ADR 0057).
 *
 * An objective carries agent-facing instructions plus two presentation fields
 * for people: a title and a short summary. This module owns
 * the persistence rules for those presentation fields:
 *
 * - independent title and summary ownership (`*_source`);
 * - current-instruction authorship (`instruction_author_kind`), which decides
 *   whether an instruction write asks for an automatic summary;
 * - durable generation intent (`*_generation`, `*_status`,
 *   `summary_request_kind`), which a worker consumes and which guards
 *   publication against stale results;
 * - durable removal suppression (`summary_suppressed`).
 *
 * The planners are pure functions over a row snapshot, so the rules are tested
 * without a database. The service operations apply a plan inside one
 * transaction and append one change-feed row. Presentation writes never touch
 * `instruction_text`, `state`, lifecycle timestamps, execution evidence or
 * `updated_at` (which orders activity), so editing a summary after launch
 * cannot unlock an instruction edit or reorder the activity feed.
 *
 * This module does not call a model provider. A pending status is durable
 * intent; every write that leaves one pending enqueues the brief worker job
 * (`overlord.objective.brief.compose.v1`) in the same transaction, and the
 * worker publishes through {@link publishObjectiveBrief}.
 */
import {
  AI_TITLE_THRESHOLD,
  deriveTitleFromInstructionText,
  lintAuthoredObjectiveSummary
} from '@overlord/automations';
import { bindBool, type DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import { recordChange } from './change-feed.js';
import {
  type CreationOrigin,
  resolveObjectiveRef,
  resolveOrigin,
  type ServiceContext
} from './context.js';
import { ServiceError } from './errors.js';
import {
  assessObjectiveSummaryPlacement,
  OBJECTIVE_FIELDS_SWAPPED_CODE
} from './objective-summary-placement.js';
import { isTruthyFlag, jsonTextFieldSql, nowIso } from './util.js';
import {
  enqueueObjectiveBriefComposeJob,
  OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE
} from './worker-jobs.js';

export const OBJECTIVE_TITLE_SOURCES = ['generated', 'agent', 'user'] as const;
export const OBJECTIVE_SUMMARY_SOURCES = ['generated', 'agent', 'user'] as const;
export const OBJECTIVE_BRIEF_STATUSES = ['pending', 'failed'] as const;
export const OBJECTIVE_SUMMARY_REQUEST_KINDS = ['automatic', 'explicit'] as const;
export const OBJECTIVE_INSTRUCTION_AUTHOR_KINDS = ['human', 'agent', 'automation'] as const;
export const OBJECTIVE_SUMMARY_GENERATION_MODES = ['summarize', 'regenerate', 'retry'] as const;
/**
 * Stable failure codes a worker may record. Raw provider messages are never
 * stored or projected.
 */
export const OBJECTIVE_BRIEF_FAILURE_CODES = [
  'provider_unavailable',
  'provider_error',
  'invalid_output',
  'unfaithful_output'
] as const;

export type ObjectiveTitleSource = (typeof OBJECTIVE_TITLE_SOURCES)[number];
export type ObjectiveSummarySource = (typeof OBJECTIVE_SUMMARY_SOURCES)[number];
export type ObjectiveBriefStatus = (typeof OBJECTIVE_BRIEF_STATUSES)[number];
export type ObjectiveSummaryRequestKind = (typeof OBJECTIVE_SUMMARY_REQUEST_KINDS)[number];
export type ObjectiveInstructionAuthorKind = (typeof OBJECTIVE_INSTRUCTION_AUTHOR_KINDS)[number];
export type ObjectiveSummaryGenerationMode = (typeof OBJECTIVE_SUMMARY_GENERATION_MODES)[number];
export type ObjectiveBriefFailureCode = (typeof OBJECTIVE_BRIEF_FAILURE_CODES)[number];

/** Maximum stored summary length, in characters, after normalization. */
export const OBJECTIVE_SUMMARY_MAX_CHARS = 4000;
/**
 * Instructions shorter than this (trimmed, in characters) are already short
 * enough to read; they never get an automatic or requested summary.
 */
export const OBJECTIVE_SUMMARY_MIN_INSTRUCTION_CHARS = 280;

/** Who performs a write, derived from the service context origin. */
export type ObjectiveBriefActor = {
  kind: ObjectiveInstructionAuthorKind;
  workspaceUserId: string | null;
  /** Connector/agent identifier for agent actors, e.g. `claude-code`. */
  agent: string | null;
};

export function objectiveBriefActorFromContext(ctx: ServiceContext): ObjectiveBriefActor {
  const origin = resolveOrigin(ctx);
  return {
    kind: origin.kind,
    workspaceUserId: ctx.actorWorkspaceUserId,
    agent: origin.kind === 'agent' ? (origin.agent ?? null) : null
  };
}

export function objectiveBriefActorFromOrigin(
  origin: CreationOrigin,
  workspaceUserId: string | null
): ObjectiveBriefActor {
  return {
    kind: origin.kind,
    workspaceUserId,
    agent: origin.kind === 'agent' ? (origin.agent ?? null) : null
  };
}

/** The persisted brief columns of one objective row. */
export type ObjectiveBriefState = {
  title_source: ObjectiveTitleSource | null;
  title_generation: number;
  title_status: ObjectiveBriefStatus | null;
  summary: string | null;
  summary_source: ObjectiveSummarySource | null;
  summary_instruction_hash: string | null;
  summary_author_workspace_user_id: string | null;
  summary_author_agent: string | null;
  summary_updated_at: string | null;
  summary_revision: number;
  summary_suppressed: boolean;
  summary_generation: number;
  summary_status: ObjectiveBriefStatus | null;
  summary_request_kind: ObjectiveSummaryRequestKind | null;
  summary_failure_code: string | null;
  instruction_author_kind: ObjectiveInstructionAuthorKind | null;
};

export type ObjectiveBriefPatch = Partial<ObjectiveBriefState>;

export const OBJECTIVE_BRIEF_COLUMNS = [
  'title_source',
  'title_generation',
  'title_status',
  'summary',
  'summary_source',
  'summary_instruction_hash',
  'summary_author_workspace_user_id',
  'summary_author_agent',
  'summary_updated_at',
  'summary_revision',
  'summary_suppressed',
  'summary_generation',
  'summary_status',
  'summary_request_kind',
  'summary_failure_code',
  'instruction_author_kind'
] as const satisfies ReadonlyArray<keyof ObjectiveBriefState>;

/** Brief columns plus the fields the rules read from the rest of the row. */
export type ObjectiveBriefRow = ObjectiveBriefState & {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  instruction_text: string | null;
  title: string | null;
  revision: number;
  deleted_at: string | null;
};

/** Initial brief columns for a row that has no brief state yet. */
export const EMPTY_OBJECTIVE_BRIEF_STATE: ObjectiveBriefState = {
  title_source: null,
  title_generation: 0,
  title_status: null,
  summary: null,
  summary_source: null,
  summary_instruction_hash: null,
  summary_author_workspace_user_id: null,
  summary_author_agent: null,
  summary_updated_at: null,
  summary_revision: 0,
  summary_suppressed: false,
  summary_generation: 0,
  summary_status: null,
  summary_request_kind: null,
  summary_failure_code: null,
  instruction_author_kind: null
};

/** SHA-256 hex of the trimmed instruction text; null when blank. */
export function hashObjectiveInstruction(
  instructionText: string | null | undefined
): string | null {
  const trimmed = (instructionText ?? '').trim();
  if (!trimmed) return null;
  return createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

export function isSummaryEligibleInstruction(instructionText: string | null | undefined): boolean {
  return (instructionText ?? '').trim().length >= OBJECTIVE_SUMMARY_MIN_INSTRUCTION_CHARS;
}

/**
 * Instructions longer than this get a model-written title; shorter ones keep
 * the local title derived from the text (no provider call).
 */
export const OBJECTIVE_TITLE_MODEL_MIN_INSTRUCTION_CHARS = AI_TITLE_THRESHOLD + 1;

export function isTitleModelEligibleInstruction(
  instructionText: string | null | undefined
): boolean {
  return (instructionText ?? '').trim().length >= OBJECTIVE_TITLE_MODEL_MIN_INSTRUCTION_CHARS;
}

/** Brief work is outstanding for this row: the worker has something to do. */
export function objectiveBriefHasPendingWork(
  state: Pick<ObjectiveBriefState, 'title_status' | 'summary_status'>
): boolean {
  return state.title_status === 'pending' || state.summary_status === 'pending';
}

/** A summary is stale when it was written from different instruction text. */
export function isObjectiveSummaryStale(
  state: Pick<ObjectiveBriefState, 'summary' | 'summary_instruction_hash'>,
  instructionText: string | null | undefined
): boolean {
  if (state.summary === null) return false;
  return state.summary_instruction_hash !== hashObjectiveInstruction(instructionText);
}

/**
 * Normalized summary input on a create/update write.
 *
 * - `undefined` (field omitted): no summary change.
 * - `null` or a string that is empty after trimming: Remove — clear the text
 *   and suppress automatic summaries until a person explicitly asks for one.
 * - Any other string: set this text as authored by the caller.
 */
export type ObjectiveSummaryInput =
  | { kind: 'omit' }
  | { kind: 'remove' }
  | { kind: 'set'; text: string };

export function normalizeObjectiveSummaryInput(value: unknown): ObjectiveSummaryInput {
  if (value === undefined) return { kind: 'omit' };
  if (value === null) return { kind: 'remove' };
  if (typeof value !== 'string') {
    throw new ServiceError('summary must be a string or null', 'validation_error', 400);
  }
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) return { kind: 'remove' };
  if (text.length > OBJECTIVE_SUMMARY_MAX_CHARS) {
    throw new ServiceError(
      `summary must be at most ${OBJECTIVE_SUMMARY_MAX_CHARS} characters`,
      'summary_too_long',
      400,
      { maxLength: OBJECTIVE_SUMMARY_MAX_CHARS, length: text.length }
    );
  }
  return { kind: 'set', text };
}

/**
 * Non-fatal outcome of a write that the caller should surface.
 *
 * - `summary_suppressed`: a person removed the summary, so agent text was
 *   not stored.
 * - `summary_style`: advisory Simplified Technical English style issue in
 *   authored text (`rule` names the check). The text was stored as written.
 * - `objective_fields_swapped`: the summary looks like the instructions
 *   (see {@link assessObjectiveSummaryPlacement}). Both texts were stored;
 *   the guard never refuses a write.
 */
export type ObjectiveBriefWarning = {
  code: 'summary_suppressed' | 'summary_style' | 'objective_fields_swapped';
  message: string;
  rule?: string;
  excerpt?: string;
  suggestion?: string;
};

/** Style warnings returned for one authored summary, at most this many. */
export const OBJECTIVE_SUMMARY_MAX_STYLE_WARNINGS = 10;

/**
 * Advisory style warnings for an authored summary (plan §4.6). Never
 * rejects or rewrites the text; agents use them to improve their next write.
 */
export function objectiveSummaryStyleWarnings(text: string): ObjectiveBriefWarning[] {
  return lintAuthoredObjectiveSummary(text)
    .slice(0, OBJECTIVE_SUMMARY_MAX_STYLE_WARNINGS)
    .map(issue => ({
      code: 'summary_style' as const,
      rule: issue.code,
      message: issue.message,
      ...('excerpt' in issue && issue.excerpt ? { excerpt: issue.excerpt.slice(0, 300) } : {}),
      ...('suggestion' in issue && issue.suggestion ? { suggestion: issue.suggestion } : {})
    }));
}

/** The advisory `objective_fields_swapped` warning, when the texts may be swapped. */
export function objectiveSummaryPlacementWarnings(input: {
  instructions: string;
  summary: string;
}): ObjectiveBriefWarning[] {
  const placement = assessObjectiveSummaryPlacement(input);
  return placement.verdict === 'warn'
    ? [{ code: OBJECTIVE_FIELDS_SWAPPED_CODE, message: placement.message }]
    : [];
}

export type ObjectiveBriefPlan = {
  patch: ObjectiveBriefPatch;
  warnings: ObjectiveBriefWarning[];
  /** The write leaves a model-written title pending (title is system-owned). */
  titleRequested: boolean;
  /**
   * A local title the caller writes in the same statement: the title is
   * system-owned and the instructions are too short for a model title.
   */
  titleDerived: string | null;
  /** The write leaves a summary generation pending. */
  summaryRequested: boolean;
};

const SUPPRESSED_WARNING: ObjectiveBriefWarning = {
  code: 'summary_suppressed',
  message:
    'The summary was removed for this objective. An agent-written summary is not stored until a person selects Summarize.'
};

function emptyPlan(): ObjectiveBriefPlan {
  return {
    patch: {},
    warnings: [],
    titleRequested: false,
    titleDerived: null,
    summaryRequested: false
  };
}

/**
 * Ask for a system-owned title for `instruction`: a model title when the text
 * is long enough, otherwise a local title written in the same statement.
 */
function requestGeneratedTitle(plan: ObjectiveBriefPlan, instruction: string): void {
  if (isTitleModelEligibleInstruction(instruction)) {
    plan.patch.title_status = 'pending';
    plan.titleRequested = true;
    plan.titleDerived = null;
    return;
  }
  plan.patch.title_status = null;
  plan.titleRequested = false;
  plan.titleDerived = instruction ? deriveTitleFromInstructionText(instruction) : null;
}

function summarySourceFor(actor: ObjectiveBriefActor): ObjectiveSummarySource {
  return actor.kind === 'human' ? 'user' : 'agent';
}

function titleSourceFor(actor: ObjectiveBriefActor): ObjectiveTitleSource {
  return actor.kind === 'human' ? 'user' : 'agent';
}

const CLEARED_SUMMARY: ObjectiveBriefPatch = {
  summary: null,
  summary_source: null,
  summary_instruction_hash: null,
  summary_author_workspace_user_id: null,
  summary_author_agent: null
};

function setSummaryPatch(
  state: ObjectiveBriefState,
  text: string,
  actor: ObjectiveBriefActor,
  instructionText: string | null,
  now: string
): ObjectiveBriefPatch {
  return {
    summary: text,
    summary_source: summarySourceFor(actor),
    summary_instruction_hash: hashObjectiveInstruction(instructionText),
    summary_author_workspace_user_id: actor.workspaceUserId,
    summary_author_agent: actor.kind === 'human' ? null : actor.agent,
    summary_updated_at: now,
    summary_revision: state.summary_revision + 1,
    summary_generation: state.summary_generation + 1,
    summary_status: null,
    summary_request_kind: null,
    summary_failure_code: null
  };
}

function removeSummaryPatch(state: ObjectiveBriefState, now: string): ObjectiveBriefPatch {
  return {
    ...CLEARED_SUMMARY,
    summary_updated_at: now,
    summary_revision: state.summary_revision + 1,
    summary_suppressed: true,
    summary_generation: state.summary_generation + 1,
    summary_status: null,
    summary_request_kind: null,
    summary_failure_code: null
  };
}

/**
 * Apply an authored summary (set or remove) to a state snapshot. Agents
 * cannot store text while removal suppression is active; the caller receives
 * a warning instead of an error, so a batch write is not rejected.
 */
function planSummaryInput(
  state: ObjectiveBriefState,
  input: ObjectiveSummaryInput,
  actor: ObjectiveBriefActor,
  instructionText: string | null,
  now: string
): ObjectiveBriefPlan {
  const plan = emptyPlan();
  if (input.kind === 'omit') return plan;
  if (input.kind === 'remove') {
    plan.patch = removeSummaryPatch(state, now);
    return plan;
  }
  if (state.summary_suppressed && actor.kind !== 'human') {
    plan.warnings.push(SUPPRESSED_WARNING);
    return plan;
  }
  plan.patch = setSummaryPatch(state, input.text, actor, instructionText, now);
  return plan;
}

/**
 * Summary consequences of an instruction change when the same write
 * supplies no summary. The generation counter always moves, so no result
 * computed from the old text can publish.
 */
function planSummaryAfterInstructionChange(
  state: ObjectiveBriefState,
  nextInstruction: string,
  actor: ObjectiveBriefActor,
  now: string
): { patch: ObjectiveBriefPatch; requested: boolean } {
  const eligible = isSummaryEligibleInstruction(nextInstruction);
  const base: ObjectiveBriefPatch = {
    summary_generation: state.summary_generation + 1,
    summary_failure_code: null
  };
  const pending = (kind: ObjectiveSummaryRequestKind) => ({
    patch: { ...base, summary_status: 'pending' as const, summary_request_kind: kind },
    requested: true
  });
  const idle = (extra: ObjectiveBriefPatch = {}) => ({
    patch: { ...base, summary_status: null, summary_request_kind: null, ...extra },
    requested: false
  });

  // Removal suppression survives instruction edits. Any authored text stays as
  // stale metadata; nothing is generated.
  if (state.summary_suppressed) return idle();

  const explicitOutstanding =
    state.summary_status !== null && state.summary_request_kind === 'explicit';

  switch (state.summary_source) {
    case 'generated':
    case 'agent':
      // The text described instructions that no longer exist: regenerate while
      // the new text is still long enough, whoever made the edit. Otherwise the
      // instruction body is the readable text, so the old summary is cleared.
      if (eligible) return pending(explicitOutstanding ? 'explicit' : 'automatic');
      return idle({
        ...CLEARED_SUMMARY,
        summary_updated_at: now,
        summary_revision: state.summary_revision + 1
      });
    case 'user':
      // A person's text is never replaced automatically; it becomes stale.
      // An explicit Regenerate that was already outstanding continues.
      return explicitOutstanding && eligible ? pending('explicit') : idle();
    default:
      if (!eligible) return idle();
      if (explicitOutstanding) return pending('explicit');
      // Automatic summaries are only for agent/assistant-written instructions,
      // with or without an attached session.
      return actor.kind === 'agent' ? pending('automatic') : idle();
  }
}

/**
 * Plan the brief columns for a new objective.
 */
export function planObjectiveBriefForCreate({
  instructionText,
  titleProvided,
  summary,
  actor,
  now
}: {
  instructionText: string;
  titleProvided: boolean;
  summary: ObjectiveSummaryInput;
  actor: ObjectiveBriefActor;
  now: string;
}): ObjectiveBriefPlan {
  const instruction = instructionText.trim();
  const state = EMPTY_OBJECTIVE_BRIEF_STATE;
  // The caller writes the local title at create time; only a model title
  // stays pending.
  const titleRequested = !titleProvided && isTitleModelEligibleInstruction(instruction);
  const patch: ObjectiveBriefPatch = {
    title_source: titleProvided ? titleSourceFor(actor) : 'generated',
    instruction_author_kind: instruction ? actor.kind : null,
    ...(titleRequested ? { title_status: 'pending' as const } : {})
  };
  if (summary.kind !== 'omit') {
    const authored = planSummaryInput(state, summary, actor, instruction, now);
    return {
      patch: { ...patch, ...authored.patch },
      warnings: authored.warnings,
      titleRequested,
      titleDerived: null,
      summaryRequested: false
    };
  }
  const after = planSummaryAfterInstructionChange(state, instruction, actor, now);
  // A create has no previous result to invalidate, so the counter stays at 0.
  const summaryPatch: ObjectiveBriefPatch = { ...after.patch };
  delete summaryPatch.summary_generation;
  return {
    patch: { ...patch, ...summaryPatch },
    warnings: [],
    titleRequested,
    titleDerived: null,
    summaryRequested: after.requested
  };
}

/**
 * Plan the brief columns for an update write.
 *
 * `instructionText` is the new instruction when the write changes it, or
 * `undefined` when the write does not touch instructions. `title` follows the
 * same convention: `undefined` leaves the title alone, a string (possibly
 * empty) is an authored title edit.
 */
export function planObjectiveBriefForUpdate({
  state,
  currentInstruction,
  instructionText,
  title,
  summary,
  actor,
  now
}: {
  state: ObjectiveBriefState;
  currentInstruction: string | null;
  instructionText: string | undefined;
  title: string | null | undefined;
  summary: ObjectiveSummaryInput;
  actor: ObjectiveBriefActor;
  now: string;
}): ObjectiveBriefPlan {
  const plan = emptyPlan();
  const nextInstruction =
    instructionText === undefined ? (currentInstruction ?? '').trim() : instructionText.trim();
  const instructionChanged =
    instructionText !== undefined && nextInstruction !== (currentInstruction ?? '').trim();

  if (title !== undefined) {
    // An authored title is owned by its author. Clearing it hands the title
    // back to automation, which writes one now. Either way an in-flight
    // generated title is stale.
    const authored = (title ?? '').trim();
    plan.patch.title_source = authored ? titleSourceFor(actor) : 'generated';
    plan.patch.title_generation = state.title_generation + 1;
    plan.patch.title_status = null;
    if (!authored) requestGeneratedTitle(plan, nextInstruction);
  }

  if (instructionChanged) {
    plan.patch.instruction_author_kind = nextInstruction ? actor.kind : null;
    if (title === undefined) {
      plan.patch.title_generation = state.title_generation + 1;
      plan.patch.title_status = null;
      if (state.title_source === 'generated' && nextInstruction) {
        requestGeneratedTitle(plan, nextInstruction);
      }
    }
    if (summary.kind === 'omit') {
      const after = planSummaryAfterInstructionChange(state, nextInstruction, actor, now);
      Object.assign(plan.patch, after.patch);
      plan.summaryRequested = after.requested;
    }
  }

  if (summary.kind !== 'omit') {
    const authored = planSummaryInput(state, summary, actor, nextInstruction, now);
    if (authored.warnings.length > 0 && instructionChanged) {
      // The authored text was refused; still apply the instruction-change rules.
      const after = planSummaryAfterInstructionChange(state, nextInstruction, actor, now);
      Object.assign(plan.patch, after.patch);
      plan.summaryRequested = after.requested;
    }
    Object.assign(plan.patch, authored.patch);
    plan.warnings.push(...authored.warnings);
  }

  return plan;
}

/**
 * Plan an explicit Summarize / Regenerate / Retry request.
 *
 * Summarize and Regenerate by a person clear removal suppression; they are the
 * only operations that do. An agent cannot request a summary while the
 * objective is suppressed. A request that is already outstanding is
 * deduplicated: it keeps its generation, so the pending result still counts.
 */
export function planObjectiveSummaryGenerationRequest({
  state,
  instructionText,
  mode,
  actor
}: {
  state: ObjectiveBriefState;
  instructionText: string | null;
  mode: ObjectiveSummaryGenerationMode;
  actor: ObjectiveBriefActor;
}): ObjectiveBriefPlan {
  const plan = emptyPlan();
  if (!isSummaryEligibleInstruction(instructionText)) {
    throw new ServiceError(
      `Instructions shorter than ${OBJECTIVE_SUMMARY_MIN_INSTRUCTION_CHARS} characters are shown in full and are not summarized`,
      'summary_not_eligible',
      409
    );
  }
  if (mode === 'retry') {
    if (state.summary_status === 'pending') {
      plan.summaryRequested = true;
      return plan;
    }
    if (state.summary_status !== 'failed') {
      throw new ServiceError(
        'There is no failed summary generation to retry',
        'summary_not_failed',
        409
      );
    }
    plan.patch = {
      summary_status: 'pending',
      summary_generation: state.summary_generation + 1,
      summary_failure_code: null
    };
    plan.summaryRequested = true;
    return plan;
  }

  if (state.summary_suppressed && actor.kind !== 'human') {
    throw new ServiceError(
      'The summary was removed for this objective. Only a person can select Summarize to turn summaries back on.',
      'summary_suppressed',
      409
    );
  }
  if (state.summary_status === 'pending' && !state.summary_suppressed) {
    plan.summaryRequested = true;
    if (state.summary_request_kind !== 'explicit') {
      plan.patch = { summary_request_kind: 'explicit' };
    }
    return plan;
  }
  plan.patch = {
    summary_suppressed: false,
    summary_status: 'pending',
    summary_request_kind: 'explicit',
    summary_generation: state.summary_generation + 1,
    summary_failure_code: null
  };
  plan.summaryRequested = true;
  return plan;
}

/** What a worker generated, bound to the state it was generated from. */
export type ObjectiveBriefResult = {
  /** The trimmed instruction hash the worker read before calling the model. */
  instructionHash: string;
  title?: { generation: number; text: string };
  summary?: { generation: number; text: string };
};

export type ObjectiveBriefPublishOutcome = {
  patch: ObjectiveBriefPatch;
  title: 'published' | 'not_requested' | 'stale';
  summary: 'published' | 'not_requested' | 'stale' | 'suppressed' | 'invalid';
};

/**
 * Decide which parts of a generated result may publish. A result publishes
 * only against the exact generation and instruction text it was produced
 * from; position, launch or reopen changes do not invalidate it.
 */
export function planObjectiveBriefPublication({
  row,
  result,
  now
}: {
  row: ObjectiveBriefRow;
  result: ObjectiveBriefResult;
  now: string;
}): ObjectiveBriefPublishOutcome {
  const outcome: ObjectiveBriefPublishOutcome = {
    patch: {},
    title: result.title ? 'stale' : 'not_requested',
    summary: result.summary ? 'stale' : 'not_requested'
  };
  if (row.deleted_at !== null) return outcome;
  const instructionMatches =
    hashObjectiveInstruction(row.instruction_text) === result.instructionHash;

  if (result.title) {
    const text = result.title.text.trim();
    if (
      instructionMatches &&
      text &&
      row.title_source === 'generated' &&
      row.title_generation === result.title.generation
    ) {
      outcome.patch.title_status = null;
      outcome.title = 'published';
    }
  }

  if (result.summary) {
    let text: string | null = null;
    try {
      const input = normalizeObjectiveSummaryInput(result.summary.text);
      text = input.kind === 'set' ? input.text : null;
    } catch {
      text = null;
    }
    if (row.summary_suppressed) {
      outcome.summary = 'suppressed';
    } else if (
      instructionMatches &&
      row.summary_status === 'pending' &&
      row.summary_generation === result.summary.generation
    ) {
      if (text === null) {
        outcome.summary = 'invalid';
      } else {
        Object.assign(outcome.patch, {
          summary: text,
          summary_source: 'generated',
          summary_instruction_hash: result.instructionHash,
          summary_author_workspace_user_id: null,
          summary_author_agent: null,
          summary_updated_at: now,
          summary_revision: row.summary_revision + 1,
          summary_status: null,
          summary_request_kind: null,
          summary_failure_code: null
        } satisfies ObjectiveBriefPatch);
        outcome.summary = 'published';
      }
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const OBJECTIVE_BRIEF_SELECT = `o.id, o.workspace_id, o.project_id, o.mission_id, o.instruction_text,
  o.title, o.revision, o.deleted_at, ${OBJECTIVE_BRIEF_COLUMNS.map(c => `o.${c}`).join(', ')}`;

type RawBriefRow = Omit<ObjectiveBriefRow, 'summary_suppressed' | 'summary_updated_at'> & {
  summary_suppressed: unknown;
  summary_updated_at: unknown;
};

function toBriefRow(raw: RawBriefRow): ObjectiveBriefRow {
  const updatedAt = raw.summary_updated_at;
  return {
    ...raw,
    title_generation: Number(raw.title_generation),
    summary_revision: Number(raw.summary_revision),
    summary_generation: Number(raw.summary_generation),
    revision: Number(raw.revision),
    summary_suppressed: isTruthyFlag(raw.summary_suppressed),
    summary_updated_at:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : typeof updatedAt === 'string'
          ? updatedAt
          : null
  };
}

export async function loadObjectiveBriefRow(
  db: DatabaseClient,
  objectiveId: string,
  {
    includeDeleted = false,
    forUpdate = false
  }: {
    includeDeleted?: boolean;
    /**
     * Lock the row for the rest of the transaction (Postgres; SQLite
     * serializes write transactions). Every writer that plans brief columns
     * from this snapshot sets it, so plan and write see the same row.
     */
    forUpdate?: boolean;
  } = {}
): Promise<ObjectiveBriefRow | null> {
  const lock = forUpdate && db.dialect === 'postgres' ? ' FOR UPDATE' : '';
  const raw = await db.get<RawBriefRow>(
    `SELECT ${OBJECTIVE_BRIEF_SELECT}
       FROM objectives o
      WHERE o.id = ?${includeDeleted ? '' : ' AND o.deleted_at IS NULL'}${lock}`,
    [objectiveId]
  );
  return raw ? toBriefRow(raw) : null;
}

/** Column assignments and parameters for a patch, in a stable column order. */
export function objectiveBriefPatchAssignments(
  db: Pick<DatabaseClient, 'dialect'>,
  patch: ObjectiveBriefPatch
): { assignments: string[]; params: unknown[]; columns: string[] } {
  const assignments: string[] = [];
  const params: unknown[] = [];
  const columns: string[] = [];
  for (const column of OBJECTIVE_BRIEF_COLUMNS) {
    if (!(column in patch)) continue;
    const value = patch[column];
    assignments.push(`${column} = ?`);
    columns.push(column);
    params.push(column === 'summary_suppressed' ? bindBool(db.dialect, Boolean(value)) : value);
  }
  return { assignments, params, columns };
}

/**
 * Change-feed field names for a patch. Generation bookkeeping is reported as
 * the presentation field it guards, so clients refresh the right view.
 */
export function objectiveBriefChangedFields(patch: ObjectiveBriefPatch): string[] {
  const fields = new Set<string>();
  for (const column of Object.keys(patch)) {
    if (column.startsWith('title_')) fields.add('title_source');
    else if (column.startsWith('summary')) fields.add('summary');
    else if (column === 'instruction_author_kind') fields.add('instruction_author_kind');
  }
  return [...fields];
}

/**
 * Write a brief patch, bumping the row revision but never `updated_at`, and
 * append one change-feed row. Returns false when the guarded write matched no
 * row (for example, the objective was deleted or a generation moved).
 */
async function writeObjectiveBriefPatch({
  ctx,
  row,
  patch,
  extraAssignments = [],
  extraParams = [],
  extraChangedFields = [],
  guard = '',
  guardParams = []
}: {
  ctx: ServiceContext;
  row: ObjectiveBriefRow;
  patch: ObjectiveBriefPatch;
  extraAssignments?: string[];
  extraParams?: unknown[];
  extraChangedFields?: string[];
  guard?: string;
  guardParams?: unknown[];
}): Promise<boolean> {
  const { assignments, params } = objectiveBriefPatchAssignments(ctx.db, patch);
  const allAssignments = [...extraAssignments, ...assignments];
  if (allAssignments.length === 0) return true;
  const revision = row.revision + 1;
  const result = await ctx.db.run(
    `UPDATE objectives SET ${allAssignments.join(', ')}, revision = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL${guard}`,
    [...extraParams, ...params, revision, row.id, row.revision, ...guardParams]
  );
  if (result.changes === 0) return false;
  await recordChange({
    ctx,
    entityType: 'objective',
    entityId: row.id,
    operation: 'update',
    entityRevision: revision,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.id,
    changedFields: [...extraChangedFields, ...objectiveBriefChangedFields(patch)]
  });
  return true;
}

/** Public projection of an objective's brief state for service callers. */
export type ObjectiveBriefView = {
  objectiveId: string;
  title: string | null;
  titleSource: ObjectiveTitleSource | null;
  titleStatus: ObjectiveBriefStatus | null;
  summary: string | null;
  summarySource: ObjectiveSummarySource | null;
  summaryStale: boolean;
  summaryStatus: ObjectiveBriefStatus | null;
  summaryFailureCode: string | null;
  summarySuppressed: boolean;
  summaryRevision: number;
  summaryUpdatedAt: string | null;
  summaryAuthorWorkspaceUserId: string | null;
  summaryAuthorAgent: string | null;
  instructionAuthorKind: ObjectiveInstructionAuthorKind | null;
};

export function toObjectiveBriefView(row: ObjectiveBriefRow): ObjectiveBriefView {
  return {
    objectiveId: row.id,
    title: row.title,
    titleSource: row.title_source,
    titleStatus: row.title_status,
    summary: row.summary,
    summarySource: row.summary_source,
    summaryStale: isObjectiveSummaryStale(row, row.instruction_text),
    summaryStatus: row.summary_status,
    summaryFailureCode: row.summary_failure_code,
    summarySuppressed: row.summary_suppressed,
    summaryRevision: row.summary_revision,
    summaryUpdatedAt: row.summary_updated_at,
    summaryAuthorWorkspaceUserId: row.summary_author_workspace_user_id,
    summaryAuthorAgent: row.summary_author_agent,
    instructionAuthorKind: row.instruction_author_kind
  };
}

export type ObjectiveBriefMutationResult = {
  brief: ObjectiveBriefView;
  warnings: ObjectiveBriefWarning[];
  /** A summary generation is pending after this write (worker input). */
  summaryRequested: boolean;
};

async function resolveBriefRowForCtx(
  ctx: ServiceContext,
  objectiveRef: string
): Promise<ObjectiveBriefRow> {
  const resolved = await resolveObjectiveRef({ ctx, ref: objectiveRef });
  const row = await loadObjectiveBriefRow(ctx.db, resolved.id, { forUpdate: true });
  if (!row || row.workspace_id !== ctx.workspace.id) {
    throw new ServiceError(`Objective not found: ${objectiveRef}`, 'objective_not_found', 404);
  }
  return row;
}

function assertExpectedSummaryRevision(
  row: ObjectiveBriefRow,
  expectedSummaryRevision: number | undefined
): void {
  if (expectedSummaryRevision === undefined) return;
  if (row.summary_revision !== expectedSummaryRevision) {
    throw new ServiceError(
      'The summary changed after you started editing it. Reload it and try again.',
      'summary_conflict',
      409,
      { summaryRevision: row.summary_revision, summary: row.summary }
    );
  }
}

async function runInTransaction<T>(
  ctx: ServiceContext,
  work: (txCtx: ServiceContext) => Promise<T>
): Promise<T> {
  return ctx.db.transaction(tx => work({ ...ctx, db: tx }));
}

/**
 * Set or remove an objective's summary (presentation-only). Allowed in
 * every objective state, including after launch and completion; it never
 * touches instructions, lifecycle state or execution evidence. Callers check
 * surface permissions before calling.
 */
export async function setObjectiveSummary({
  ctx,
  objectiveId,
  summary,
  expectedSummaryRevision
}: {
  ctx: ServiceContext;
  objectiveId: string;
  /** `null` or blank removes the summary and suppresses generation. */
  summary: string | null;
  expectedSummaryRevision?: number;
}): Promise<ObjectiveBriefMutationResult> {
  const input = normalizeObjectiveSummaryInput(summary);
  return runInTransaction(ctx, async tx => {
    const row = await resolveBriefRowForCtx(tx, objectiveId);
    assertExpectedSummaryRevision(row, expectedSummaryRevision);
    const actor = objectiveBriefActorFromContext(tx);
    const plan = planSummaryInput(row, input, actor, row.instruction_text, nowIso());
    const written = await writeObjectiveBriefPatch({ ctx: tx, row, patch: plan.patch });
    if (!written) throw conflictError();
    const next = (await loadObjectiveBriefRow(tx.db, row.id))!;
    return {
      brief: toObjectiveBriefView(next),
      warnings: plan.warnings,
      summaryRequested: false
    };
  });
}

/** Remove: clear the summary and suppress generation until a person selects Summarize. */
export async function removeObjectiveSummary({
  ctx,
  objectiveId,
  expectedSummaryRevision
}: {
  ctx: ServiceContext;
  objectiveId: string;
  expectedSummaryRevision?: number;
}): Promise<ObjectiveBriefMutationResult> {
  return setObjectiveSummary({
    ctx,
    objectiveId,
    summary: null,
    ...(expectedSummaryRevision !== undefined ? { expectedSummaryRevision } : {})
  });
}

/** Summarize / Regenerate / Retry. Durable intent only; the worker publishes. */
export async function requestObjectiveSummaryGeneration({
  ctx,
  objectiveId,
  mode
}: {
  ctx: ServiceContext;
  objectiveId: string;
  mode: ObjectiveSummaryGenerationMode;
}): Promise<ObjectiveBriefMutationResult> {
  if (!OBJECTIVE_SUMMARY_GENERATION_MODES.includes(mode)) {
    throw new ServiceError(`Unknown summary request: ${String(mode)}`, 'validation_error', 400);
  }
  return runInTransaction(ctx, async tx => {
    const row = await resolveBriefRowForCtx(tx, objectiveId);
    const plan = planObjectiveSummaryGenerationRequest({
      state: row,
      instructionText: row.instruction_text,
      mode,
      actor: objectiveBriefActorFromContext(tx)
    });
    const written = await writeObjectiveBriefPatch({ ctx: tx, row, patch: plan.patch });
    if (!written) throw conflictError();
    // An explicit request runs without the edit debounce.
    if (plan.summaryRequested) {
      await enqueueObjectiveBriefComposeJob({
        db: tx.db,
        workspaceId: row.workspace_id,
        objectiveId: row.id,
        debounceMs: 0
      });
    }
    const next = (await loadObjectiveBriefRow(tx.db, row.id))!;
    return {
      brief: toObjectiveBriefView(next),
      warnings: plan.warnings,
      summaryRequested: plan.summaryRequested
    };
  });
}

function conflictError(): ServiceError {
  return new ServiceError(
    'The objective changed while this request ran. Reload it and try again.',
    'objective_conflict',
    409
  );
}

/**
 * Worker-facing: publish a generated title and/or summary. The context is
 * the worker's (`source: 'runner'`); it authorizes nothing by itself, so the
 * objective is addressed by id. Stale, suppressed and deleted results are
 * dropped without error.
 */
export async function publishObjectiveBrief({
  ctx,
  objectiveId,
  result
}: {
  ctx: ServiceContext;
  objectiveId: string;
  result: ObjectiveBriefResult;
}): Promise<Omit<ObjectiveBriefPublishOutcome, 'patch'>> {
  return runInTransaction(ctx, async tx => {
    const row = await loadObjectiveBriefRow(tx.db, objectiveId, {
      includeDeleted: true,
      forUpdate: true
    });
    if (!row)
      return {
        title: result.title ? 'stale' : 'not_requested',
        summary: result.summary ? 'stale' : 'not_requested'
      };
    const outcome = planObjectiveBriefPublication({ row, result, now: nowIso() });
    const titleText = outcome.title === 'published' ? result.title!.text.trim() : null;
    // The row is locked above; these predicates restate the planned guard in
    // the write itself, so a result can never land on another generation, a
    // non-pending request or a removed summary.
    const guards: string[] = [];
    const guardParams: unknown[] = [];
    if (outcome.title === 'published') {
      guards.push(` AND title_generation = ? AND title_source = 'generated'`);
      guardParams.push(result.title!.generation);
    }
    if (outcome.summary === 'published') {
      guards.push(
        ` AND summary_generation = ? AND summary_status = 'pending' AND summary_suppressed = ?`
      );
      guardParams.push(result.summary!.generation, bindBool(tx.db.dialect, false));
    }
    const written = await writeObjectiveBriefPatch({
      guard: guards.join(''),
      guardParams,
      ctx: { ...tx, workspace: { ...tx.workspace, id: row.workspace_id } },
      row,
      patch: outcome.patch,
      extraAssignments: titleText !== null ? ['title = ?'] : [],
      extraParams: titleText !== null ? [titleText] : [],
      extraChangedFields: titleText !== null ? ['title'] : []
    });
    if (!written) {
      return {
        title: outcome.title === 'published' ? 'stale' : outcome.title,
        summary: outcome.summary === 'published' ? 'stale' : outcome.summary
      };
    }
    return { title: outcome.title, summary: outcome.summary };
  });
}

/**
 * Worker-facing: record that the pending summary generation failed for
 * good. A failure for a superseded generation is ignored.
 */
export async function failObjectiveSummaryGeneration({
  ctx,
  objectiveId,
  generation,
  failureCode
}: {
  ctx: ServiceContext;
  objectiveId: string;
  generation: number;
  failureCode: ObjectiveBriefFailureCode;
}): Promise<boolean> {
  if (!OBJECTIVE_BRIEF_FAILURE_CODES.includes(failureCode)) {
    throw new ServiceError(
      `Unknown brief failure code: ${String(failureCode)}`,
      'validation_error'
    );
  }
  return runInTransaction(ctx, async tx => {
    const row = await loadObjectiveBriefRow(tx.db, objectiveId, { forUpdate: true });
    if (!row || row.summary_status !== 'pending' || row.summary_generation !== generation) {
      return false;
    }
    return writeObjectiveBriefPatch({
      ctx: { ...tx, workspace: { ...tx.workspace, id: row.workspace_id } },
      row,
      patch: { summary_status: 'failed', summary_failure_code: failureCode }
    });
  });
}

/**
 * Bounded catch-up selection: live draft/submitted objectives whose current
 * instructions were written by an agent or assistant, are long enough, have
 * no summary, no outstanding or failed request and no removal suppression.
 * Unknown authorship (NULL) never qualifies.
 */
export async function listObjectiveBriefCatchUpCandidates(
  db: DatabaseClient,
  { limit }: { limit: number }
): Promise<string[]> {
  const bounded = Math.max(0, Math.min(Math.trunc(limit), 500));
  if (bounded === 0) return [];
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM objectives
      WHERE deleted_at IS NULL
        AND state IN ('draft', 'submitted')
        AND instruction_author_kind = 'agent'
        AND summary IS NULL
        AND summary_status IS NULL
        AND summary_suppressed = ?
        AND LENGTH(TRIM(COALESCE(instruction_text, ''))) >= ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [bindBool(db.dialect, false), OBJECTIVE_SUMMARY_MIN_INSTRUCTION_CHARS, bounded]
  );
  return rows.map(r => r.id);
}

/**
 * Mark one catch-up candidate pending. Re-checks eligibility under the write
 * so repeated or concurrent scans are idempotent.
 */
export async function markObjectiveBriefCatchUpPending(
  ctx: ServiceContext,
  objectiveId: string
): Promise<boolean> {
  return runInTransaction(ctx, async tx => {
    const row = await loadObjectiveBriefRow(tx.db, objectiveId, { forUpdate: true });
    if (
      !row ||
      row.instruction_author_kind !== 'agent' ||
      row.summary !== null ||
      row.summary_status !== null ||
      row.summary_suppressed ||
      !isSummaryEligibleInstruction(row.instruction_text)
    ) {
      return false;
    }
    const state = await tx.db.get<{ state: string }>('SELECT state FROM objectives WHERE id = ?', [
      row.id
    ]);
    if (!state || (state.state !== 'draft' && state.state !== 'submitted')) return false;
    const written = await writeObjectiveBriefPatch({
      ctx: { ...tx, workspace: { ...tx.workspace, id: row.workspace_id } },
      row,
      patch: {
        summary_status: 'pending',
        summary_request_kind: 'automatic',
        summary_generation: row.summary_generation + 1,
        summary_failure_code: null
      }
    });
    if (written) {
      await enqueueObjectiveBriefComposeJob({
        db: tx.db,
        workspaceId: row.workspace_id,
        objectiveId: row.id,
        debounceMs: 0
      });
    }
    return written;
  });
}

/**
 * Worker-facing: settle an outstanding title request without a model title.
 * `null` keeps the current (local) title as final, for example when no
 * provider is configured; `failed` records that generation failed. A request
 * for a superseded generation is ignored.
 */
export async function settleObjectiveTitleGeneration({
  ctx,
  objectiveId,
  generation,
  status
}: {
  ctx: ServiceContext;
  objectiveId: string;
  generation: number;
  status: 'failed' | null;
}): Promise<boolean> {
  return runInTransaction(ctx, async tx => {
    const row = await loadObjectiveBriefRow(tx.db, objectiveId, { forUpdate: true });
    if (!row || row.title_status !== 'pending' || row.title_generation !== generation) {
      return false;
    }
    return writeObjectiveBriefPatch({
      ctx: { ...tx, workspace: { ...tx.workspace, id: row.workspace_id } },
      row,
      patch: { title_status: status }
    });
  });
}

/**
 * Worker-facing: clear pending intent that no result can satisfy, so a job
 * never loops on it: a title that is no longer system-owned or has blank
 * instructions, or a summary that is suppressed or whose instructions
 * are no longer long enough. Returns the cleared fields.
 */
export async function clearUnsatisfiableObjectiveBriefIntent(
  ctx: ServiceContext,
  objectiveId: string
): Promise<Array<'title' | 'summary'>> {
  return runInTransaction(ctx, async tx => {
    const row = await loadObjectiveBriefRow(tx.db, objectiveId, { forUpdate: true });
    if (!row) return [];
    const patch: ObjectiveBriefPatch = {};
    const cleared: Array<'title' | 'summary'> = [];
    if (
      row.title_status === 'pending' &&
      (row.title_source !== 'generated' || !(row.instruction_text ?? '').trim())
    ) {
      patch.title_status = null;
      cleared.push('title');
    }
    if (
      row.summary_status === 'pending' &&
      (row.summary_suppressed || !isSummaryEligibleInstruction(row.instruction_text))
    ) {
      patch.summary_status = null;
      patch.summary_request_kind = null;
      cleared.push('summary');
    }
    if (cleared.length === 0) return [];
    const written = await writeObjectiveBriefPatch({
      ctx: { ...tx, workspace: { ...tx.workspace, id: row.workspace_id } },
      row,
      patch
    });
    return written ? cleared : [];
  });
}

/**
 * Live rows with pending brief work and no queued or running brief job: rows
 * whose intent predates the worker, or whose job was lost outside a
 * transaction. Bounded; the worker enqueues each one.
 */
export async function listObjectiveBriefOrphans(
  db: DatabaseClient,
  { limit }: { limit: number }
): Promise<Array<{ id: string; workspaceId: string }>> {
  const bounded = Math.max(0, Math.min(Math.trunc(limit), 500));
  if (bounded === 0) return [];
  const rows = await db.all<{ id: string; workspace_id: string }>(
    `SELECT o.id, o.workspace_id FROM objectives o
      WHERE o.deleted_at IS NULL
        AND (o.title_status = 'pending' OR o.summary_status = 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM worker_jobs j
           WHERE j.workspace_id = o.workspace_id
             AND j.type = ?
             AND j.status IN ('queued', 'running')
             AND j.deleted_at IS NULL
             AND ${jsonTextFieldSql('j.payload_json', 'objectiveId', db.dialect)} = o.id
        )
      ORDER BY o.created_at ASC, o.id ASC
      LIMIT ?`,
    [OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE, bounded]
  );
  return rows.map(row => ({ id: row.id, workspaceId: row.workspace_id }));
}
