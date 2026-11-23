import { PERMISSIONS } from '@overlord/auth';

import { listObjectiveFileChanges } from '../../packages/core/service/changes.ts';
import { resolveProjectId, type ServiceContext } from '../../packages/core/service/context.ts';
import {
  type ObjectiveBriefWarning,
  objectiveSummaryPlacementWarnings,
  objectiveSummaryStyleWarnings
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
import { getActiveTokenProjectIds, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { launchObjective } from '../execution/launch.ts';
import { resolveObjectiveIdForRest } from '../objective-ref.ts';
import { requireProjectPermission } from '../rbac.ts';
import {
  createInboxItem,
  deleteMissions,
  deleteObjectives,
  listMissionDeliveries,
  reorderObjectives,
  requestObjectiveSummary,
  updateObjectiveWithWarnings
} from '../repository.ts';

import { readProtocolAddress, resolveSessionId } from './addressing.ts';
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
  connectionMethodFlag,
  externalSessionId,
  missionRefFlag,
  objectiveRefFlag,
  parseJsonArrayInput,
  parseJsonInput,
  type ProtocolRequestBody,
  requireFlag,
  requireFlagValue,
  resolveInput,
  strFlag,
  type SubcommandTable
} from './flags.ts';
import {
  objectiveInputs,
  objectiveUpdateFromFlags,
  optionalAutoAdvanceFlag,
  parseDeletionReferences,
  parseObjectiveArrayInput,
  withDefaultAgentSelection,
  withDefaultAutoAdvance,
  withSummaryWarnings
} from './objective-input.ts';

// ---- Mission and objective protocol subcommands ---------------------------
//
// Mission creation, discovery, objective edits, deletion, and
// record-work, spread into the dispatch table in backend/protocol.ts.

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
      sessionId: await resolveSessionId(readProtocolAddress(body).sessionKey)
    }
  };
}

/**
 * Agent protocol surfaces may edit instruction text only on draft objectives.
 * Agent summary edits and summary requests stay inside the same planning
 * scope (ADR 0059); people edit summaries in any state over REST.
 */
async function assertDraftOnProtocolSurface(
  objectiveRef: string,
  what: 'instruction text' | 'summary'
): Promise<{ instructionText: string }> {
  const db = requireDatabaseClient();
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveRef, db });
  const row = (await db.get(
    `SELECT state, instruction_text FROM objectives
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [resolved.id, resolved.workspaceId]
  )) as { state: string; instruction_text: string | null } | undefined;
  if (!row) {
    throw new ApiError(404, 'Objective not found');
  }
  if (row.state !== 'draft') {
    throw new ApiError(
      400,
      what === 'summary'
        ? 'An agent can change an objective summary or request a summary only in draft state'
        : 'Objective instruction text can only be edited in draft state',
      undefined,
      what === 'summary' ? 'summary_not_editable' : undefined
    );
  }
  return { instructionText: row.instruction_text ?? '' };
}

export const missionSubcommands: SubcommandTable = {
  // Mission creation and discovery -----------------------------------------
  create: {
    // Gated per project inside the handler (requireProjectPermission), after
    // the unassigned-inbox branch has been ruled out.
    permission: null,
    projectAutomation: 'admitted',
    handler: async (ctx, body) => {
      const objectives = objectiveInputs(body);
      const projectId = readProtocolAddress(body).projectRef;
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
        const first = objectives[0]?.instructions?.trim();
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
      return { ...created, objectives: withSummaryWarnings(created.objectives, objectives) };
    }
  },

  prompt: {
    permission: PERMISSIONS.MISSION_CREATE,
    projectAutomation: 'denied',
    handler: async (ctx, body) => {
      const projectId = readProtocolAddress(body).projectRef;
      if (!projectId) {
        throw new ApiError(
          400,
          'Mission prompt requires --project-id',
          undefined,
          'project_id_required'
        );
      }
      const assignedTo = strFlag(body, '--assigned-to');
      const objectives = objectiveInputs(body);
      const attached = await protocolPrompt({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId,
        objectives,
        title: strFlag(body, '--title') ?? null,
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        externalSessionId: externalSessionId(body),
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
      // The attach response has no per-objective list, so a possible swap is
      // reported once at the top level (coo:1321).
      const warnings = objectives.flatMap(input =>
        typeof input.summary === 'string' && input.summary.trim()
          ? objectiveSummaryPlacementWarnings({
              instructions: input.instructions,
              summary: input.summary
            })
          : []
      );
      return warnings.length > 0 ? { ...attached, warnings } : attached;
    }
  },

  'load-context': {
    permission: PERMISSIONS.MISSION_READ,
    projectAutomation: 'admitted',
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
    projectAutomation: 'admitted',
    handler: (_ctx, body) => listMissionDeliveries(missionRefFlag(body))
  },

  'objective-changes': {
    permission: PERMISSIONS.MISSION_READ,
    projectAutomation: 'admitted',
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
    projectAutomation: 'denied',
    handler: (_ctx, body) =>
      launchObjective(requireFlagValue(readProtocolAddress(body).objectiveRef, '--objective-id'), {
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
    projectAutomation: 'denied',
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

  'discuss-objective': {
    permission: PERMISSIONS.OBJECTIVE_SUBMIT,
    projectAutomation: 'denied',
    handler: (ctx, body) =>
      discussObjective({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body)
      })
  },

  'add-objectives': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    projectAutomation: 'denied',
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
      return withSummaryWarnings(created, objectives);
    }
  },

  'update-objective': {
    permission: PERMISSIONS.OBJECTIVE_UPDATE,
    projectAutomation: 'denied',
    addressing: 'objective-only',
    handler: async (ctx, body) => {
      const objectiveId = requireFlagValue(
        readProtocolAddress(body).objectiveRef,
        '--objective-id'
      );
      const { update, wantsSummaryRequest, placement } = await objectiveUpdateFromFlags(
        body,
        what => assertDraftOnProtocolSurface(objectiveId, what)
      );
      // Protocol writes (CLI, hosted MCP) are agent-authored, attached or not.
      const { origin } = await withAgentOrigin({ ctx, body });
      const options = origin ? { origin } : {};
      const result = await updateObjectiveWithWarnings(objectiveId, update, options);
      const warnings: ObjectiveBriefWarning[] = [...result.warnings];
      let objective = result.objective;
      // Advisory style warnings only for text that was actually stored.
      if (placement && !warnings.some(warning => warning.code === 'summary_suppressed')) {
        warnings.push(
          ...objectiveSummaryPlacementWarnings(placement),
          ...objectiveSummaryStyleWarnings(placement.summary.trim())
        );
      }
      if (wantsSummaryRequest) {
        objective = await requestObjectiveSummary(
          objective.id,
          { mode: wantsSummaryRequest },
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
    projectAutomation: 'denied',
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
    projectAutomation: 'denied',
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
    projectAutomation: 'denied',
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
      const projectId = readProtocolAddress(body).projectRef;
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
