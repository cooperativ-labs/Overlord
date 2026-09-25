import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runProtocolCommand } from '../src/commands.ts';
import type { CliRuntime } from '../src/runtime.ts';

test('attachment download saves authenticated bytes without exposing or overwriting credentials', async () => {
  const output = path.join(mkdtempSync('/tmp/ovld-attachment-'), 'spec.pdf');
  const requests: string[] = [];
  const runtime = {
    backend: {
      baseUrl: 'https://backend.ovld.ai',
      post: async ({ path: requestPath }: { path: string }) => {
        requests.push(requestPath);
        return { id: 'attachment-123', filename: 'spec.pdf', url: '/api/storage/attachments/key' };
      },
      getBytes: async (requestPath: string) => {
        requests.push(requestPath);
        return Buffer.from('%PDF-attachment');
      }
    },
    close: () => {}
  } as unknown as CliRuntime;

  const run = () =>
    runProtocolCommand({
      runtime,
      subcommand: 'attachment-download-url',
      args: [
        '--objective-id',
        'coo:11.k7xm',
        '--attachment-id',
        'attachment-123',
        '--output',
        output
      ]
    });
  await run();
  assert.equal(readFileSync(output, 'utf8'), '%PDF-attachment');
  assert.deepEqual(requests, [
    '/api/protocol/attachment-download-url',
    '/api/storage/attachments/key'
  ]);

  writeFileSync(output, 'existing');
  await assert.rejects(run(), /Could not create attachment file/);
  assert.equal(readFileSync(output, 'utf8'), 'existing');
});
