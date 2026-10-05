import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  connectionRow,
  connectionRows,
  isSafeReturnPath,
  parseConnectedAccountsSearch,
  rememberConnectionReturn,
  takeConnectionReturn
} from './connections.ts';
import { connectionFixture, statusFixture } from './connections-fixtures.ts';

describe('connectionRows', () => {
  it('lists every offered provider in a stable order, one row each', () => {
    const rows = connectionRows({
      items: [connectionFixture()],
      providers: [
        statusFixture(),
        statusFixture({ provider: 'github', credentialKind: 'oauth' }),
        statusFixture({
          provider: 'knowledgebase',
          scope: 'organization',
          credentialKind: 'oauth',
          available: false,
          reason: 'not_offered_on_edition'
        })
      ]
    });
    assert.deepEqual(
      rows.map(row => [row.provider, row.statusLabel, row.connectAction, row.canDisconnect]),
      [
        ['knowledgebase', 'Not available on this server', null, false],
        ['github', 'Not connected', 'connect', false],
        ['everhour', 'Connected', 'reconnect', true]
      ]
    );
    assert.equal(rows[2]!.detail, 'Connected as Ada');
  });

  it('ignores disconnected rows and treats the default listing as having no providers', () => {
    const rows = connectionRows({ items: [connectionFixture({ state: 'disconnected' })] });
    assert.deepEqual(rows, []);
    const row = connectionRow(statusFixture(), null);
    assert.equal(row.statusLabel, 'Not connected');
  });

  it('offers reconnect and disconnect when reauthorization is required, with the reason', () => {
    const row = connectionRow(
      statusFixture({ provider: 'github', credentialKind: 'oauth' }),
      connectionFixture({
        provider: 'github',
        state: 'reauthorization_required',
        lastErrorCode: 'insufficient_scope'
      })
    );
    assert.equal(row.statusLabel, 'Needs reconnecting');
    assert.equal(row.tone, 'attention');
    assert.equal(row.connectAction, 'reconnect');
    assert.equal(row.canDisconnect, true);
    assert.equal(row.detail, 'Some requested permissions were not granted.');
  });

  it('keeps a stored credential removable when the server has no key', () => {
    const status = statusFixture({ available: false, reason: 'encryption_not_configured' });
    const stored = connectionRow(status, connectionFixture({ state: 'pending' }));
    assert.equal(stored.statusLabel, 'Not configured on this server');
    assert.equal(stored.connectAction, null);
    assert.equal(stored.canDisconnect, true);
    const none = connectionRow(status, null);
    assert.equal(none.canDisconnect, false);
  });

  it('shows Knowledgebase workspaces when connected', () => {
    const row = connectionRow(
      statusFixture({ provider: 'knowledgebase', credentialKind: 'oauth' }),
      connectionFixture({
        provider: 'knowledgebase',
        account: null,
        authorizedWorkspaces: ['main', 'notes']
      })
    );
    assert.equal(row.detail, 'Workspaces: main, notes');
  });
});

describe('connected accounts search', () => {
  it('accepts only known providers and callback statuses', () => {
    assert.deepEqual(parseConnectedAccountsSearch({ provider: 'github', status: 'connected' }), {
      provider: 'github',
      status: 'connected'
    });
    assert.deepEqual(parseConnectedAccountsSearch({ provider: 'everhour' }), {
      provider: 'everhour'
    });
    assert.deepEqual(parseConnectedAccountsSearch({ provider: 'slack', status: 'connected' }), {});
    assert.deepEqual(parseConnectedAccountsSearch({ status: 'connected' }), {});
    assert.deepEqual(parseConnectedAccountsSearch({ provider: 'github', status: 'weird' }), {
      provider: 'github'
    });
  });
});

describe('connection return path', () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key)
    };
  }

  it('returns once to the remembered path for the same provider only', () => {
    const storage = memoryStorage();
    rememberConnectionReturn('knowledgebase', '/chat', storage);
    assert.equal(takeConnectionReturn('github', storage), null);
    rememberConnectionReturn('knowledgebase', '/chat', storage);
    assert.equal(takeConnectionReturn('knowledgebase', storage), '/chat');
    assert.equal(takeConnectionReturn('knowledgebase', storage), null);
  });

  it('never remembers an off-origin target', () => {
    const storage = memoryStorage();
    for (const path of ['//evil.example', 'https://evil.example', '/\\evil', 'chat']) {
      assert.equal(isSafeReturnPath(path), false);
      rememberConnectionReturn('knowledgebase', path, storage);
      assert.equal(takeConnectionReturn('knowledgebase', storage), null);
    }
    assert.equal(isSafeReturnPath(`/${'a'.repeat(512)}`), false);
  });
});
