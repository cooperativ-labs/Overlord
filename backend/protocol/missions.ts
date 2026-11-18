import { PERMISSIONS } from '@overlord/auth';
import { type UpdateObjectiveBody } from '@overlord/contract';

import { listObjectiveFileChanges } from '../../packages/core/service/changes.ts';
import { resolveProjectId, type ServiceContext } from '../../packages/core/service/context.ts';
import { isManualAgentKey, normalizeAgentKey } from '../../packages/core/service/manual-agent.ts';
import { parseMissionSearchOptions } from '../../packages/core/service/mission-search.ts';
import {
  type ObjectiveBriefWarning,
  objectiveDescriptionStyleWarnings
} from '../../packages/core/service/objective-brief.ts';
import {
  addObjectivesToMission,
  discussObjective,
  instructionStyleFor,
  loadMissionContext,
  protocolCreate,
  protocolPrompt,
  recordWork
} from '../../packages/core/service/protocol.ts';
import { hashSessionKey } from '../../packages/core/service/util.ts';
import { getActiveTokenProjectIds, requireDatabaseClient, serviceDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { launchObjective } from '../execution/launch.ts';
import { resolveObjectiveIdForRest } from '../objective-ref.ts';
import { requireProjectPermission } from '../rbac.ts';
import {
  callerMembershipsInActiveOrganization,
  createInboxItem,
  deleteMissions,
  deleteObjectives,
  listMissionDeliveries,
  reorderObjectives,
  requestObjectiveDescription,
  searchMissionReferences,
  searchMissionsAcrossWorkspacesV2,
  searchMissionsAcrossWorkspacesV3,
  updateObjectiveWithWarnings
} from '../repository.ts';

import {
  type ArtifactInput,
  parseDeliveryPayloadEnvelope,
  rejectRemovedProtocolFlags,
  rejectRemovedProtocolPayloadFields,
  RETIRED_RECORD_WORK_FIELDS,
  RETIRED_RECORD_WORK_FLAGS
} from './delivery-payload.ts';
import {
  boolFlag,
  externalSessionId,
  hasFlag,
  intFlag,
  missionRefFlag,
  objectiveRefFlag,
  optionalBoolFlag,
  parseJsonArrayInput,
  parseJsonInput,
  type ProtocolRequestBody,
  requireFlag,
  resolveInput,
  strFlag,
  type SubcommandTable
} from './flags.ts';
import { ProjectSelectionRequiredError, resolveProjectRefChoices } from './project-refs.ts';
import { connectionMethodFlag } from './session.ts';

// ---- Mission and objective protocol subcommands ---------------------------
//
// Mission creation, discovery, search, objective edits, deletion, and
// record-work, spread into the dispatch table in backend/protocol.ts.

function optionalAutoAdvanceFlag(body: ProtocolRequestBody): boolean | undefined {
  return optionalBoolFlag({
    body,
    name: '--auto-advance',
    negatedName: '--no-auto-advance'
  });
}

function withDefaultAutoAdvance(
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
function withDefaultAgentSelection(
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
 * Resolve `agent_sessions.id` from `--session-key` when present. Soft lookup —
 * a missing or unknown key yields null rather than failing the create path.
 */
async function resolveSessionId(body: ProtocolRequestBody): Promise<string | null> {
  const sessionKey = strFlag(body, '--session-key');
  if (!sessionKey) return null;
  const session = await serviceDatabaseClient().get<{ id: string }>(
    `SELECT id FROM agent_sessions
      WHERE session_key_hash = ? AND deleted_at IS NULL`,
    [hashSessionKey(sessionKey)]
  );
  return session?.id ?? null;
}

/** Stamp agent authorship provenance onto a protocol create-ish context. */
async function withAgentOrigin({
  ctx,
  body
}: {
  ctx: ServiceContext;
  body: ProtocolRequestBody;
}): Promise<ServiceContext> {
  return {
    ...ctx,
    origin: {
      kind: 'agent',
      agent: strFlag(body, '--agent') ?? null,
      sessionId: await resolveSessionId(body)
    }
  };
}

/**
 * Agent protocol surfaces may edit instruction text only on draft objectives.
 * Agent description edits and summary requests stay inside the same planning
 * scope (ADR 0059); people edit descriptions in any state over REST.
 */
async function assertDraftOnProtocolSurface(
  objectiveRef: string,
  what: 'instruction text' | 'description'
): Promise<void> {
  const db = requireDatabaseClient();
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveRef, db });
  const row = (await db.get(
    `SELECT state FROM objectives
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [resolved.id, resolved.workspaceId]
  )) as { state: string } | undefined;
  if (!row) {
    throw new ApiError(404, 'Objective not found');
  }
  if (row.state !== 'draft') {
    throw new ApiError(
      400,
      what === 'description'
        ? 'An agent can change an objective description or request a summary only in draft state'
        : 'Objective instruction text can only be edited in draft state',
      undefined,
      what === 'description' ? 'description_not_editable' : undefined
    );
  }
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
 * CLI protocol accepts the same human project references as other CLI
 * commands, but the fan-out repository search deliberately accepts only
 * stable project IDs. Resolve the human form before crossing that boundary.
 */
/**
 * Resolve the `--project-id` filter for a V2 search.
 *
 * V2 is an organization-bounded aggregate read, so the reference resolves
 * against every membership in the active organization rather than one anchor
 * workspace. A name matching in two workspaces raises the selection flow
 * instead of guessing which board the user meant.
 */
async function resolveV2SearchProjectId(
  projectRef: string | null,
  workspaceHint?: string | null
): Promise<string[] | null> {
  if (!projectRef) return null;
  const scopes = await callerMembershipsInActiveOrganization(serviceDatabaseClient());
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint,
    workspaceIds: scopes.map(scope => scope.workspaceId)
  });
  if (choices.length === 0) throw new ApiError(404, `Project not found: ${projectRef}`);
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return [choices[0]!.id];
}

/** Ranked-search flags that have no meaning for an exact reference lookup. */
const RANKED_SEARCH_ONLY_FLAGS = [
  '--query',
  '--status',
  '--resource-key',
  '--date-field',
  '--from',
  '--to',
  '--response-version',
  '--entity-types',
  '--objective-states',
  '--matches-per-result'
] as const;

/**
 * `search --reference`: exhaustive exact-token lookup in one project (contract v155).
 * It is not ranked search, so ranked filters are rejected rather than silently ignored.
 */
async function searchExactReference(body: ProtocolRequestBody, reference: string) {
  const conflicting = RANKED_SEARCH_ONLY_FLAGS.filter(flag => hasFlag(body, flag));
  if (conflicting.length) {
    throw new ApiError(400, `--reference cannot be combined with ${conflicting.join(', ')}`);
  }
  const projectRef = strFlag(body, '--project-id') ?? null;
  if (!projectRef) throw new ApiError(400, '--reference requires --project-id');
  const limitText = strFlag(body, '--limit');
  const limit = limitText === undefined ? null : Number(limitText);
  if (limit !== null && !Number.isInteger(limit)) {
    throw new ApiError(400, '--limit must be an integer');
  }
  return searchMissionReferences({
    projectIds: await resolveV2SearchProjectId(projectRef, strFlag(body, '--workspace-id')),
    reference,
    cursor: strFlag(body, '--cursor') ?? null,
    limit
  });
}

/** Objective text for create/prompt/record-work: `--objective`, else positional. */
function objectiveText(body: ProtocolRequestBody): string {
  const flag = strFlag(body, '--objective');
  if (flag !== undefined && flag.trim() !== '') return flag;
  const positional = (body.positional ?? []).join(' ').trim();
  if (positional) return positional;
  throw new ApiError(400, 'Missing objective text (use --objective or a positional argument)');
}

type ObjectiveInput = {
  objective: string;
  title?: string | null;
  /** Authored human-facing description; null or blank removes it (ADR 0057). */
  description?: string | null;
  autoAdvance?: boolean;
  agent?: string | null;
  model?: string | null;
  resourceKey?: string | null;
};

const MAX_PROTOCOL_OBJECTIVES = 100;
const MAX_PROTOCOL_DELETIONS = 100;
const OBJECTIVE_INPUT_KEYS = new Set([
  'objective',
  'title',
  'description',
  'autoAdvance',
  'agent',
  'model',
  'resourceKey'
]);

function parseObjectiveArrayInput(body: ProtocolRequestBody): ObjectiveInput[] | undefined {
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
    if (Object.keys(item).some(key => !OBJECTIVE_INPUT_KEYS.has(key))) {
      throw new ApiError(
        400,
        `objectives[${index}] contains unsupported fields`,
        undefined,
        'invalid_input'
      );
    }
    if (typeof item.objective !== 'string' || !item.objective.trim()) {
      throw new ApiError(
        400,
        `objectives[${index}].objective must be a non-empty string`,
        undefined,
        'invalid_input'
      );
    }
    for (const key of ['title', 'description', 'agent', 'model', 'resourceKey'] as const) {
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

function parseDeletionReferences(
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
 * `--objective-description` / `--objective-description-file`: the authored
 * description of the single `--objective` form. With `--objectives-json` each
 * item carries its own `description` instead.
 */
function singleObjectiveDescription(body: ProtocolRequestBody): string | undefined {
  const given =
    hasFlag(body, '--objective-description') || hasFlag(body, '--objective-description-file');
  if (!given) return undefined;
  return resolveInput(body, '--objective-description', '--objective-description-file') ?? '';
}

/** Objective array for create/prompt: `--objectives-json`, else a one-item `--objective`. */
function objectiveInputs(body: ProtocolRequestBody): ObjectiveInput[] {
  const parsed = parseObjectiveArrayInput(body);
  const autoAdvance = optionalAutoAdvanceFlag(body);
  const description = singleObjectiveDescription(body);
  if (parsed !== undefined) {
    if (description !== undefined) {
      throw new ApiError(
        400,
        '--objective-description applies to --objective; set "description" on each --objectives-json item instead',
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
          objective: objectiveText(body),
          ...(description !== undefined ? { description } : {}),
          ...(resourceKey ? { resourceKey } : {})
        }
      ],
      autoAdvance
    ),
    body
  );
}

/**
 * Advisory style warnings for each created objective whose item carried an
 * authored description. Warnings never reject a write; they are attached to
 * the matching created objective so a batch shows which item they belong to.
 */
function withDescriptionWarnings<T extends { id: string }>(
  created: T[],
  inputs: ObjectiveInput[]
): Array<T & { warnings?: ObjectiveBriefWarning[] }> {
  return created.map((objective, index) => {
    const text = inputs[index]?.description;
    if (typeof text !== 'string' || !text.trim()) return objective;
    const warnings = objectiveDescriptionStyleWarnings(text.trim());
    return warnings.length > 0 ? { ...objective, warnings } : objective;
  });
}

const DESCRIPTION_REQUEST_MODES = ['summarize', 'regenerate', 'retry'] as const;

export const missionSubcommands: SubcommandTable = {
  // Mission creation and discovery -----------------------------------------
  create: {
    // Gated per project inside the handler (requireProjectPermission), after
    // the unassigned-inbox branch has been ruled out.
    permission: null,
    handler: async (ctx, body) => {
      const objectives = objectiveInputs(body);
      const projectId = strFlag(body, '--project-id');
      // `--inbox` was the retired compatibility alias (ADR 0054).
      rejectRemovedProtocolFlags(body, ['--inbox']);
      const unassignedToProject = boolFlag(body, '--unassigned-to-project');
      if (unassignedToProject) {
        if (getActiveTokenProjectIds() !== null) throw new ApiError(404, 'Not found');
        if (projectId) {
          throw new ApiError(
            400,
            '--project-id cannot be combined with --unassigned-to-project',
            undefined,
            'project_creation_scope_conflict'
          );
        }
        const first = objectives[0]?.objective?.trim();
        if (!first) throw new ApiError(400, 'Inbox creation requires an objective');
        return {
          unassigned: true,
          inboxItem: await createInboxItem({
            title: strFlag(body, '--title')?.trim() || first,
            objectives: [first]
          })
        };
      }
      if (!projectId) {
        throw new ApiError(
          400,
          'Mission creation requires --project-id or --unassigned-to-project',
          undefined,
          'project_id_required'
        );
      }
      const resolvedProjectId = await resolveProjectId(ctx, projectId);
      await requireProjectPermission({
        projectId: resolvedProjectId,
        permission: PERMISSIONS.MISSION_CREATE
      });
      const assignedTo = strFlag(body, '--assigned-to');
      const created = await protocolCreate({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId,
        objectives,
        title: strFlag(body, '--title') ?? null,
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
      return { ...created, objectives: withDescriptionWarnings(created.objectives, objectives) };
    }
  },

  prompt: {
    permission: PERMISSIONS.MISSION_CREATE,
    handler: async (ctx, body) => {
      const projectId = strFlag(body, '--project-id');
      if (!projectId) {
        throw new ApiError(
          400,
          'Mission prompt requires --project-id',
          undefined,
          'project_id_required'
        );
      }
      const assignedTo = strFlag(body, '--assigned-to');
      return protocolPrompt({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId,
        objectives: objectiveInputs(body),
        title: strFlag(body, '--title') ?? null,
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        externalSessionId: externalSessionId(body),
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
    }
  },

  'load-context': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      loadMissionContext({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body),
        executionTargetId: strFlag(body, '--execution-target-id') ?? null
      })
  },

  'list-deliveries': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (_ctx, body) => listMissionDeliveries(missionRefFlag(body))
  },

  'objective-changes': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) => {
      const objectiveId = objectiveRefFlag(body);
      if (!objectiveId) throw new ApiError(400, 'objective-changes requires --objective-id');
      return listObjectiveFileChanges({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId,
        instructionStyle: instructionStyleFor(connectionMethodFlag(body))
      });
    }
  },

  'launch-objective': {
    permission: PERMISSIONS.EXECUTION_REQUEST_CREATE,
    handler: (_ctx, body) =>
      launchObjective(requireFlag(body, '--objective-id'), {
        agent: requireFlag(body, '--agent'),
        ...(strFlag(body, '--model') !== undefined ? { model: strFlag(body, '--model') } : {}),
        ...(strFlag(body, '--reasoning-effort') !== undefined
          ? { reasoningEffort: strFlag(body, '--reasoning-effort') }
          : {}),
        ...(strFlag(body, '--execution-target-id') !== undefined
          ? { executionTargetId: strFlag(body, '--execution-target-id') }
          : {})
      })
  },

  'reorder-objectives': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    handler: (_ctx, body) => {
      const orderedObjectiveIds = parseJsonInput<string[]>(
        body,
        '--ordered-objective-ids-json',
        '--ordered-objective-ids-file'
      );
      if (orderedObjectiveIds === undefined) {
        throw new ApiError(400, 'Missing required flag: --ordered-objective-ids-json');
      }
      return reorderObjectives(missionRefFlag(body), { orderedObjectiveIds });
    }
  },

  search: {
    // Not enforced at dispatch: v2/v3 and --reference authorize per workspace or project.
    permission: PERMISSIONS.MISSION_READ,
    handler: async (_ctx, body) => {
      if (hasFlag(body, '--reference')) {
        const reference = strFlag(body, '--reference');
        if (!reference) throw new ApiError(400, '--reference requires a value');
        return searchExactReference(body, reference);
      }
      if (hasFlag(body, '--cursor')) {
        throw new ApiError(400, '--cursor applies only to an exact --reference lookup');
      }
      // Version 1 (the legacy array) is retired (ADR 0054); omitted means v3.
      const responseVersion = hasFlag(body, '--response-version')
        ? intFlag(body, '--response-version')
        : 3;
      if (responseVersion !== 2 && responseVersion !== 3) {
        throw new ApiError(
          400,
          '--response-version must be 2 or 3 (version 1 is retired)',
          undefined,
          'invalid_input'
        );
      }
      const version: 2 | 3 = responseVersion;
      // Flags map onto the REST query names so every surface shares one parser
      // and its validation. `--project-id` is a human project reference resolved
      // below, so it never reaches the UUID-only `projectIds` check.
      const options = parseMissionSearchOptions(
        {
          q: strFlag(body, '--query'),
          statusTypes: strFlag(body, '--status'),
          resourceKeys: strFlag(body, '--resource-key'),
          dateField: strFlag(body, '--date-field'),
          from: strFlag(body, '--from'),
          to: strFlag(body, '--to'),
          limit: strFlag(body, '--limit'),
          entityTypes: strFlag(body, '--entity-types'),
          objectiveStates: strFlag(body, '--objective-states'),
          matchesPerResult: strFlag(body, '--matches-per-result')
        },
        { version }
      );
      const projectRef = strFlag(body, '--project-id') ?? null;
      const limit = options.limit ?? 25;

      // V2/V3 are organization-bounded aggregate reads. They must not inherit the
      // one workspace selected for ordinary protocol entity operations.
      const search = {
        ...options,
        projectIds: await resolveV2SearchProjectId(projectRef, strFlag(body, '--workspace-id')),
        limit
      };
      return version === 3
        ? searchMissionsAcrossWorkspacesV3(search)
        : searchMissionsAcrossWorkspacesV2(search);
    }
  },

  'discuss-objective': {
    permission: PERMISSIONS.OBJECTIVE_SUBMIT,
    handler: (ctx, body) =>
      discussObjective({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body)
      })
  },

  'add-objectives': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    handler: async (ctx, body) => {
      const objectives = withDefaultAgentSelection(
        withDefaultAutoAdvance(parseObjectiveArrayInput(body) ?? [], optionalAutoAdvanceFlag(body)),
        body
      );
      const created = await addObjectivesToMission({
        ctx: await withAgentOrigin({ ctx, body }),
        missionId: missionRefFlag(body),
        objectives
      });
      return withDescriptionWarnings(created, objectives);
    }
  },

  'update-objective': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    handler: async (ctx, body) => {
      const objectiveId = requireFlag(body, '--objective-id');
      const update: UpdateObjectiveBody = {};
      const autoAdvance = optionalAutoAdvanceFlag(body);
      if (autoAdvance !== undefined) {
        update.autoAdvance = autoAdvance;
      }
      if (hasFlag(body, '--title')) {
        update.title = strFlag(body, '--title') ?? '';
      }
      if (hasFlag(body, '--instruction-text') || hasFlag(body, '--instruction-text-file')) {
        await assertDraftOnProtocolSurface(objectiveId, 'instruction text');
        update.instructionText =
          resolveInput(body, '--instruction-text', '--instruction-text-file') ?? '';
      }
      const hasDescription = hasFlag(body, '--description') || hasFlag(body, '--description-file');
      const descriptionRequest = strFlag(body, '--description-request');
      if (hasFlag(body, '--description-request')) {
        if (
          !descriptionRequest ||
          !(DESCRIPTION_REQUEST_MODES as readonly string[]).includes(descriptionRequest)
        ) {
          throw new ApiError(
            400,
            '--description-request must be summarize, regenerate or retry',
            undefined,
            'invalid_input'
          );
        }
        if (hasDescription) {
          throw new ApiError(
            400,
            '--description-request cannot be combined with --description/--description-file',
            undefined,
            'invalid_input'
          );
        }
      }
      if (hasDescription || descriptionRequest) {
        await assertDraftOnProtocolSurface(objectiveId, 'description');
      }
      if (hasDescription) {
        // An empty value is Remove: the summary stays absent until a person
        // selects Summarize (ADR 0057).
        update.description = resolveInput(body, '--description', '--description-file') ?? '';
      }
      Object.assign(update, objectiveAssignmentUpdate(body));
      if (
        autoAdvance === undefined &&
        update.instructionText === undefined &&
        update.title === undefined &&
        update.description === undefined &&
        update.assignedAgent === undefined &&
        !descriptionRequest
      ) {
        throw new ApiError(
          400,
          'Provide at least one of --title, --description/--description-file, --description-request, --auto-advance/--no-auto-advance, --instruction-text/--instruction-text-file, or --objective-agent'
        );
      }
      // Protocol writes (CLI, hosted MCP) are agent-authored, attached or not.
      const { origin } = await withAgentOrigin({ ctx, body });
      const options = origin ? { origin } : {};
      const result = await updateObjectiveWithWarnings(objectiveId, update, options);
      const warnings: ObjectiveBriefWarning[] = [...result.warnings];
      let objective = result.objective;
      // Advisory style warnings only for text that was actually stored.
      if (
        typeof update.description === 'string' &&
        update.description.trim() &&
        !warnings.some(warning => warning.code === 'description_suppressed')
      ) {
        warnings.push(...objectiveDescriptionStyleWarnings(update.description.trim()));
      }
      if (descriptionRequest) {
        objective = await requestObjectiveDescription(
          objective.id,
          { mode: descriptionRequest },
          options
        );
      }
      return { ...objective, warnings };
    }
  },

  'delete-missions': {
    // Every target can belong to a different authorized workspace. The bulk
    // services preflight the corresponding permission per target inside their
    // transaction, before any destructive write occurs.
    permission: null,
    handler: async (_ctx, body) => {
      if (!boolFlag(body, '--confirm')) {
        throw new ApiError(
          400,
          'delete-missions requires --confirm',
          undefined,
          'confirmation_required'
        );
      }
      return deleteMissions(
        parseDeletionReferences(body, '--mission-ids-json', '--mission-ids-file', 'missionIds')
      );
    }
  },

  'delete-objectives': {
    // Preflighted per target, as for delete-missions.
    permission: null,
    handler: async (_ctx, body) => {
      if (!boolFlag(body, '--confirm')) {
        throw new ApiError(
          400,
          'delete-objectives requires --confirm',
          undefined,
          'confirmation_required'
        );
      }
      return deleteObjectives(
        parseDeletionReferences(
          body,
          '--objective-ids-json',
          '--objective-ids-file',
          'objectiveIds'
        )
      );
    }
  },

  'record-work': {
    permission: PERMISSIONS.MISSION_CREATE,
    handler: async (ctx, body) => {
      rejectRemovedProtocolFlags(body, RETIRED_RECORD_WORK_FLAGS);
      const envelope = parseDeliveryPayloadEnvelope(body);
      rejectRemovedProtocolPayloadFields(
        envelope.payloadJson,
        'record-work',
        RETIRED_RECORD_WORK_FIELDS
      );
      // record-work is often driven from a single streamed JSON envelope, so
      // `objective` and `title` may arrive either as flags or as fields inside
      // `--payload-json`/`--payload-file`. Pull them out of the leftover payload
      // here (flags always win) and keep the rest (e.g. `deliveryReport`) as the
      // stored delivery payload.
      const {
        objective: payloadObjective,
        title: payloadTitle,
        ...restPayload
      } = envelope.payloadJson ?? {};
      const artifacts = parseJsonArrayInput<ArtifactInput>(
        body,
        '--artifacts',
        '--artifacts-file',
        'artifacts'
      );
      const declaredPaths = parseJsonArrayInput<unknown>(
        body,
        '--declared-paths-json',
        '--declared-paths-file',
        'declaredPaths'
      );
      const objective =
        strFlag(body, '--objective') ??
        ((body.positional ?? []).join(' ').trim() || undefined) ??
        (typeof payloadObjective === 'string' ? payloadObjective : undefined);
      if (!objective || !objective.trim()) {
        throw new ApiError(
          400,
          'Missing objective text (use --objective, a positional argument, or an "objective" field in --payload-json)'
        );
      }
      const projectId = strFlag(body, '--project-id');
      if (!projectId) {
        throw new ApiError(
          400,
          'record-work requires --project-id',
          undefined,
          'project_id_required'
        );
      }
      const assignedTo = strFlag(body, '--assigned-to');
      return recordWork({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId,
        summary: resolveInput(body, '--summary', '--summary-file') ?? envelope.summary ?? '',
        objective,
        title: strFlag(body, '--title') ?? (typeof payloadTitle === 'string' ? payloadTitle : null),
        artifacts: artifacts ?? envelope.artifacts ?? [],
        declaredPaths: declaredPaths ?? envelope.declaredPaths,
        payloadJson: restPayload,
        missionSummary: envelope.missionSummary,
        operationId: envelope.operationId,
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
    }
  }
};
