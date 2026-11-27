import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resetLatchBinaryCache } from './latch-binary.ts';
import { latchHostKeyDigest, readLatchHostIdentity } from './latch-host-identity.ts';

test('owner-side root verification requires the exact live directory and current Control revision', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'overlord-latch-root-'));
  const pathBeforeTest = process.env.PATH;
  t.after(async () => {
    if (pathBeforeTest === undefined) delete process.env.PATH;
    else process.env.PATH = pathBeforeTest;
    resetLatchBinaryCache();
    await rm(dir, { recursive: true, force: true });
  });
  resetLatchBinaryCache();
  process.env.PATH = `${dir}:${pathBeforeTest ?? '/usr/bin:/bin'}`;
  const executable = join(dir, 'latch');
  await writeFile(executable, '#!/bin/sh\nexec /bin/cat "$0.$2.json"\n', { mode: 0o700 });
  const fixture = (command: string, data: unknown) =>
    writeFile(`${executable}.${command}.json`, JSON.stringify(data));
  const hostKey = '01'.repeat(32);
  const sharedRootId = 'ab'.repeat(32);
  const source = join(dir, 'plain-folder');
  await mkdir(source);
  const sourceDirectory = await realpath(source);
  const directory = await stat(sourceDirectory, { bigint: true });
  const root = {
    rootId: sharedRootId,
    path: sourceDirectory,
    deviceId: 'paired-device',
    grantRevision: 4,
    identity: {
      device: Number(directory.dev),
      inode: Number(directory.ino),
      created: {
        secs_since_epoch: Number(directory.birthtimeNs / 1_000_000_000n),
        nanos_since_epoch: Number(directory.birthtimeNs % 1_000_000_000n)
      }
    }
  };
  const device = {
    deviceId: root.deviceId,
    permission: 'control',
    revoked: false,
    grantRevision: 4
  };
  await fixture('status', { formatVersion: 2, enabled: true, publicKey: hostKey });
  assert.deepEqual(await readLatchHostIdentity(), { hostKeyDigest: latchHostKeyDigest(hostKey) });
  assert.equal(await readLatchHostIdentity({ sharedRootId, sourceDirectory }), null);
  await fixture('shared-roots', [root]);
  await fixture('devices', [device]);
  const verify = () => readLatchHostIdentity({ sharedRootId, sourceDirectory });
  assert.deepEqual(await verify(), {
    hostKeyDigest: latchHostKeyDigest(hostKey),
    verifiedSharedRootId: sharedRootId
  });
  assert.equal(await readLatchHostIdentity({ sharedRootId, sourceDirectory: dir }), null);
  for (const inaccessible of [
    { ...device, revoked: true },
    { ...device, permission: 'interact' },
    { ...device, grantRevision: 5 },
    { ...device, deviceId: 'different-pairing' }
  ]) {
    await fixture('devices', [inaccessible]);
    assert.equal(await verify(), null);
  }
  await fixture('devices', [device]);
  await fixture('shared-roots', []);
  assert.equal(await verify(), null);
  await fixture('shared-roots', [root]);
  await rename(sourceDirectory, join(dir, 'moved'));
  await mkdir(sourceDirectory);
  assert.equal(await verify(), null);
});
