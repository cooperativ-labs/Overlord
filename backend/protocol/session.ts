import { PERMISSIONS } from '@overlord/auth';
import type { CaptureBindingState } from '@overlord/contract';

import { readDeliveryReceipt } from '../../packages/core/service/delivery-finalization.ts';
import {
  publishDeliverySummary,
  readDeliverySummaryContext
} from '../../packages/core/service/delivery-summary-publication.ts';
import {
  askQuestion,
  ATTACH_CONNECTION_METHODS,
  attachSession,
  closeAgentMissionItems,
  connectSession,
  deliverSession,
  heartbeatSession,
  readAgentMissionItems,
  readAgentProjectItems,
  recordHookEvent,
  resumeFollowUp,
  syncChanges,
  updateSession
} from '../../packages/core/service/protocol.ts';
import { readReportDraft } from '../../packages/core/service/report-draft.ts';
import { ApiError } from '../errors.ts';

import {
  type ArtifactInput,
  parseDeliveryPayloadEnvelope,
  rejectRemovedProtocolFlags,
  rejectRemovedProtocolPayloadFields,
  RETIRED_CHANGE_TRACKING_FLAGS
} from './delivery-payload.ts';
import {
  boolFlag,
  externalSessionId,
  missionRefFlag,
  objectiveRefFlag,
  parseJsonArrayInput,
  parseJsonObjectInput,
  requireFlag,
  resolveInput,
  strFlag,
  type SubcommandTable
} from './flags.ts';

/** `--connection-method mcp` words publication instructions for MCP tools. */
function publicationStyleFlag(body: Parameters<typeof strFlag>[0]): 'cli' | 'mcp' {
  return strFlag(body, '--connection-method') === 'mcp' ? 'mcp' : 'cli';
}

// ---- Session lifecycle protocol subcommands -------------------------------
//
// attach/connect through deliver: the agent-session lifecycle, spread into the
// dispatch table in backend/protocol.ts.

/** Optional `--capture-binding bound|unbound|unknown`, validated by the service. */
function captureBindingFlag(body: Parameters<typeof strFlag>[0]): CaptureBindingState | undefined {
  const value = strFlag(body, '--capture-binding');
  return value === undefined ? undefined : (value as CaptureBindingState);
}

/**
 * Optional `--connection-method cli|mcp` (default cli). MCP servers send `mcp`
 * so `agentInstructions` names MCP tools and payload fields instead of CLI flags.
 */
export function connectionMethodFlag(body: Parameters<typeof strFlag>[0]): string | undefined {
  const value = strFlag(body, '--connection-method');
  if (value === undefined) return undefined;
  if (!(ATTACH_CONNECTION_METHODS as readonly string[]).includes(value)) {
    throw new ApiError(
      400,
      `--connection-method must be one of: ${ATTACH_CONNECTION_METHODS.join(', ')}`,
      undefined,
      'invalid_input'
    );
  }
  return value;
}

/** Agent-declared shell/script outputs, deletes, and renames (`--declared-paths-json|file`). */
function declaredPathsInput(body: Parameters<typeof strFlag>[0]): unknown[] | undefined {
  return parseJsonArrayInput<unknown>(
    body,
    '--declared-paths-json',
    '--declared-paths-file',
    'declaredPaths'
  );
}

/**
 * `--report-draft-json|--report-draft-file` (ADR 0078): the reportDraft object.
 * On deliver, `--expected-draft-revision <n>` is shorthand for
 * `{ "expectedRevision": n }` with no final operations.
 */
export function reportDraftInput(
  body: Parameters<typeof strFlag>[0],
  { allowRevisionShorthand }: { allowRevisionShorthand: boolean }
): Record<string, unknown> | undefined {
  const input = parseJsonObjectInput(
    body,
    '--report-draft-json',
    '--report-draft-file',
    'reportDraft'
  );
  const revision = allowRevisionShorthand ? strFlag(body, '--expected-draft-revision') : undefined;
  if (revision === undefined) return input;
  if (input !== undefined) {
    throw new ApiError(
      400,
      'Use either --expected-draft-revision or --report-draft-json/--report-draft-file, not both',
      undefined,
      'invalid_input'
    );
  }
  if (!/^\d+$/.test(revision)) {
    throw new ApiError(
      400,
      '--expected-draft-revision must be a non-negative integer',
      undefined,
      'invalid_input'
    );
  }
  return { expectedRevision: Number(revision) };
}

export const sessionSubcommands: SubcommandTable = {
  'project-items': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      readAgentProjectItems({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body) ?? undefined,
        sessionKey: requireFlag(body, '--session-key'),
        kinds: strFlag(body, '--kind')
          ?.split(',')
          .map(s => s.trim()),
        query: strFlag(body, '--query'),
        paths: strFlag(body, '--path')
          ?.split(',')
          .map(s => s.trim()),
        includeOwnMission: boolFlag(body, '--include-own-mission'),
        limit: Number(strFlag(body, '--limit') ?? 20),
        offset: Number(strFlag(body, '--offset') ?? 0)
      })
  },
  'mission-items': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      readAgentMissionItems({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        limit: Number(strFlag(body, '--limit') ?? 60),
        offset: Number(strFlag(body, '--offset') ?? 0)
      })
  },
  'close-items': {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) =>
      closeAgentMissionItems({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        closeItems: parseJsonArrayInput(
          body,
          '--close-items-json',
          '--close-items-file',
          'closeItems'
        )
      })
  },
  // Session lifecycle ------------------------------------------------------
  attach: {
    permission: PERMISSIONS.SESSION_ATTACH,
    handler: (ctx, body) =>
      attachSession({
        ctx,
        missionId: missionRefFlag(body),
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        modelIdentifier: strFlag(body, '--model') ?? null,
        connectionMethod: connectionMethodFlag(body),
        existingSessionKey: strFlag(body, '--session-key') ?? null,
        externalSessionId: externalSessionId(body),
        executionRequestId: strFlag(body, '--execution-request-id') ?? null,
        executionTargetId: strFlag(body, '--execution-target-id') ?? null,
        // The channel id only. Its credential never travels in a protocol flag — it reaches the
        // backend solely as an Authorization header on the adapter route family.
        sessionChannelId: strFlag(body, '--session-channel-id') ?? null,
        objectiveId: objectiveRefFlag(body),
        captureBindingState: captureBindingFlag(body)
      })
  },

  connect: {
    permission: PERMISSIONS.SESSION_ATTACH,
    handler: (ctx, body) =>
      connectSession({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body),
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        externalSessionId: externalSessionId(body)
      })
  },

  update: {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) => {
      rejectRemovedProtocolFlags(body, RETIRED_CHANGE_TRACKING_FLAGS);
      const payloadJson = parseJsonObjectInput(
        body,
        '--payload-json',
        '--payload-file',
        'update payload'
      );
      rejectRemovedProtocolPayloadFields(payloadJson, 'update');
      return updateSession({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        summary: resolveInput(body, '--summary', '--summary-file') ?? '',
        phase: strFlag(body, '--phase') ?? null,
        eventType: strFlag(body, '--event-type') ?? 'update',
        payloadJson,
        externalUrl: strFlag(body, '--external-url') ?? null,
        externalSessionId: externalSessionId(body),
        beginFollowUpWork: boolFlag(body, '--begin-follow-up-work'),
        followUpIntent: strFlag(body, '--follow-up-intent') ?? null,
        declaredPaths: declaredPathsInput(body),
        reportDraft: reportDraftInput(body, { allowRevisionShorthand: false })
      });
    }
  },

  'sync-changes': {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) => {
      const changes =
        parseJsonArrayInput<unknown>(
          body,
          '--changes-json',
          '--changes-file',
          'sync-changes input'
        ) ?? [];
      const capture = parseJsonObjectInput(
        body,
        '--capture-json',
        '--capture-file',
        'sync-changes capture'
      );
      return syncChanges({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        changes,
        ...(capture !== undefined ? { capture } : {})
      });
    }
  },

  heartbeat: {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) =>
      heartbeatSession({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        phase: strFlag(body, '--phase') ?? null,
        note: strFlag(body, '--note') ?? null
      })
  },

  ask: {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) =>
      askQuestion({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        question: resolveInput(body, '--question', '--question-file') ?? '',
        options:
          parseJsonArrayInput<{
            optionId: string;
            label: string;
            kind: string;
          }>(body, '--options-json', '--options-file', 'ask options') ?? [],
        allowsFreeText: !boolFlag(body, '--no-free-text')
      })
  },

  deliver: {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) => {
      rejectRemovedProtocolFlags(body, RETIRED_CHANGE_TRACKING_FLAGS);
      const envelope = parseDeliveryPayloadEnvelope(body);
      rejectRemovedProtocolPayloadFields(envelope.payloadJson, 'delivery');
      const artifacts = parseJsonArrayInput<ArtifactInput>(
        body,
        '--artifacts',
        '--artifacts-file',
        'artifacts'
      );
      return deliverSession({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        summary: resolveInput(body, '--summary', '--summary-file') ?? envelope.summary ?? '',
        artifacts: artifacts ?? envelope.artifacts ?? [],
        declaredPaths: declaredPathsInput(body) ?? envelope.declaredPaths,
        payloadJson: envelope.payloadJson,
        verificationSummary:
          strFlag(body, '--verification-summary') ?? envelope.verificationSummary ?? null,
        followUpNotes: strFlag(body, '--follow-up-notes') ?? envelope.followUpNotes ?? null,
        missionSummary: envelope.missionSummary,
        operationId: envelope.operationId,
        reportDraft: reportDraftInput(body, { allowRevisionShorthand: true })
      });
    }
  },

  // The caller's own report draft (ADR 0078), with its final inspection while
  // open; --draft-id reads an abandoned or sealed draft of the same objective.
  'report-draft': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      readReportDraft({
        ctx,
        missionId: missionRefFlag(body),
        sessionKey: requireFlag(body, '--session-key'),
        draftId: strFlag(body, '--draft-id') ?? null,
        includeWithdrawn: boolFlag(body, '--include-withdrawn')
      })
  },

  // Scoped read of the caller's own finalization receipt (ADR 0075), by
  // delivery id or by operation id; available after the session ended.
  'delivery-receipt': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      readDeliveryReceipt({
        ctx,
        missionId: strFlag(body, '--mission-id') ?? null,
        deliveryId: strFlag(body, '--delivery-id') ?? null,
        operationId: strFlag(body, '--operation-id') ?? null,
        operationKind: strFlag(body, '--operation-kind') ?? null
      })
  },

  // Narrow post-delivery narrative surface (ADR 0076): the originating agent
  // reads its delivery's publication opportunity and publishes once. The
  // delivered, ended session is accepted here only; no other ended-session
  // authority is granted.
  'delivery-summary-context': {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) =>
      readDeliverySummaryContext({
        ctx,
        missionId: missionRefFlag(body),
        deliveryId: strFlag(body, '--delivery-id') ?? null,
        publicationId: strFlag(body, '--publication-id') ?? null,
        sessionKey: strFlag(body, '--session-key') ?? null,
        style: publicationStyleFlag(body)
      })
  },

  'publish-delivery-summary': {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) => {
      const payload =
        parseJsonObjectInput(
          body,
          '--payload-json',
          '--payload-file',
          'publish-delivery-summary payload'
        ) ?? {};
      const { operationId: payloadOperationId, ...narrative } = payload;
      return publishDeliverySummary({
        ctx,
        missionId: missionRefFlag(body),
        deliveryId: strFlag(body, '--delivery-id') ?? null,
        publicationId: strFlag(body, '--publication-id') ?? null,
        sessionKey: strFlag(body, '--session-key') ?? null,
        operationId: strFlag(body, '--operation-id') ?? payloadOperationId,
        narrative,
        style: publicationStyleFlag(body)
      });
    }
  },

  'hook-event': {
    permission: PERMISSIONS.EVENT_CREATE,
    handler: (ctx, body) =>
      recordHookEvent({
        ctx,
        missionId: missionRefFlag(body),
        hookType: requireFlag(body, '--hook-type'),
        prompt: resolveInput(body, '--prompt', '--prompt-file') ?? '',
        sessionKey: strFlag(body, '--session-key') ?? null,
        externalSessionId: externalSessionId(body) ?? null,
        turnIndex: strFlag(body, '--turn-index') ?? null
      })
  },

  'resume-follow-up': {
    permission: PERMISSIONS.SESSION_ATTACH,
    handler: (ctx, body) =>
      resumeFollowUp({
        ctx,
        missionId: missionRefFlag(body),
        objectiveId: objectiveRefFlag(body),
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        modelIdentifier: strFlag(body, '--model') ?? null,
        connectionMethod: connectionMethodFlag(body),
        externalSessionId: externalSessionId(body),
        summary: resolveInput(body, '--summary', '--summary-file') ?? null,
        executionTargetId: strFlag(body, '--execution-target-id') ?? null
      })
  }
};
