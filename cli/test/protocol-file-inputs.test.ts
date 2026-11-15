import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveProtocolFileInputs } from '../src/commands.ts';

test('each file flag carries its own resolved payload', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-file-inputs-'));
  const pathsFile = path.join(dir, 'paths.json');
  const changesPath = path.join(dir, 'changes.json');
  writeFileSync(pathsFile, '["a,b.ts"]', 'utf8');
  writeFileSync(changesPath, '[{"filePath":"b.ts"}]', 'utf8');

  const flags = new Map<string, string | true>([
    ['--summary-file', '-'],
    ['--paths-file', pathsFile],
    ['--changes-file', changesPath]
  ]);

  const { fileInputs } = await resolveProtocolFileInputs({
    flags,
    stdin: 'A long summary streamed on stdin.'
  });

  // The summary came from stdin; the declared paths came from the real file path.
  assert.equal(fileInputs['--summary-file'], 'A long summary streamed on stdin.');
  assert.equal(fileInputs['--paths-file'], '["a,b.ts"]');
  assert.equal(fileInputs['--changes-file'], '[{"filePath":"b.ts"}]');
});

test('passing two stdin (-) flags fails fast and names both flags', async () => {
  const flags = new Map<string, string | true>([
    ['--summary-file', '-'],
    ['--declared-paths-file', '-']
  ]);

  await assert.rejects(
    () => resolveProtocolFileInputs({ flags, stdin: 'payload' }),
    (err: Error) => {
      assert.match(err.message, /--summary-file/);
      assert.match(err.message, /--declared-paths-file/);
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

test('objective instruction and description files are read as file inputs (ADR 0059)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-description-inputs-'));
  const instructionPath = path.join(dir, 'instruction.md');
  const descriptionPath = path.join(dir, 'description.md');
  writeFileSync(instructionPath, 'The full instruction for the agent.', 'utf8');
  writeFileSync(descriptionPath, 'A short summary for people.', 'utf8');

  const { fileInputs } = await resolveProtocolFileInputs({
    flags: new Map<string, string | true>([
      ['--instruction-text-file', instructionPath],
      ['--description-file', descriptionPath],
      ['--objective-description-file', '-']
    ]),
    stdin: 'The summary of a new objective.'
  });

  assert.equal(fileInputs['--instruction-text-file'], 'The full instruction for the agent.');
  assert.equal(fileInputs['--description-file'], 'A short summary for people.');
  assert.equal(fileInputs['--objective-description-file'], 'The summary of a new objective.');
});
