/* global process */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function importFresh(relativePath) {
  const fileUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}-${Math.random()}`);
}

async function withTempHome(callback) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-home-'));
  const previousHome = process.env.HOME;
  const previousAgentToken = process.env.AGENT_TOKEN;
  const previousOverlordUrl = process.env.OVERLORD_URL;

  try {
    process.env.HOME = tempHome;
    return await callback(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;

    if (previousAgentToken === undefined) delete process.env.AGENT_TOKEN;
    else process.env.AGENT_TOKEN = previousAgentToken;

    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;

    fs.rmSync(tempHome, { force: true, recursive: true });
  }
}

for (const modulePath of [
  'bin/_cli/credentials.mjs',
  'packages/overlord-cli/bin/_cli/credentials.mjs'
]) {
  test(
    `${modulePath} resolveAuth loads normalized runtime files and ignores blank stored tokens`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        const credentialsPath = path.join(ovldDir, 'credentials.json');
        fs.writeFileSync(
          credentialsPath,
          JSON.stringify(
            {
              access_token: '   ',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(credentialsPath, 0o600);

        const runtimePath = path.join(ovldDir, 'runtime.http-localhost-65475.json');
        fs.writeFileSync(
          runtimePath,
          JSON.stringify(
            {
              platform_url: 'http://localhost:65475',
              local_secret: 'local-secret',
              pid: process.pid,
              started_at: new Date().toISOString()
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(runtimePath, 0o600);

        process.env.AGENT_TOKEN = 'env-agent-token';
        delete process.env.OVERLORD_URL;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'http://localhost:65475');
        assert.equal(result.agentToken, 'env-agent-token');
        assert.equal(result.localSecret, 'local-secret');
      });
    }
  );
}
