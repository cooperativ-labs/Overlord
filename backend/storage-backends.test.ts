import {
  applyHostedS3StorageBackend,
  type DatabaseClient,
  type RunResult
} from '@overlord/database';
import assert from 'node:assert/strict';
import { type Readable } from 'node:stream';
import test from 'node:test';

import { createStorageBackend, readStorageReadSettings } from './storage-backends.ts';
import { startFakeS3, withS3Credentials } from './storage-test-fixture.ts';

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test('s3 storage backend accepts Postgres jsonb settings objects', async () => {
  const { endpoint, objects, close } = await startFakeS3();
  const restoreCredentials = withS3Credentials();

  try {
    const backend = createStorageBackend({
      repoRoot: process.cwd(),
      bucket: {
        id: 'bucket-user-images',
        bucket_key: 'user-images',
        storage_backend: 's3',
        local_path: null,
        settings_json: {
          bucketName: 'overlord-storage',
          endpoint,
          region: 'us-east-1',
          pathPrefix: 'hosted/user-images'
        }
      }
    });

    await backend.put({
      key: 'avatar.png',
      bytes: Buffer.from('image-bytes'),
      contentType: 'image/png'
    });

    assert.deepEqual(
      objects.get('/overlord-storage/hosted/user-images/avatar.png'),
      Buffer.from('image-bytes')
    );

    const stream = await backend.getStream({ key: 'avatar.png' });
    assert.deepEqual(await readStream(stream), Buffer.from('image-bytes'));

    assert.ok(backend.deleteObject);
    await backend.deleteObject({ key: 'avatar.png' });
    assert.equal(objects.has('/overlord-storage/hosted/user-images/avatar.png'), false);

    assert.ok(backend.presignGet);
    const signedUrl = await backend.presignGet({
      key: 'avatar.png',
      ttlSeconds: 120,
      responseContentDisposition: 'attachment; filename="avatar.png"'
    });
    assert.match(signedUrl, /\/overlord-storage\/hosted\/user-images\/avatar\.png\?/);
    assert.match(signedUrl, /X-Amz-Expires=120/);
  } finally {
    restoreCredentials();
    await close();
  }
});

test('storage read settings parse jsonb objects and clamp presign TTL', () => {
  assert.deepEqual(readStorageReadSettings({ presignReads: true, presignTtlSeconds: 999 }), {
    presignReads: true,
    presignTtlSeconds: 300
  });
  assert.deepEqual(readStorageReadSettings('{"presignReads":true,"presignTtlSeconds":10}'), {
    presignReads: true,
    presignTtlSeconds: 60
  });
  assert.deepEqual(readStorageReadSettings({}), { presignReads: false, presignTtlSeconds: 300 });
});

test('hosted S3 seed is env-gated and idempotent', async () => {
  const rows = [
    {
      id: 'bucket-workspace-images',
      bucket_key: 'workspace-images',
      storage_backend: 'local_fs',
      settings_json: '{}'
    },
    {
      id: 'bucket-user-images',
      bucket_key: 'user-images',
      storage_backend: 'local_fs',
      settings_json: '{}'
    },
    {
      id: 'bucket-attachments',
      bucket_key: 'attachments',
      storage_backend: 'local_fs',
      settings_json: '{}'
    }
  ];
  const client: DatabaseClient = {
    dialect: 'postgres',
    async get() {
      return undefined;
    },
    async all<T>(_sql: string, params: ReadonlyArray<unknown> = []) {
      const bucketKey = String(params[0]);
      return rows.filter(row => row.bucket_key === bucketKey) as T[];
    },
    async run(_sql: string, params: ReadonlyArray<unknown> = []): Promise<RunResult> {
      const [settingsJson, , id] = params;
      const row = rows.find(candidate => candidate.id === id);
      if (!row) return { changes: 0 };
      row.storage_backend = 's3';
      row.settings_json = String(settingsJson);
      return { changes: 1 };
    },
    async exec() {
      return;
    },
    async transaction<T>(fn: (tx: DatabaseClient) => Promise<T>) {
      return fn(client);
    },
    async close() {
      return;
    }
  };

  assert.deepEqual(await applyHostedS3StorageBackend(client, {}), {
    updated: 0,
    skipped: 'no-s3-env'
  });

  const env = {
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    S3_ENDPOINT: 'http://minio.railway.internal:9000',
    S3_BUCKET: 'overlord-storage',
    S3_REGION: 'eu-central-1',
    S3_PATH_PREFIX: '/prod/'
  };

  assert.deepEqual(await applyHostedS3StorageBackend(client, env), {
    updated: 3,
    skipped: null
  });
  assert.deepEqual(await applyHostedS3StorageBackend(client, env), {
    updated: 0,
    skipped: null
  });

  assert.deepEqual(
    rows
      .map(row => ({
        bucketKey: row.bucket_key,
        storageBackend: row.storage_backend,
        settings: JSON.parse(row.settings_json) as unknown
      }))
      .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey)),
    [
      {
        bucketKey: 'attachments',
        storageBackend: 's3',
        settings: {
          bucketName: 'overlord-storage',
          region: 'eu-central-1',
          endpoint: 'http://minio.railway.internal:9000',
          pathPrefix: 'prod'
        }
      },
      {
        bucketKey: 'user-images',
        storageBackend: 's3',
        settings: {
          bucketName: 'overlord-storage',
          region: 'eu-central-1',
          endpoint: 'http://minio.railway.internal:9000',
          pathPrefix: 'prod'
        }
      },
      {
        bucketKey: 'workspace-images',
        storageBackend: 's3',
        settings: {
          bucketName: 'overlord-storage',
          region: 'eu-central-1',
          endpoint: 'http://minio.railway.internal:9000',
          pathPrefix: 'prod'
        }
      }
    ]
  );
});
