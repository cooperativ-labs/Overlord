import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { connectionFixture } from '../connections-fixtures.ts';

import { grantKey, knowledgebaseWriteTargets } from './knowledgebase-writes.ts';

describe('knowledgebaseWriteTargets', () => {
  it('lists each authorized workspace of connected Knowledgebase connections only', () => {
    const targets = knowledgebaseWriteTargets([
      connectionFixture({
        id: 'c1',
        provider: 'knowledgebase',
        authorizedWorkspaces: ['main', 'team']
      }),
      connectionFixture({
        id: 'c2',
        provider: 'knowledgebase',
        state: 'reauthorization_required',
        authorizedWorkspaces: ['x']
      }),
      connectionFixture({ id: 'c3', provider: 'everhour', authorizedWorkspaces: ['y'] })
    ]);
    assert.deepEqual(
      targets.map(t => [t.key, t.label, t.grant]),
      [
        ['c1:main', 'main', { connectionId: 'c1', workspace: 'main' }],
        ['c1:team', 'team', { connectionId: 'c1', workspace: 'team' }]
      ]
    );
    assert.deepEqual(knowledgebaseWriteTargets(undefined), []);
  });

  it('keys a request by its grant, so changing the grant is a new request', () => {
    assert.equal(grantKey(null), 'read');
    assert.equal(grantKey({ connectionId: 'c1', workspace: 'main' }), 'c1:main');
  });
});
