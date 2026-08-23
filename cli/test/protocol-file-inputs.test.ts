import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveProtocolFileInputs } from '../src/commands.ts';

test('each file flag carries its own resolved payload', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-file-inputs-'));
  const rationalesPath = path.join(dir, 'rationales.json');
  const changesPath = path.join(dir, 'changes.json');
  writeFileSync(rationalesPath, '[{"filePath":"a.ts"}]', 'utf8');
  writeFileSync(changesPath, '[{"filePath":"b.ts"}]', 'utf8');

  const flags = new Map<string, string | true>([
    ['--summary-file', '-'],
    ['--change-rationales-file', rationalesPath],
    ['--changes-file', changesPath]
  ]);

  const { fileInputs } = await resolveProtocolFileInputs({
    flags,
    stdin: 'A long summary streamed on stdin.'
  });

  // The summary came from stdin; the rationales came from the real file path.
  assert.equal(fileInputs['--summary-file'], 'A long summary streamed on stdin.');
  assert.equal(fileInputs['--change-rationales-file'], '[{"filePath":"a.ts"}]');
  assert.equal(fileInputs['--changes-file'], '[{"filePath":"b.ts"}]');
});

test('passing two stdin (-) flags fails fast and names both flags', async () => {
  const flags = new Map<string, string | true>([
    ['--summary-file', '-'],
    ['--change-rationales-file', '-']
  ]);

  await assert.rejects(
    () => resolveProtocolFileInputs({ flags, stdin: 'payload' }),
    (err: Error) => {
      assert.match(err.message, /--summary-file/);
      assert.match(err.message, /--change-rationales-file/);
      assert.match(err.message, /stdin/i);
      return true;
    }
  );
});

test('stdin without an explicit file selector is not forwarded', async () => {
  const flags = new Map<string, string | true>();
  const { fileInputs } = await resolveProtocolFileInputs({
    flags,
    stdin: 'unselected payload'
  });

  assert.deepEqual(fileInputs, {});
});
