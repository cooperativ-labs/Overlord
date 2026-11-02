import type Database from 'better-sqlite3';
import { createServer } from 'node:http';

export async function startFakeS3() {
  const objects = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    void (async () => {
      const key = req.url?.split('?')[0] ?? '/';
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(key, Buffer.concat(chunks));
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake S3 has no TCP address');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    objects,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      )
  };
}

export function withS3Credentials(): () => void {
  const previous = {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY
  };
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  return () => {
    for (const key of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

export function useS3Bucket(
  db: Database.Database,
  options: {
    workspaceId: string;
    bucketKey: string;
    endpoint: string;
    settings?: Record<string, unknown>;
  }
): void {
  db.prepare(
    `UPDATE storage_buckets
        SET storage_backend = 's3', local_path = NULL, settings_json = ?
      WHERE workspace_id = ? AND bucket_key = ?`
  ).run(
    JSON.stringify({
      bucketName: 'overlord-storage',
      endpoint: options.endpoint,
      region: 'us-east-1',
      pathPrefix: 'hosted',
      ...options.settings
    }),
    options.workspaceId,
    options.bucketKey
  );
}
