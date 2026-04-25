/* global process */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_PATH = 'packages/overlord-cli/bin/_cli/credentials.mjs';

function importFresh(relativePath) {
  const fileUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}-${Math.random()}`);
}

async function withTempHome(callback) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-home-'));
  const previousHome = process.env.HOME;
  const previousAccessToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousConnectorUrl = process.env.OVERLORD_CONNECTOR_URL;

  try {
    process.env.HOME = tempHome;
    return await callback(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;

    if (previousAccessToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAccessToken;

    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;

    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;

    if (previousConnectorUrl === undefined) delete process.env.OVERLORD_CONNECTOR_URL;
    else process.env.OVERLORD_CONNECTOR_URL = previousConnectorUrl;

    fs.rmSync(tempHome, { force: true, recursive: true });
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { mode: 0o700, recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function buildOAuthCredentials(overrides = {}) {
  return {
    access_token: 'stored-access-token',
    access_token_expires_at: '2999-01-01T00:00:00.000Z',
    refresh_token: 'stored-refresh-token',
    organization_id: 7,
    platform_url: 'https://www.ovld.ai',
    ...overrides
  };
}

test(`${MODULE_PATH} resolveAuth prefers explicit OAuth env overrides`, async () => {
  await withTempHome(async () => {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'env-access-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    const { resolveAuth } = await importFresh(MODULE_PATH);
    const result = await resolveAuth();

    assert.equal(result.platformUrl, 'https://www.ovld.ai');
    assert.equal(result.bearerToken, 'env-access-token');
    assert.equal(result.organizationId, 42);
    assert.equal(result.authMode, 'oauth_env');
  });
});

test(`${MODULE_PATH} resolveAuth rejects OVERLORD_ACCESS_TOKEN without organization scope`, async () => {
  await withTempHome(async () => {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'env-access-token';
    delete process.env.OVERLORD_ORGANIZATION_ID;

    const { resolveAuth } = await importFresh(MODULE_PATH);

    await assert.rejects(
      resolveAuth(),
      /OVERLORD_ACCESS_TOKEN requires OVERLORD_ORGANIZATION_ID/
    );
  });
});

test(`${MODULE_PATH} resolveAuth uses stored CLI credentials from credentials.cli.json`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.cli.json'), buildOAuthCredentials());

    process.env.OVERLORD_URL = 'https://www.ovld.ai/api/protocol';
    delete process.env.OVERLORD_ACCESS_TOKEN;
    delete process.env.OVERLORD_ORGANIZATION_ID;
    delete process.env.OVERLORD_CONNECTOR_URL;

    const { resolveAuth } = await importFresh(MODULE_PATH);
    const result = await resolveAuth();

    assert.equal(result.platformUrl, 'https://www.ovld.ai');
    assert.equal(result.bearerToken, 'stored-access-token');
    assert.equal(result.organizationId, 7);
    assert.equal(result.authMode, 'oauth');
  });
});

test(`${MODULE_PATH} saveCredentials writes to credentials.cli.json only`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');

    const { saveCredentials, loadCredentials } = await importFresh(MODULE_PATH);
    saveCredentials(buildOAuthCredentials({ organization_id: 11 }));

    const cliCredentials = JSON.parse(
      fs.readFileSync(path.join(ovldDir, 'credentials.cli.json'), 'utf8')
    );

    assert.equal(cliCredentials.access_token, 'stored-access-token');
    assert.equal(cliCredentials.refresh_token, 'stored-refresh-token');
    assert.equal(cliCredentials.organization_id, 11);
    assert.equal(cliCredentials.platform_url, 'https://www.ovld.ai');

    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.json')), false);
    assert.equal(fs.existsSync(path.join(ovldDir, 'electron-credentials.json')), false);

    assert.deepEqual(loadCredentials(), buildOAuthCredentials({ organization_id: 11 }));
  });
});

test(`${MODULE_PATH} legacy migration copies credentials.json to credentials.cli.json once`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.json'), buildOAuthCredentials());

    delete process.env.OVERLORD_URL;
    delete process.env.OVERLORD_ACCESS_TOKEN;
    delete process.env.OVERLORD_ORGANIZATION_ID;
    delete process.env.OVERLORD_CONNECTOR_URL;

    const { loadCredentials } = await importFresh(MODULE_PATH);
    const creds = loadCredentials();

    assert.equal(creds.access_token, 'stored-access-token');
    assert.equal(creds.refresh_token, 'stored-refresh-token');
    assert.equal(creds.organization_id, 7);

    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.cli.json')), true);
    assert.equal(fs.existsSync(path.join(ovldDir, '.cli-migrated')), true);

    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.json')), true);
  });
});

test(`${MODULE_PATH} legacy migration does not overwrite existing credentials.cli.json`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.cli.json'), buildOAuthCredentials({ access_token: 'cli-token' }));
    writeJson(path.join(ovldDir, 'credentials.json'), buildOAuthCredentials({ access_token: 'legacy-token' }));

    const { loadCredentials } = await importFresh(MODULE_PATH);
    const creds = loadCredentials();

    assert.equal(creds.access_token, 'cli-token');
  });
});

test(`${MODULE_PATH} legacy migration does not repeat after marker is set`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.json'), buildOAuthCredentials());
    fs.mkdirSync(ovldDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(ovldDir, '.cli-migrated'), '2026-01-01', { mode: 0o600 });

    const { loadCredentials } = await importFresh(MODULE_PATH);
    const creds = loadCredentials();

    assert.equal(creds, null);
    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.cli.json')), false);
  });
});

test(`${MODULE_PATH} legacy migration falls back to electron-credentials.json`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'electron-credentials.json'), buildOAuthCredentials({ access_token: 'electron-token' }));

    const { loadCredentials } = await importFresh(MODULE_PATH);
    const creds = loadCredentials();

    assert.equal(creds.access_token, 'electron-token');
    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.cli.json')), true);
  });
});

test(`${MODULE_PATH} getAuthStatus reports CLI credential sources`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.cli.json'), buildOAuthCredentials());

    delete process.env.OVERLORD_URL;
    delete process.env.OVERLORD_ACCESS_TOKEN;
    delete process.env.OVERLORD_ORGANIZATION_ID;
    delete process.env.OVERLORD_CONNECTOR_URL;

    const { getAuthStatus } = await importFresh(MODULE_PATH);
    const status = await getAuthStatus();

    assert.equal(status.isLoggedIn, true);
    assert.equal(status.platformUrl, 'https://www.ovld.ai');
    assert.equal(status.tokenSource, 'credentials.cli.json');
    assert.equal(status.tokenPresent, true);
    assert.equal(status.organizationId, 7);
    assert.equal(status.authMode, 'oauth');
    assert.equal(status.credentialsFileExists, true);
  });
});

test(`${MODULE_PATH} resolveAuth rejects expired credentials when refresh fails`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(
      path.join(ovldDir, 'credentials.cli.json'),
      buildOAuthCredentials({
        access_token_expires_at: '2000-01-01T00:00:00.000Z'
      })
    );

    const originalFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/api/auth/config')) {
        return {
          ok: true,
          json: async () => ({
            supabase_url: 'https://zitmmhvbilhjjdwgxlfm.supabase.co',
            cli_client_id: 'cli-client-id'
          })
        };
      }

      if (String(url).includes('/auth/v1/oauth/token') && init.method === 'POST') {
        const error = new TypeError('fetch failed');
        error.cause = {
          code: 'ENOTFOUND',
          message: 'getaddrinfo ENOTFOUND zitmmhvbilhjjdwgxlfm.supabase.co'
        };
        throw error;
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    };

    try {
      const { resolveAuth, getAuthStatus } = await importFresh(MODULE_PATH);

      await assert.rejects(
        resolveAuth(),
        /Stored Overlord session expired and refresh failed.*ENOTFOUND/
      );

      const status = await getAuthStatus();
      assert.equal(status.isLoggedIn, false);
      assert.match(status.error, /Stored Overlord session expired and refresh failed/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test(`${MODULE_PATH} repairCredentials writes to credentials.cli.json`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.json'), buildOAuthCredentials());

    const { repairCredentials } = await importFresh(MODULE_PATH);
    const result = repairCredentials();

    assert.equal(result.repaired, true);
    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.cli.json')), true);

    const cliCredentials = JSON.parse(
      fs.readFileSync(path.join(ovldDir, 'credentials.cli.json'), 'utf8')
    );
    assert.equal(cliCredentials.access_token, 'stored-access-token');
    assert.equal(cliCredentials.refresh_token, 'stored-refresh-token');
    assert.equal(cliCredentials.platform_url, 'https://www.ovld.ai');
  });
});

test(`${MODULE_PATH} CLI and Desktop credential files are independent`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');

    writeJson(path.join(ovldDir, 'credentials.cli.json'), buildOAuthCredentials({
      access_token: 'cli-access-token',
      refresh_token: 'cli-refresh-token'
    }));
    writeJson(path.join(ovldDir, 'credentials.desktop.json'), buildOAuthCredentials({
      access_token: 'desktop-access-token',
      refresh_token: 'desktop-refresh-token'
    }));

    const { loadCredentials, saveCredentials } = await importFresh(MODULE_PATH);

    const creds = loadCredentials();
    assert.equal(creds.access_token, 'cli-access-token');
    assert.equal(creds.refresh_token, 'cli-refresh-token');

    saveCredentials({
      ...creds,
      access_token: 'rotated-cli-token',
      refresh_token: 'rotated-cli-refresh'
    });

    const desktopCreds = JSON.parse(
      fs.readFileSync(path.join(ovldDir, 'credentials.desktop.json'), 'utf8')
    );
    assert.equal(desktopCreds.access_token, 'desktop-access-token');
    assert.equal(desktopCreds.refresh_token, 'desktop-refresh-token');
  });
});

test(`${MODULE_PATH} clearCredentials removes only CLI credential file`, async () => {
  await withTempHome(async tempHome => {
    const ovldDir = path.join(tempHome, '.ovld');
    writeJson(path.join(ovldDir, 'credentials.cli.json'), buildOAuthCredentials());
    writeJson(path.join(ovldDir, 'credentials.desktop.json'), buildOAuthCredentials());

    const { clearCredentials } = await importFresh(MODULE_PATH);
    clearCredentials();

    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.cli.json')), false);
    assert.equal(fs.existsSync(path.join(ovldDir, 'credentials.desktop.json')), true);
  });
});
