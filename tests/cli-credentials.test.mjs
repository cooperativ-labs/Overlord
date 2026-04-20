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
  const previousConnectorUrl = process.env.OVERLORD_CONNECTOR_URL;

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

    if (previousConnectorUrl === undefined) delete process.env.OVERLORD_CONNECTOR_URL;
    else process.env.OVERLORD_CONNECTOR_URL = previousConnectorUrl;

    fs.rmSync(tempHome, { force: true, recursive: true });
  }
}

for (const modulePath of [
  'packages/overlord-cli/bin/_cli/credentials.mjs'
]) {
  test(
    `${modulePath} resolveAuth ignores ambient runtime files and blank stored tokens`,
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
        delete process.env.OVERLORD_CONNECTOR_URL;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'https://www.ovld.ai');
        assert.equal(result.agentToken, 'env-agent-token');
        assert.equal(result.localSecret, '');
      });
    }
  );

  test(
    `${modulePath} resolveAuth ignores invalid stored platform URLs and normalizes env URLs`,
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
              access_token: 'cred-token',
              platform_url: '/api/protocol'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(credentialsPath, 0o600);

        process.env.OVERLORD_URL = 'https://www.ovld.ai/api/protocol';
        delete process.env.OVERLORD_CONNECTOR_URL;
        delete process.env.AGENT_TOKEN;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'https://www.ovld.ai');
        assert.equal(result.agentToken, 'cred-token');
      });
    }
  );

  test(
    `${modulePath} resolveAuth ignores the legacy OVERLORD_CONNECTOR_URL override`,
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
              access_token: 'stored-token',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(credentialsPath, 0o600);

        process.env.OVERLORD_CONNECTOR_URL = 'http://localhost:65475';
        delete process.env.OVERLORD_URL;
        delete process.env.AGENT_TOKEN;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'https://www.ovld.ai');
        assert.equal(result.agentToken, 'stored-token');
        assert.equal(result.localSecret, '');
      });
    }
  );

  test(
    `${modulePath} resolveAuth ignores stale stored localhost connector URLs`,
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
              access_token: 'stored-token',
              platform_url: 'http://localhost:65475'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(credentialsPath, 0o600);

        delete process.env.OVERLORD_CONNECTOR_URL;
        delete process.env.OVERLORD_URL;
        delete process.env.AGENT_TOKEN;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'http://localhost:3000');
        assert.equal(result.agentToken, 'stored-token');
        assert.equal(result.localSecret, '');
      });
    }
  );

  test(
    `${modulePath} resolveAuth prefers AGENT_TOKEN env var over stored credentials`,
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
              access_token: 'stored-token',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
        fs.chmodSync(credentialsPath, 0o600);

        process.env.OVERLORD_URL = 'https://www.ovld.ai';
        process.env.AGENT_TOKEN = 'env-token';
        delete process.env.OVERLORD_CONNECTOR_URL;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'https://www.ovld.ai');
        assert.equal(result.agentToken, 'env-token');
      });
    }
  );

  test(
    `${modulePath} resolveAuth reads shared electron credentials before legacy CLI credentials`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        fs.writeFileSync(
          path.join(ovldDir, 'credentials.json'),
          JSON.stringify(
            {
              access_token: 'legacy-cli-token',
              platform_url: 'https://legacy.ovld.test'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );

        fs.writeFileSync(
          path.join(ovldDir, 'electron-credentials.json'),
          JSON.stringify(
            {
              encrypted_token: 'electron-only-encrypted-value',
              access_token: 'shared-electron-token',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );

        delete process.env.OVERLORD_URL;
        delete process.env.AGENT_TOKEN;
        delete process.env.OVERLORD_CONNECTOR_URL;

        const { resolveAuth } = await importFresh(modulePath);
        const result = resolveAuth();

        assert.equal(result.platformUrl, 'https://www.ovld.ai');
        assert.equal(result.agentToken, 'shared-electron-token');
      });
    }
  );

  test(
    `${modulePath} saveCredentials mirrors CLI login into electron credentials without deleting encrypted fields`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        const electronCredentialsPath = path.join(ovldDir, 'electron-credentials.json');
        fs.writeFileSync(
          electronCredentialsPath,
          JSON.stringify(
            {
              encrypted_token: 'old-encrypted-token',
              encrypted_refresh_token: 'old-refresh-token',
              access_token: 'old-token',
              platform_url: 'https://old.ovld.test'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );

        const { loadCredentials, saveCredentials } = await importFresh(modulePath);
        saveCredentials({
          access_token: 'new-cli-token',
          platform_url: 'https://www.ovld.ai'
        });

        const cliCredentials = JSON.parse(
          fs.readFileSync(path.join(ovldDir, 'credentials.json'), 'utf8')
        );
        const electronCredentials = JSON.parse(fs.readFileSync(electronCredentialsPath, 'utf8'));

        assert.equal(cliCredentials.access_token, 'new-cli-token');
        assert.equal(cliCredentials.platform_url, 'https://www.ovld.ai');
        assert.equal(electronCredentials.access_token, 'new-cli-token');
        assert.equal(electronCredentials.platform_url, 'https://www.ovld.ai');
        assert.equal(electronCredentials.encrypted_token, 'old-encrypted-token');
        assert.equal(electronCredentials.encrypted_refresh_token, 'old-refresh-token');
        assert.deepEqual(loadCredentials(), {
          access_token: 'new-cli-token',
          platform_url: 'https://www.ovld.ai'
        });
      });
    }
  );

  test(
    `${modulePath} clearCredentials removes both shared credential files`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        const cliCredentialsPath = path.join(ovldDir, 'credentials.json');
        const electronCredentialsPath = path.join(ovldDir, 'electron-credentials.json');
        fs.writeFileSync(cliCredentialsPath, '{}', { mode: 0o600 });
        fs.writeFileSync(electronCredentialsPath, '{}', { mode: 0o600 });

        const { clearCredentials } = await importFresh(modulePath);
        clearCredentials();

        assert.equal(fs.existsSync(cliCredentialsPath), false);
        assert.equal(fs.existsSync(electronCredentialsPath), false);
      });
    }
  );

  test(
    `${modulePath} getAuthStatus reports redacted credential sources`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        fs.writeFileSync(
          path.join(ovldDir, 'electron-credentials.json'),
          JSON.stringify(
            {
              access_token: 'shared-token',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );

        delete process.env.OVERLORD_URL;
        delete process.env.AGENT_TOKEN;
        delete process.env.OVERLORD_CONNECTOR_URL;

        const { getAuthStatus } = await importFresh(modulePath);
        const status = getAuthStatus();

        assert.equal(status.isLoggedIn, true);
        assert.equal(status.platformUrl, 'https://www.ovld.ai');
        assert.equal(status.platformUrlSource, 'electron-credentials.json');
        assert.equal(status.tokenSource, 'electron-credentials.json');
        assert.equal(status.tokenPresent, true);
        assert.equal(status.electronCredentialsFileExists, true);
        assert.equal(status.credentialsFileExists, false);
      });
    }
  );

  test(
    `${modulePath} repairCredentials mirrors a valid shared credential into both files`,
    { concurrency: false },
    async () => {
      await withTempHome(async tempHome => {
        const ovldDir = path.join(tempHome, '.ovld');
        fs.mkdirSync(ovldDir, { mode: 0o700, recursive: true });
        fs.chmodSync(ovldDir, 0o700);

        fs.writeFileSync(
          path.join(ovldDir, 'electron-credentials.json'),
          JSON.stringify(
            {
              access_token: 'repair-token',
              platform_url: 'https://www.ovld.ai'
            },
            null,
            2
          ),
          { mode: 0o600 }
        );

        const { repairCredentials } = await importFresh(modulePath);
        const result = repairCredentials();

        assert.equal(result.repaired, true);
        assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.json')), true);

        const cliCredentials = JSON.parse(
          fs.readFileSync(path.join(ovldDir, 'credentials.json'), 'utf8')
        );
        assert.equal(cliCredentials.access_token, 'repair-token');
        assert.equal(cliCredentials.platform_url, 'https://www.ovld.ai');
      });
    }
  );
}
