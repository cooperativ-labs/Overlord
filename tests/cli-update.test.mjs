import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkForCliUpdate,
  fetchLatestCliVersion,
  formatCliUpdateNotice,
  getCurrentCliVersion,
  printCliUpdateNotice,
  runCliUpdateCommand
} from '../packages/overlord-cli/bin/_cli/cli-update.mjs';

test('fetchLatestCliVersion returns the npm registry version', async () => {
  const version = await fetchLatestCliVersion({
    fetchImpl: async () =>
      new Response(JSON.stringify({ version: '9.9.9' }), {
        headers: { 'Content-Type': 'application/json' }
      }),
    packageName: 'overlord-cli'
  });

  assert.equal(version, '9.9.9');
});

test('checkForCliUpdate returns null when the current version matches npm', async () => {
  const currentVersion = getCurrentCliVersion();
  const latest = await checkForCliUpdate({
    currentVersion,
    fetchImpl: async () =>
      new Response(JSON.stringify({ version: currentVersion }), {
        headers: { 'Content-Type': 'application/json' }
      })
  });

  assert.equal(latest, null);
});

test('printCliUpdateNotice renders an orange update warning', () => {
  const chunks = [];
  const written = printCliUpdateNotice('3.99.0', {
    currentVersion: '3.21.0',
    stream: {
      write(chunk) {
        chunks.push(chunk);
      }
    }
  });

  assert.equal(written, true);
  assert.match(chunks.join(''), /^\x1b\[38;5;208mNew Overlord CLI version available:/);
  assert.match(chunks.join(''), /Run `ovld update` to update via npm\./);
});

test('formatCliUpdateNotice includes the installed and latest versions', () => {
  const notice = formatCliUpdateNotice('3.99.0', { currentVersion: '3.21.0' });
  assert.equal(
    notice,
    'New Overlord CLI version available: v3.99.0 (installed v3.21.0). Run `ovld update` to update via npm.'
  );
});

test('runCliUpdateCommand shells out to npm install -g package@latest', async () => {
  const calls = [];
  const logs = [];

  const resultPromise = runCliUpdateCommand({
    currentVersion: '3.21.0',
    fetchLatestVersionFn: async () => '3.99.0',
    logger: {
      log(message) {
        logs.push(message);
      }
    },
    npmCommand: 'npm',
    packageName: 'overlord-cli',
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.ok(resultPromise instanceof Promise);
  const result = await resultPromise;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['install', '-g', 'overlord-cli@latest']);
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.equal(calls[0].options.env, process.env);
  assert.deepEqual(result, {
    alreadyLatest: false,
    currentVersion: '3.21.0',
    latestVersion: '3.99.0',
    result: { status: 0 }
  });
  assert.deepEqual(logs, [
    'Updating Overlord CLI 3.21.0 -> 3.99.0 via npm...',
    'Overlord CLI updated to v3.99.0.'
  ]);
});

test('runCliUpdateCommand skips reinstall when the current version is already latest', async () => {
  const calls = [];
  const logs = [];

  const result = await runCliUpdateCommand({
    currentVersion: '3.21.0',
    fetchLatestVersionFn: async () => '3.21.0',
    logger: {
      log(message) {
        logs.push(message);
      }
    },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result, {
    alreadyLatest: true,
    currentVersion: '3.21.0',
    latestVersion: '3.21.0'
  });
  assert.deepEqual(logs, ['Overlord CLI 3.21.0 is already the latest version.']);
});
