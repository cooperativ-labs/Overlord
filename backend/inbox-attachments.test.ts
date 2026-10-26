import { PERMISSIONS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-inbox-attachments-'));
const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID, seedAuthenticatedOperator } =
  await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const { setActiveProfileId, setActiveWorkspace, setActiveWorkspaceUser, withRequestContextAsync } =
  await import('./db.ts');
const { ApiError } = await import('./errors.ts');
const {
  createInboxItem,
  createProject,
  deleteInboxItem,
  getInboxItem,
  listInboxItems,
  promoteInboxItem
} = await import('./repository.ts');
const {
  deleteInboxItemAttachment,
  listInboxItemAttachments,
  listObjectiveAttachments,
  resolveStoredObject,
  uploadInboxItemAttachment
} = await import('./storage.ts');
const { createWorkspace } = await import('./workspaces.ts');

const OWNER_WORKSPACE_ID = 'local-workspace';
const objects = new Map<string, Buffer>();
const server = createServer((req, res) => {
  void (async () => {
    const key = req.url?.split('?')[0] ?? '/';
    if (req.method === 'PUT') {
      objects.set(key, await readRequestBody(req));
      res.statusCode = 200;
    } else if (req.method === 'GET') {
      const body = objects.get(key);
      res.statusCode = body ? 200 : 404;
      res.end(body);
      return;
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
    } else {
      res.statusCode = 405;
    }
    res.end();
  })().catch(error => {
    res.statusCode = 500;
    res.end(String(error));
  });
});
const previousEnv = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
};

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function storedPath(storageKey: string): string {
  return `/overlord-storage/hosted/${storageKey}`;
}

function attachmentRow(id: string) {
  return db
    .prepare(
      `SELECT workspace_id, project_id, mission_id, objective_id, inbox_item_id, storage_key,
              storage_bucket_id, upload_status, deleted_at, revision
         FROM attachments WHERE id = ?`
    )
    .get(id) as {
    workspace_id: string;
    project_id: string | null;
    mission_id: string | null;
    objective_id: string | null;
    inbox_item_id: string | null;
    storage_key: string;
    storage_bucket_id: string;
    upload_status: string;
    deleted_at: string | null;
    revision: number;
  };
}

async function asOtherProfile<T>(fn: () => Promise<T>): Promise<T> {
  return withRequestContextAsync(async () => {
    setActiveProfileId('other-user');
    setActiveWorkspaceUser('other-workspace-user');
    return fn();
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

async function captureWithFile(title: string, contents = `${title} bytes`) {
  const item = await createInboxItem({ title, objectives: [title] });
  const attachment = await uploadInboxItemAttachment({
    inboxItemId: item.id,
    bytes: Buffer.from(contents),
    filename: `${title}.txt`,
    contentType: 'text/plain; charset=utf-8'
  });
  return { item, attachment };
}

before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  // The owner's storage workspace is S3-backed so byte removal is observable;
  // the secondary workspace created below keeps the default local_fs bucket.
  db.prepare(
    `UPDATE storage_buckets
        SET storage_backend = 's3', local_path = NULL, settings_json = ?
      WHERE workspace_id = ? AND bucket_key = 'attachments'`
  ).run(
    JSON.stringify({
      bucketName: 'overlord-storage',
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      pathPrefix: 'hosted'
    }),
    OWNER_WORKSPACE_ID
  );
  seedAuthenticatedOperator({
    db,
    workspaceId: OWNER_WORKSPACE_ID,
    profileId: 'other-user',
    workspaceUserId: 'other-workspace-user'
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.env.S3_ACCESS_KEY_ID = previousEnv.accessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = previousEnv.secretAccessKey;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('inbox item attachments', () => {
  it('uploads, lists, counts, and deletes files on an owned capture', async () => {
    const { item, attachment } = await captureWithFile('upload-list-delete');
    assert.equal(attachment.inboxItemId, item.id);
    assert.equal(attachment.workspaceId, OWNER_WORKSPACE_ID);
    assert.equal(attachment.projectId, null);
    assert.equal(attachment.objectiveId, null);
    assert.equal(attachment.contentType, 'text/plain');
    assert.match(
      attachment.storageKey,
      new RegExp(`^workspace-files/${OWNER_WORKSPACE_ID}/attachments/[a-z0-9-]+\\.txt$`)
    );
    assert.deepEqual(
      objects.get(storedPath(attachment.storageKey)),
      Buffer.from('upload-list-delete bytes')
    );

    const second = await uploadInboxItemAttachment({
      inboxItemId: item.id,
      bytes: Buffer.from('second'),
      filename: 'second.png',
      contentType: 'image/png'
    });
    assert.deepEqual(
      (await listInboxItemAttachments(item.id)).map(row => row.id),
      [attachment.id, second.id]
    );
    assert.equal((await getInboxItem(item.id)).attachmentCount, 2);
    assert.equal((await listInboxItems()).find(row => row.id === item.id)?.attachmentCount, 2);

    const remaining = await deleteInboxItemAttachment(item.id, attachment.id);
    assert.deepEqual(
      remaining.map(row => row.id),
      [second.id]
    );
    assert.equal(objects.has(storedPath(attachment.storageKey)), false);
    assert.equal(attachmentRow(attachment.id).upload_status, 'deleted');
    assert.equal((await getInboxItem(item.id)).attachmentCount, 1);

    const changes = db
      .prepare(`SELECT COUNT(*) AS count FROM entity_changes WHERE entity_id IN (?, ?)`)
      .get(attachment.id, second.id) as { count: number };
    assert.equal(changes.count, 0, 'inbox attachments stay outside workspace realtime');
  });

  it('rejects empty and oversized uploads', async () => {
    const item = await createInboxItem({ title: 'limits', objectives: ['limits'] });
    await assert.rejects(
      uploadInboxItemAttachment({
        inboxItemId: item.id,
        bytes: Buffer.alloc(0),
        filename: 'empty.txt',
        contentType: 'text/plain'
      }),
      (error: unknown) => error instanceof ApiError && error.status === 400
    );
    await assert.rejects(
      uploadInboxItemAttachment({
        inboxItemId: item.id,
        bytes: Buffer.alloc(25 * 1024 * 1024 + 1),
        filename: 'big.bin',
        contentType: 'application/octet-stream'
      }),
      (error: unknown) => error instanceof ApiError && error.status === 413
    );
  });

  it('isolates a capture and its files from another profile', async () => {
    const { item, attachment } = await captureWithFile('isolated');

    await asOtherProfile(async () => {
      await assert.rejects(listInboxItemAttachments(item.id), isNotFound);
      await assert.rejects(
        uploadInboxItemAttachment({
          inboxItemId: item.id,
          bytes: Buffer.from('intruder'),
          filename: 'intruder.txt',
          contentType: 'text/plain'
        }),
        isNotFound
      );
      await assert.rejects(deleteInboxItemAttachment(item.id, attachment.id), isNotFound);
      // A fellow member of the storage workspace still cannot fetch the bytes.
      await assert.rejects(
        resolveStoredObject('attachments', attachment.storageKey, PERMISSIONS.ATTACHMENT_READ),
        isNotFound
      );
    });

    const resolved = await resolveStoredObject(
      'attachments',
      attachment.storageKey,
      PERMISSIONS.ATTACHMENT_READ
    );
    assert.equal(resolved.filename, 'isolated.txt');
    assert.equal(attachmentRow(attachment.id).deleted_at, null);
  });

  it('deleting a capture tombstones its attachments and removes their objects', async () => {
    const { item, attachment } = await captureWithFile('delete-capture');
    await deleteInboxItem(item.id);

    const row = attachmentRow(attachment.id);
    assert.ok(row.deleted_at);
    assert.equal(row.upload_status, 'deleted');
    assert.equal(objects.has(storedPath(attachment.storageKey)), false);
    await assert.rejects(listInboxItemAttachments(item.id), isNotFound);
  });

  it('promotion re-points attachments onto the first objective in the same workspace', async () => {
    const { item, attachment } = await captureWithFile('promote-same');
    const project = await createProject({ name: 'Inbox Same Workspace' });
    const mission = await promoteInboxItem(item.id, project.id);
    const objectiveId = mission.objectives[0].id;

    const row = attachmentRow(attachment.id);
    assert.equal(row.workspace_id, OWNER_WORKSPACE_ID);
    assert.equal(row.project_id, project.id);
    assert.equal(row.mission_id, mission.id);
    assert.equal(row.objective_id, objectiveId);
    assert.equal(row.inbox_item_id, null);
    assert.equal(row.storage_key, attachment.storageKey);
    assert.equal(row.revision, 2);
    assert.ok(objects.has(storedPath(attachment.storageKey)));

    assert.deepEqual(
      (await listObjectiveAttachments(objectiveId)).map(entry => entry.id),
      [attachment.id]
    );
    const change = db
      .prepare(
        `SELECT operation, workspace_id, mission_id, objective_id FROM entity_changes
          WHERE entity_type = 'attachment' AND entity_id = ?`
      )
      .get(attachment.id) as Record<string, string>;
    assert.deepEqual(
      { ...change },
      {
        operation: 'update',
        workspace_id: OWNER_WORKSPACE_ID,
        mission_id: mission.id,
        objective_id: objectiveId
      }
    );
  });

  it('promotion into another workspace copies the bytes into its bucket', async () => {
    const { item, attachment } = await captureWithFile('promote-cross', 'cross-workspace bytes');
    const secondary = await createWorkspace({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      name: 'Inbox Destination Workspace'
    });
    await setActiveWorkspace(OWNER_WORKSPACE_ID);
    const project = await createProject({
      name: 'Inbox Cross Workspace',
      workspaceId: secondary.id
    });

    const mission = await promoteInboxItem(item.id, project.id);
    const objectiveId = mission.objectives[0].id;
    const row = attachmentRow(attachment.id);
    const targetBucket = db
      .prepare(
        `SELECT id FROM storage_buckets WHERE workspace_id = ? AND bucket_key = 'attachments'`
      )
      .get(secondary.id) as { id: string };

    assert.equal(row.workspace_id, secondary.id);
    assert.equal(row.storage_bucket_id, targetBucket.id);
    assert.equal(row.objective_id, objectiveId);
    assert.equal(row.inbox_item_id, null);
    assert.equal(
      row.storage_key,
      `workspace-files/${secondary.id}/attachments/${attachment.id}.txt`
    );
    assert.equal(objects.has(storedPath(attachment.storageKey)), false);

    const resolved = await resolveStoredObject(
      'attachments',
      row.storage_key,
      PERMISSIONS.ATTACHMENT_READ
    );
    assert.ok(resolved.absolutePath);
    assert.equal(readFileSync(resolved.absolutePath, 'utf8'), 'cross-workspace bytes');
    rmSync(resolved.absolutePath, { force: true });
  });

  it('a failed promotion leaves the capture and its files untouched', async () => {
    const { item, attachment } = await captureWithFile('promote-fails');
    await assert.rejects(promoteInboxItem(item.id, 'missing-project'), isNotFound);
    const row = attachmentRow(attachment.id);
    assert.equal(row.inbox_item_id, item.id);
    assert.equal(row.objective_id, null);
    assert.ok(objects.has(storedPath(attachment.storageKey)));
    assert.equal((await getInboxItem(item.id)).attachmentCount, 1);
  });
});
