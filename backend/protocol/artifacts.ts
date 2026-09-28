import { PERMISSIONS } from '@overlord/auth';
import { type CreateArtifactBody, type UpdateArtifactBody } from '@overlord/contract';

import { listAttachments } from '../../packages/core/service/missions.ts';
import { listSharedContext, writeSharedContext } from '../../packages/core/service/protocol.ts';
import { ApiError } from '../errors.ts';
import { createArtifact, updateArtifact } from '../repository.ts';

import {
  hasFlag,
  intFlag,
  missionRefFlag,
  objectiveRefFlag,
  parseJsonInput,
  requireFlag,
  resolveInput,
  strFlag,
  type SubcommandTable
} from './flags.ts';

// ---- Shared context, artifact, and attachment protocol subcommands --------
//
// Spread into the dispatch table in backend/protocol.ts.

export const artifactSubcommands: SubcommandTable = {
  // Shared context ---------------------------------------------------------
  'read-context': {
    permission: PERMISSIONS.MISSION_READ,
    handler: (ctx, body) =>
      listSharedContext({
        ctx,
        missionId: missionRefFlag(body),
        keySubstring: strFlag(body, '--key') ?? null,
        limit: intFlag(body, '--limit') ?? 50
      })
  },

  'write-context': {
    permission: PERMISSIONS.MISSION_UPDATE,
    handler: (ctx, body) => {
      const valueJson = parseJsonInput<unknown>(body, '--value-json', '--value-file');
      const value = valueJson !== undefined ? valueJson : (strFlag(body, '--value') ?? '');
      return writeSharedContext({
        ctx,
        missionId: missionRefFlag(body),
        key: requireFlag(body, '--key'),
        value
      });
    }
  },

  // Mid-turn artifact create (same service as REST POST). Optional session key
  // stamps session/objective provenance when the agent is on a live turn.
  'add-artifact': {
    permission: PERMISSIONS.ARTIFACT_CREATE,
    handler: (_ctx, body) => {
      const create: CreateArtifactBody = {
        type: requireFlag(body, '--type'),
        label: requireFlag(body, '--label')
      };
      if (hasFlag(body, '--content-text') || hasFlag(body, '--content-text-file')) {
        const content = resolveInput(body, '--content-text', '--content-text-file');
        create.contentText = content !== undefined && content.trim() ? content : null;
      }
      if (hasFlag(body, '--external-url')) {
        const url = strFlag(body, '--external-url');
        create.externalUrl = url !== undefined && url.trim() ? url : null;
      }
      const sessionKey = strFlag(body, '--session-key');
      if (sessionKey) {
        create.sessionKey = sessionKey;
      }
      // Without a live session there is nothing to infer objective provenance
      // from, so an explicit reference is the only way a mid-turn artifact lands
      // on the objective it belongs to.
      const objectiveRef = objectiveRefFlag(body);
      if (objectiveRef) {
        create.objectiveId = objectiveRef;
      }
      return createArtifact(missionRefFlag(body), create);
    }
  },

  // In-place artifact edit (same service as REST PATCH). No session key — a
  // later objective or follow-up can revise an artifact created earlier.
  'update-artifact': {
    permission: PERMISSIONS.MISSION_UPDATE,
    handler: (_ctx, body) => {
      const expectedRevision = intFlag(body, '--expected-revision');
      if (expectedRevision === undefined) {
        throw new ApiError(400, 'Missing required flag: --expected-revision');
      }
      const update: UpdateArtifactBody = { expectedRevision };
      if (hasFlag(body, '--label')) {
        update.label = strFlag(body, '--label') ?? '';
      }
      if (hasFlag(body, '--content-text') || hasFlag(body, '--content-text-file')) {
        const content = resolveInput(body, '--content-text', '--content-text-file');
        update.contentText = content !== undefined && content.trim() ? content : null;
      }
      if (hasFlag(body, '--external-url')) {
        const url = strFlag(body, '--external-url');
        update.externalUrl = url !== undefined && url.trim() ? url : null;
      }
      return updateArtifact(missionRefFlag(body), requireFlag(body, '--artifact-id'), update);
    }
  },

  'attachment-list': {
    permission: PERMISSIONS.ARTIFACT_READ,
    handler: async (ctx, body) => {
      const missionId = missionRefFlag(body);
      const attachments = await listAttachments({
        ctx,
        missionId,
        objectiveId: objectiveRefFlag(body)
      });
      return attachments.map(a => ({
        ...a,
        url: `/api/storage/attachments/${encodeURIComponent(a.storageKey)}`
      }));
    }
  },

  'attachment-download-url': {
    permission: PERMISSIONS.ARTIFACT_READ,
    handler: async (ctx, body) => {
      const missionId = missionRefFlag(body);
      const attachmentId = requireFlag(body, '--attachment-id');
      const attachments = await listAttachments({
        ctx,
        missionId,
        objectiveId: objectiveRefFlag(body)
      });
      const found = attachments.find(a => a.id === attachmentId);
      if (!found) throw new ApiError(404, `Attachment not found: ${attachmentId}`);
      return {
        id: found.id,
        filename: found.filename,
        contentType: found.mimeType,
        url: `/api/storage/attachments/${encodeURIComponent(found.storageKey)}`
      };
    }
  }
};
