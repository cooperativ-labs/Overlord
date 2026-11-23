import { type UpdateObjectiveBody } from '@overlord/contract';

import { isManualAgentKey, normalizeAgentKey } from '../../packages/core/service/manual-agent.ts';
import {
  type ObjectiveBriefWarning,
  objectiveSummaryPlacementWarnings,
  objectiveSummaryStyleWarnings
} from '../../packages/core/service/objective-brief.ts';
import { ApiError } from '../errors.ts';

import {
  hasFlag,
  optionalBoolFlag,
  parseJsonArrayInput,
  type ProtocolRequestBody,
  resolveInput,
  strFlag
} from './flags.ts';

export function optionalAutoAdvanceFlag(body: ProtocolRequestBody): boolean | undefined {
  return optionalBoolFlag({
    body,
    name: '--auto-advance',
    negatedName: '--no-auto-advance'
  });
}

export function withDefaultAutoAdvance(
  items: ObjectiveInput[],
  autoAdvance: boolean | undefined
): ObjectiveInput[] {
  if (autoAdvance === undefined) return items;
  return items.map(item => ({
    ...item,
    autoAdvance: item.autoAdvance ?? autoAdvance
  }));
}

/**
 * Seed the launch selection for items that name no `agent` of their own, so a
 * mission can be created with its first objective already assigned instead of
 * needing a second `add-objectives` call. `--agent` is taken: on `create` and
 * `prompt` it records creation provenance (and, on `prompt`, the attaching
 * agent), so objective assignment gets its own explicit flag pair.
 */
export function withDefaultAgentSelection(
  items: ObjectiveInput[],
  body: ProtocolRequestBody
): ObjectiveInput[] {
  const agent = strFlag(body, '--objective-agent')?.trim() || undefined;
  const model = strFlag(body, '--objective-model')?.trim() || undefined;
  if (agent === undefined && model === undefined) return items;
  if (model !== undefined && agent === undefined) {
    throw new ApiError(
      400,
      '--objective-model requires --objective-agent',
      undefined,
      'invalid_input'
    );
  }
  // A per-item selection is always the more specific statement of intent, so the
  // flags fill in only what the item left unsaid.
  return items.map(item =>
    item.agent === undefined || item.agent === null
      ? {
          ...item,
          agent,
          ...(model !== undefined && (item.model === undefined || item.model === null)
            ? { model }
            : {})
        }
      : item
  );
}

/**
 * Read the `--objective-agent` / `--objective-model` /
 * `--objective-reasoning-effort` assignment flags of `update-objective`.
 *
 * Switching agent always rewrites model and reasoning effort — values chosen
 * for the previous agent rarely exist for the next one — so omitted ones are
 * cleared, the same rule the web and iOS selectors follow. `human` is accepted
 * for the Manual executor and stored as `manual`, which takes neither.
 */
function objectiveAssignmentUpdate(
  body: ProtocolRequestBody
): Pick<UpdateObjectiveBody, 'assignedAgent' | 'model' | 'reasoningEffort'> {
  const hasAgent = hasFlag(body, '--objective-agent');
  const hasModel = hasFlag(body, '--objective-model');
  const hasEffort = hasFlag(body, '--objective-reasoning-effort');
  if (!hasAgent && !hasModel && !hasEffort) return {};
  if (!hasAgent) {
    throw new ApiError(
      400,
      '--objective-model and --objective-reasoning-effort require --objective-agent',
      undefined,
      'invalid_input'
    );
  }
  const agent = normalizeAgentKey(strFlag(body, '--objective-agent'));
  if (!agent) {
    throw new ApiError(400, '--objective-agent cannot be blank', undefined, 'invalid_input');
  }
  const model = strFlag(body, '--objective-model')?.trim() || null;
  const reasoningEffort = strFlag(body, '--objective-reasoning-effort')?.trim() || null;
  if (isManualAgentKey(agent) && (model || reasoningEffort)) {
    throw new ApiError(
      400,
      'A Manual objective is done by a person and takes no model or reasoning effort',
      undefined,
      'invalid_input'
    );
  }
  return { assignedAgent: agent, model, reasoningEffort };
}

/**
 * Flags renamed so each one says which text it carries (coo:1321). An old name
 * is refused with its replacement instead of being ignored.
 */
const RENAMED_OBJECTIVE_FLAGS: Record<string, string> = {
  '--objective': '--objective-instructions',
  '--objective-description': '--objective-summary',
  '--objective-description-file': '--objective-summary-file',
  '--description': '--summary',
  '--description-file': '--summary-file',
  '--description-request': '--summary-request'
};

const RETIRED_CREATE_FLAGS = [
  '--objective',
  '--objective-description',
  '--objective-description-file'
] as const;
const RETIRED_UPDATE_OBJECTIVE_FLAGS = [
  '--description',
  '--description-file',
  '--description-request'
] as const;

/** JSON item keys renamed alongside the flags (coo:1321). */
const RENAMED_OBJECTIVE_ITEM_KEYS: Record<string, string> = {
  objective: 'instructions',
  description: 'summary'
};

function rejectRenamedObjectiveFlags(body: ProtocolRequestBody, flags: readonly string[]): void {
  const present = flags.filter(flag => hasFlag(body, flag));
  if (present.length === 0) return;
  throw new ApiError(
    400,
    `Renamed protocol flag(s): ${present
      .map(flag => `${flag} is now ${RENAMED_OBJECTIVE_FLAGS[flag]}`)
      .join(
        '; '
      )}. --objective-instructions is the complete brief for the executing agent; --objective-summary is a short overview for people.`,
    undefined,
    'invalid_input'
  );
}

/**
 * Instructions for create/prompt: `--objective-instructions` /
 * `--objective-instructions-file`, else the positional text.
 */
function objectiveInstructions(body: ProtocolRequestBody): string {
  const given =
    hasFlag(body, '--objective-instructions') || hasFlag(body, '--objective-instructions-file');
  const flag = given
    ? resolveInput(body, '--objective-instructions', '--objective-instructions-file')
    : undefined;
  if (flag !== undefined && flag.trim() !== '') return flag;
  const positional = (body.positional ?? []).join(' ').trim();
  if (positional) return positional;
  throw new ApiError(
    400,
    'Missing objective instructions (use --objective-instructions, --objective-instructions-file or a positional argument)'
  );
}

type ObjectiveInput = {
  /** The complete brief the executing agent receives. */
  instructions: string;
  title?: string | null;
  /** Authored human-facing summary; null or blank removes it (ADR 0057). */
  summary?: string | null;
  autoAdvance?: boolean;
  agent?: string | null;
  model?: string | null;
  resourceKey?: string | null;
};

const MAX_PROTOCOL_OBJECTIVES = 100;
const MAX_PROTOCOL_DELETIONS = 100;
const OBJECTIVE_INPUT_KEYS = new Set([
  'instructions',
  'title',
  'summary',
  'autoAdvance',
  'agent',
  'model',
  'resourceKey'
]);

export function parseObjectiveArrayInput(body: ProtocolRequestBody): ObjectiveInput[] | undefined {
  const values = parseJsonArrayInput<unknown>(
    body,
    '--objectives-json',
    '--objectives-file',
    'objectives'
  );
  if (values === undefined) return undefined;
  if (values.length > MAX_PROTOCOL_OBJECTIVES) {
    throw new ApiError(
      400,
      `objectives accepts at most ${MAX_PROTOCOL_OBJECTIVES} items`,
      undefined,
      'invalid_input'
    );
  }
  return values.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ApiError(400, `objectives[${index}] must be an object`, undefined, 'invalid_input');
    }
    const item = value as Record<string, unknown>;
    const renamed = Object.keys(item).filter(key => key in RENAMED_OBJECTIVE_ITEM_KEYS);
    if (renamed.length > 0) {
      throw new ApiError(
        400,
        `objectives[${index}] uses renamed field(s): ${renamed
          .map(key => `"${key}" is now "${RENAMED_OBJECTIVE_ITEM_KEYS[key]}"`)
          .join(
            '; '
          )}. "instructions" is the complete brief for the executing agent; "summary" is a short overview for people.`,
        undefined,
        'invalid_input'
      );
    }
    if (Object.keys(item).some(key => !OBJECTIVE_INPUT_KEYS.has(key))) {
      throw new ApiError(
        400,
        `objectives[${index}] contains unsupported fields`,
        undefined,
        'invalid_input'
      );
    }
    if (typeof item.instructions !== 'string' || !item.instructions.trim()) {
      throw new ApiError(
        400,
        `objectives[${index}].instructions must be a non-empty string`,
        undefined,
        'invalid_input'
      );
    }
    for (const key of ['title', 'summary', 'agent', 'model', 'resourceKey'] as const) {
      if (item[key] !== undefined && item[key] !== null && typeof item[key] !== 'string') {
        throw new ApiError(
          400,
          `objectives[${index}].${key} must be a string or null`,
          undefined,
          'invalid_input'
        );
      }
    }
    if (item.autoAdvance !== undefined && typeof item.autoAdvance !== 'boolean') {
      throw new ApiError(
        400,
        `objectives[${index}].autoAdvance must be a boolean`,
        undefined,
        'invalid_input'
      );
    }
    return item as ObjectiveInput;
  });
}

export function parseDeletionReferences(
  body: ProtocolRequestBody,
  jsonFlag: '--mission-ids-json' | '--objective-ids-json',
  fileFlag: '--mission-ids-file' | '--objective-ids-file',
  label: 'missionIds' | 'objectiveIds'
): string[] {
  const values = parseJsonArrayInput<unknown>(body, jsonFlag, fileFlag, label);
  if (!values || values.length === 0) {
    throw new ApiError(400, `${label} requires at least one reference`, undefined, 'invalid_input');
  }
  if (values.length > MAX_PROTOCOL_DELETIONS) {
    throw new ApiError(
      400,
      `${label} accepts at most ${MAX_PROTOCOL_DELETIONS} items`,
      undefined,
      'invalid_input'
    );
  }
  const references = values.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ApiError(
        400,
        `${label}[${index}] must be a non-empty string`,
        undefined,
        'invalid_input'
      );
    }
    return value.trim();
  });
  if (new Set(references).size !== references.length) {
    throw new ApiError(400, `${label} contains duplicate references`, undefined, 'invalid_input');
  }
  return references;
}

/**
 * `--objective-summary` / `--objective-summary-file`: the authored
 * summary of the single `--objective-instructions` form. With
 * `--objectives-json` each item carries its own `summary` instead.
 */
function singleObjectiveSummary(body: ProtocolRequestBody): string | undefined {
  const given = hasFlag(body, '--objective-summary') || hasFlag(body, '--objective-summary-file');
  if (!given) return undefined;
  return resolveInput(body, '--objective-summary', '--objective-summary-file') ?? '';
}

/**
 * Objective array for create/prompt: `--objectives-json`, else a one-item
 * `--objective-instructions`.
 */
export function objectiveInputs(body: ProtocolRequestBody): ObjectiveInput[] {
  rejectRenamedObjectiveFlags(body, RETIRED_CREATE_FLAGS);
  const parsed = parseObjectiveArrayInput(body);
  const autoAdvance = optionalAutoAdvanceFlag(body);
  const summary = singleObjectiveSummary(body);
  if (parsed !== undefined) {
    if (summary !== undefined) {
      throw new ApiError(
        400,
        '--objective-summary applies to --objective-instructions; set "summary" on each --objectives-json item instead',
        undefined,
        'invalid_input'
      );
    }
    return withDefaultAgentSelection(withDefaultAutoAdvance(parsed, autoAdvance), body);
  }
  const resourceKey = strFlag(body, '--resource');
  return withDefaultAgentSelection(
    withDefaultAutoAdvance(
      [
        {
          instructions: objectiveInstructions(body),
          ...(summary !== undefined ? { summary } : {}),
          ...(resourceKey ? { resourceKey } : {})
        }
      ],
      autoAdvance
    ),
    body
  );
}

/**
 * Advisory warnings for each created objective whose item carried an authored
 * summary: a possible instructions/summary swap first (coo:1321), then style
 * issues. Warnings never reject a write; they are attached to the matching
 * created objective so a batch shows which item they belong to.
 */
export function withSummaryWarnings<T extends { id: string }>(
  created: T[],
  inputs: ObjectiveInput[]
): Array<T & { warnings?: ObjectiveBriefWarning[] }> {
  return created.map((objective, index) => {
    const input = inputs[index];
    const text = input?.summary;
    if (!input || typeof text !== 'string' || !text.trim()) return objective;
    const warnings = [
      ...objectiveSummaryPlacementWarnings({ instructions: input.instructions, summary: text }),
      ...objectiveSummaryStyleWarnings(text.trim())
    ];
    return warnings.length > 0 ? { ...objective, warnings } : objective;
  });
}

const SUMMARY_REQUEST_MODES = ['summarize', 'regenerate', 'retry'] as const;

/** Keep each draft check before validation of the corresponding text payload. */
export async function objectiveUpdateFromFlags(
  body: ProtocolRequestBody,
  assertDraft: (what: 'instruction text' | 'summary') => Promise<{ instructionText: string }>
) {
  rejectRenamedObjectiveFlags(body, RETIRED_UPDATE_OBJECTIVE_FLAGS);
  const update: UpdateObjectiveBody = {};
  const autoAdvance = optionalAutoAdvanceFlag(body);
  if (autoAdvance !== undefined) {
    update.autoAdvance = autoAdvance;
  }
  if (hasFlag(body, '--title')) {
    update.title = strFlag(body, '--title') ?? '';
  }
  if (hasFlag(body, '--instruction-text') || hasFlag(body, '--instruction-text-file')) {
    await assertDraft('instruction text');
    update.instructionText =
      resolveInput(body, '--instruction-text', '--instruction-text-file') ?? '';
  }
  const hasSummary = hasFlag(body, '--summary') || hasFlag(body, '--summary-file');
  const summaryRequest = strFlag(body, '--summary-request');
  if (hasFlag(body, '--summary-request')) {
    if (!summaryRequest || !(SUMMARY_REQUEST_MODES as readonly string[]).includes(summaryRequest)) {
      throw new ApiError(
        400,
        '--summary-request must be summarize, regenerate or retry',
        undefined,
        'invalid_input'
      );
    }
    if (hasSummary) {
      throw new ApiError(
        400,
        '--summary-request cannot be combined with --summary/--summary-file',
        undefined,
        'invalid_input'
      );
    }
  }
  const current = hasSummary || summaryRequest ? await assertDraft('summary') : null;
  if (hasSummary) {
    // An empty value is Remove: the summary stays absent until a person
    // selects Summarize (ADR 0057).
    update.summary = resolveInput(body, '--summary', '--summary-file') ?? '';
  }
  // Compare the summary with the instructions the objective will have
  // after this write; a possible swap is returned as a warning.
  const placement =
    typeof update.summary === 'string' && update.summary.trim()
      ? {
          instructions: update.instructionText ?? current?.instructionText ?? '',
          summary: update.summary
        }
      : null;
  Object.assign(update, objectiveAssignmentUpdate(body));
  if (
    autoAdvance === undefined &&
    update.instructionText === undefined &&
    update.title === undefined &&
    update.summary === undefined &&
    update.assignedAgent === undefined &&
    !summaryRequest
  ) {
    throw new ApiError(
      400,
      'Provide at least one of --title, --summary/--summary-file, --summary-request, --auto-advance/--no-auto-advance, --instruction-text/--instruction-text-file, or --objective-agent'
    );
  }
  return { update, wantsSummaryRequest: summaryRequest, placement };
}
