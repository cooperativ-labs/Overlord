/**
 * Inbox item attachments.
 *
 * A profile-owned inbox item has no workspace, so its files are stored in the
 * owner's storage workspace: the workspace of the item's earlier attachments,
 * else the request's active workspace, else the owner's oldest membership that
 * grants `attachment:create`. Rows carry `inbox_item_id` with no project,
 * mission, or objective, and are authorized by item ownership. Like inbox
 * items themselves they stay outside workspace realtime: no entity change is
 * recorded until promotion re-points them at the created mission's first
 * objective.
 *
 * Byte I/O, the `attachments` row insert, tombstone, and cleanup select are the
 * shared primitives in backend/storage.ts; this module owns only the Inbox
 * rules (ownership gate, storage-workspace selection, cross-workspace copy, and
 * re-point on promotion). backend/storage.ts never imports this module.
 */

import { PERMISSIONS } from '@overlord/auth';
import type { ObjectiveAttachmentDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import path from 'node:path';

import {
  getImplicitWorkspaceIdOrNull,
  getResourceLookupWorkspaceIds,
  nowIso,
  recordChange,
  requireDatabaseClient
} from './db.ts';
import { ApiError } from './errors.ts';
import { requireWorkspacePermission } from './rbac.ts';
import {
  assertAttachmentBytes,
  ATTACHMENT_COLUMNS,
  attachmentObjectKey,
  type AttachmentRow,
  ATTACHMENTS_BUCKET_KEY,
  type AttachmentStoredObject,
  attachmentStoredObjects,
  insertAttachmentRow,
  ownedInboxItemId,
  readStoredBytes,
  removeStoredObjects,
  resolveBucket,
  storageBackendFor,
  type StoredObjectRef,
  tombstoneAttachmentRows,
  toObjectiveAttachmentDto,
  writeAttachmentObject
} from './storage.ts';

async function inboxAttachmentWorkspace(
  inboxItemId: string
): Promise<{ workspaceId: string; workspaceUserId: string }> {
  const client = requireDatabaseClient();
  const existing = await client.get<{ workspace_id: string }>(
    `SELECT workspace_id FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [inboxItemId]
  );
  const memberships = await getResourceLookupWorkspaceIds(client);
  const implicit = getImplicitWorkspaceIdOrNull();
  const candidates = [
    ...(existing ? [existing.workspace_id] : []),
    ...(implicit && memberships.includes(implicit) ? [implicit] : []),
    ...memberships
  ];
  let denied: unknown = null;
  for (const workspaceId of new Set(candidates)) {
    try {
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId,
        permission: PERMISSIONS.ATTACHMENT_CREATE,
        db: client
      });
      return { workspaceId, workspaceUserId };
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404)) {
        throw error;
      }
      denied ??= error;
    }
  }
  if (denied) throw denied;
  throw new ApiError(409, 'Join a workspace before attaching files to Inbox items');
}

async function listInboxAttachmentRows(
  inboxItemId: string,
  client: DatabaseClient
): Promise<AttachmentRow[]> {
  return client.all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [inboxItemId]
  );
}

export interface UploadInboxAttachmentInput {
  inboxItemId: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
}

/** Store an uploaded file against one of the caller's inbox items. */
export async function uploadInboxItemAttachment(
  input: UploadInboxAttachmentInput
): Promise<ObjectiveAttachmentDto> {
  assertAttachmentBytes(input.bytes);
  const inboxItemId = await ownedInboxItemId(input.inboxItemId);
  const { workspaceId, workspaceUserId } = await inboxAttachmentWorkspace(inboxItemId);
  const bucket = await resolveBucket(ATTACHMENTS_BUCKET_KEY, workspaceId);
  const written = await writeAttachmentObject(bucket, workspaceId, input);

  let row: AttachmentRow;
  try {
    row = await requireDatabaseClient().transaction(async tx => {
      // Re-check inside the write so a concurrent delete/promotion of the item
      // cannot leave a row pointing at a consumed capture.
      await ownedInboxItemId(inboxItemId, tx);
      return insertAttachmentRow(
        tx,
        written,
        { projectId: null, missionId: null, objectiveId: null, inboxItemId },
        workspaceUserId
      );
    });
  } catch (error) {
    await removeStoredObjects([{ key: written.storageKey, bucket }]);
    throw error;
  }

  return toObjectiveAttachmentDto(row);
}

/** List an owned inbox item's active attachments, oldest first. */
export async function listInboxItemAttachments(
  inboxItemId: string
): Promise<ObjectiveAttachmentDto[]> {
  const client = requireDatabaseClient();
  const id = await ownedInboxItemId(inboxItemId, client);
  return (await listInboxAttachmentRows(id, client)).map(toObjectiveAttachmentDto);
}

/**
 * Tombstone attachment rows that never entered a workspace feed. Returns the
 * stored objects to remove once the caller's transaction commits.
 */
async function tombstoneInboxAttachments(
  tx: DatabaseClient,
  attachments: AttachmentStoredObject[]
): Promise<StoredObjectRef[]> {
  await tombstoneAttachmentRows(
    tx,
    attachments.map(attachment => attachment.id)
  );
  return attachments.map(attachment => attachment.object);
}

/** Soft-delete one inbox attachment and return the item's remaining attachments. */
export async function deleteInboxItemAttachment(
  inboxItemId: string,
  attachmentId: string
): Promise<ObjectiveAttachmentDto[]> {
  const { remaining, cleanup } = await requireDatabaseClient().transaction(async tx => {
    const id = await ownedInboxItemId(inboxItemId, tx);
    const attachments = await attachmentStoredObjects(tx, {
      by: 'inbox-attachment',
      attachmentId,
      inboxItemId: id
    });
    if (attachments.length === 0) throw new ApiError(404, 'Attachment not found');
    const cleanup = await tombstoneInboxAttachments(tx, attachments);
    const remaining = (await listInboxAttachmentRows(id, tx)).map(toObjectiveAttachmentDto);
    return { remaining, cleanup };
  });
  await removeStoredObjects(cleanup);
  return remaining;
}

/**
 * Tombstone every active attachment of an inbox item inside the caller's
 * transaction (item deletion, account deletion). The caller passes the
 * returned objects to {@link removeStoredObjects} after commit.
 */
export async function tombstoneInboxItemAttachmentsTx(
  tx: DatabaseClient,
  where: { inboxItemId: string } | { profileId: string }
): Promise<StoredObjectRef[]> {
  const attachments = await attachmentStoredObjects(
    tx,
    'inboxItemId' in where
      ? { by: 'inbox-item', inboxItemId: where.inboxItemId }
      : { by: 'profile-inbox', profileId: where.profileId }
  );
  return tombstoneInboxAttachments(tx, attachments);
}

/** Bytes copied into the destination workspace ahead of a cross-workspace promotion. */
export interface InboxAttachmentCopy {
  attachmentId: string;
  storageBucketId: string;
  storageKey: string;
  source: StoredObjectRef;
  target: StoredObjectRef;
}

/**
 * Copy an inbox item's attachments that live outside `targetWorkspaceId` into
 * that workspace's `attachments` bucket, before the promotion transaction. The
 * copies keep their attachment ids under the target workspace's canonical key.
 * If promotion then fails, discard them with {@link removeStoredObjects}.
 */
export async function copyInboxAttachmentsToWorkspace(
  inboxItemId: string,
  targetWorkspaceId: string
): Promise<InboxAttachmentCopy[]> {
  const attachments = await attachmentStoredObjects(requireDatabaseClient(), {
    by: 'inbox-item',
    inboxItemId,
    outsideWorkspaceId: targetWorkspaceId
  });
  if (attachments.length === 0) return [];
  const bucket = await resolveBucket(ATTACHMENTS_BUCKET_KEY, targetWorkspaceId);
  const backend = storageBackendFor(bucket);
  const copies: InboxAttachmentCopy[] = [];
  try {
    for (const attachment of attachments) {
      const source = attachment.object;
      const storageKey = attachmentObjectKey(
        targetWorkspaceId,
        attachment.id,
        path.extname(source.key)
      );
      await backend.put({
        key: storageKey,
        bytes: await readStoredBytes(source),
        contentType: attachment.contentType ?? 'application/octet-stream'
      });
      copies.push({
        attachmentId: attachment.id,
        storageBucketId: bucket.id,
        storageKey,
        source,
        target: { key: storageKey, bucket }
      });
    }
  } catch (error) {
    await removeStoredObjects(copies.map(copy => copy.target));
    throw error;
  }
  return copies;
}

/**
 * Inside the promotion transaction, re-point every active attachment of the
 * inbox item at the created mission's first objective and clear
 * `inbox_item_id`. Rows outside the destination workspace must have a copy from
 * {@link copyInboxAttachmentsToWorkspace}; one added after the copy step makes
 * the promotion retryable (409) rather than leave bytes in a foreign bucket.
 */
export async function repointInboxAttachmentsTx(
  tx: DatabaseClient,
  input: {
    inboxItemId: string;
    workspaceId: string;
    projectId: string;
    missionId: string;
    objectiveId: string;
    copies: InboxAttachmentCopy[];
  }
): Promise<void> {
  const rows = await tx.all<{ id: string; workspace_id: string; revision: number }>(
    `SELECT id, workspace_id, revision FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [input.inboxItemId]
  );
  const copies = new Map(input.copies.map(copy => [copy.attachmentId, copy]));
  const now = nowIso();
  for (const row of rows) {
    const changedFields = ['project_id', 'mission_id', 'objective_id', 'inbox_item_id'];
    if (row.workspace_id === input.workspaceId) {
      await tx.run(
        `UPDATE attachments
            SET project_id = ?, mission_id = ?, objective_id = ?, inbox_item_id = NULL,
                updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [input.projectId, input.missionId, input.objectiveId, now, row.id]
      );
    } else {
      const copy = copies.get(row.id);
      if (!copy) {
        throw new ApiError(409, 'Inbox attachments changed during promotion. Try again.');
      }
      await tx.run(
        `UPDATE attachments
            SET workspace_id = ?, storage_bucket_id = ?, storage_key = ?,
                project_id = ?, mission_id = ?, objective_id = ?, inbox_item_id = NULL,
                updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [
          input.workspaceId,
          copy.storageBucketId,
          copy.storageKey,
          input.projectId,
          input.missionId,
          input.objectiveId,
          now,
          row.id
        ]
      );
      changedFields.unshift('workspace_id', 'storage_bucket_id', 'storage_key');
    }
    await recordChange(
      {
        entityType: 'attachment',
        entityId: row.id,
        operation: 'update',
        entityRevision: row.revision + 1,
        projectId: input.projectId,
        missionId: input.missionId,
        objectiveId: input.objectiveId,
        workspaceId: input.workspaceId,
        changedFields
      },
      tx
    );
  }
}
