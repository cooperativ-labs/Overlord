import { PERMISSIONS } from '@overlord/auth';
import type { CaptureBindingState } from '@overlord/contract';

import {
  askQuestion,
  attachSession,
  connectSession,
  deliverSession,
  heartbeatSession,
  recordHookEvent,
  resumeFollowUp,
  syncChanges,
  updateSession
} from '../../packages/core/service/protocol.ts';

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

// ---- Session lifecycle protocol subcommands -------------------------------
//
// attach/connect through deliver: the agent-session lifecycle, spread into the
// dispatch table in backend/protocol.ts.

/** Optional `--capture-binding bound|unbound|unknown`, validated by the service. */
function captureBindingFlag(body: Parameters<typeof strFlag>[0]): CaptureBindingState | undefined {
  const value = strFlag(body, '--capture-binding');
  return value === undefined ? undefined : (value as CaptureBindingState);
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

export const sessionSubcommands: SubcommandTable = {
  // Session lifecycle ------------------------------------------------------
  attach: {
    permission: PERMISSIONS.SESSION_ATTACH,
    handler: (ctx, body) =>
      attachSession({
        ctx,
        missionId: missionRefFlag(body),
        agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
        modelIdentifier: strFlag(body, '--model') ?? null,
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
        declaredPaths: declaredPathsInput(body)
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
        followUpNotes: strFlag(body, '--follow-up-notes') ?? envelope.followUpNotes ?? null
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
        externalSessionId: externalSessionId(body),
        summary: resolveInput(body, '--summary', '--summary-file') ?? null,
        executionTargetId: strFlag(body, '--execution-target-id') ?? null
      })
  }
};
