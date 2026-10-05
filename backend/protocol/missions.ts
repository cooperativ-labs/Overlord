import { PERMISSIONS } from '@overlord/auth';
import { type UpdateObjectiveBody } from '@overlord/contract';

import { resolveProjectId, type ServiceContext } from '../../packages/core/service/context.ts';
import { parseMissionSearchOptions } from '../../packages/core/service/mission-search.ts';
import {
  addObjectivesToMission,
  type ChangeRationaleInput,
  discussObjective,
  loadMissionContext,
  protocolCreate,
  protocolPrompt,
  recordWork,
  searchMissions
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
  reorderFutureObjectives,
  searchMissionReferences,
  searchMissionsAcrossWorkspacesV2,
  searchMissionsAcrossWorkspacesV3,
  updateObjective as updateObjectiveRecord
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

/** Agent protocol surfaces may edit instruction text only on queued objectives. */
async function assertInstructionEditableOnProtocolSurface(objectiveRef: string): Promise<void> {
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
  if (row.state !== 'draft' && row.state !== 'future') {
    throw new ApiError(
      400,
      'Objective instruction text can only be edited in draft or future state'
    );
  }
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
    for (const key of ['title', 'agent', 'model', 'resourceKey'] as const) {
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

/** Objective array for create/prompt: `--objectives-json`, else a one-item `--objective`. */
function objectiveInputs(body: ProtocolRequestBody): ObjectiveInput[] {
  const parsed = parseObjectiveArrayInput(body);
  const autoAdvance = optionalAutoAdvanceFlag(body);
  if (parsed !== undefined) {
    return withDefaultAgentSelection(withDefaultAutoAdvance(parsed, autoAdvance), body);
  }
  const resourceKey = strFlag(body, '--resource');
  return withDefaultAgentSelection(
    withDefaultAutoAdvance(
      [
        {
          objective: objectiveText(body),
          ...(resourceKey ? { resourceKey } : {})
        }
      ],
      autoAdvance
    ),
    body
  );
}

type ChangedFileInput = {
  filePath: string;
  vcsStatus?: string | null;
};

export const missionSubcommands: SubcommandTable = {
  // Mission creation and discovery -----------------------------------------
  create: {
    // Gated per project inside the handler (requireProjectPermission), after
    // the unassigned-inbox branch has been ruled out.
    permission: null,
    handler: async (ctx, body) => {
      const objectives = objectiveInputs(body);
      const projectId = strFlag(body, '--project-id');
      const unassignedToProject =
        boolFlag(body, '--unassigned-to-project') || boolFlag(body, '--inbox');
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
      return await protocolCreate({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId,
        objectives,
        title: strFlag(body, '--title') ?? null,
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
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

  'reorder-future-objectives': {
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
      return reorderFutureObjectives(missionRefFlag(body), { orderedObjectiveIds });
    }
  },

  'search-missions': {
    permission: PERMISSIONS.MISSION_READ,
    handler: async (ctx, body) => {
      if (hasFlag(body, '--reference')) {
        const reference = strFlag(body, '--reference');
        if (!reference) throw new ApiError(400, '--reference requires a value');
        return searchExactReference(body, reference);
      }
      if (hasFlag(body, '--cursor')) {
        throw new ApiError(400, '--cursor applies only to an exact --reference lookup');
      }
      const responseVersion = intFlag(body, '--response-version');
      const version = responseVersion === 3 ? 3 : responseVersion === 2 ? 2 : 1;
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
      if (version === 1) return searchMissions({ ctx, ...options, projectId: projectRef, limit });

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
    handler: async (ctx, body) =>
      addObjectivesToMission({
        ctx: await withAgentOrigin({ ctx, body }),
        missionId: missionRefFlag(body),
        objectives: withDefaultAgentSelection(
          withDefaultAutoAdvance(
            parseObjectiveArrayInput(body) ?? [],
            optionalAutoAdvanceFlag(body)
          ),
          body
        )
      })
  },

  'update-objective': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    handler: async (_ctx, body) => {
      const objectiveId = requireFlag(body, '--objective-id');
      const update: UpdateObjectiveBody = {};
      const autoAdvance = optionalAutoAdvanceFlag(body);
      if (autoAdvance !== undefined) {
        update.autoAdvance = autoAdvance;
      }
      if (hasFlag(body, '--instruction-text') || hasFlag(body, '--instruction-text-file')) {
        await assertInstructionEditableOnProtocolSurface(objectiveId);
        update.instructionText =
          resolveInput(body, '--instruction-text', '--instruction-text-file') ?? '';
      }
      if (autoAdvance === undefined && update.instructionText === undefined) {
        throw new ApiError(
          400,
          'Provide at least one of --auto-advance/--no-auto-advance or --instruction-text/--instruction-text-file'
        );
      }
      return updateObjectiveRecord(objectiveId, update);
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
      // `objective`, `title`, and `changedFiles` may arrive either as flags or as
      // fields inside `--payload-json`/`--payload-file`. Pull them out of the
      // leftover payload here (flags always win) and keep the rest (e.g.
      // `deliveryReport`) as the stored delivery payload.
      const {
        objective: payloadObjective,
        title: payloadTitle,
        changedFiles: payloadChangedFiles,
        ...restPayload
      } = envelope.payloadJson ?? {};
      const artifacts = parseJsonArrayInput<ArtifactInput>(
        body,
        '--artifacts',
        '--artifacts-file',
        'artifacts'
      );
      const changeRationales = parseJsonArrayInput<ChangeRationaleInput>(
        body,
        '--change-rationales-json',
        '--change-rationales-file',
        'changeRationales'
      );
      const changedFiles = parseJsonArrayInput<ChangedFileInput>(
        body,
        '--changed-files-json',
        '--changed-files-file',
        'changedFiles'
      );
      if (payloadChangedFiles !== undefined && !Array.isArray(payloadChangedFiles)) {
        throw new ApiError(400, 'changedFiles must be a JSON array', undefined, 'invalid_input');
      }
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
        changeRationales: changeRationales ?? envelope.changeRationales ?? [],
        changedFiles:
          changedFiles ?? (Array.isArray(payloadChangedFiles) ? payloadChangedFiles : []),
        payloadJson: restPayload,
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
    }
  }
};
