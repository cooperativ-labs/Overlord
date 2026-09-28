import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { jsonTextFieldSql } from './util.js';

describe('jsonTextFieldSql', () => {
  it('uses the jsonb text operator on Postgres', () => {
    assert.equal(
      jsonTextFieldSql('me.payload_json', 'agentRequestId', 'postgres'),
      "me.payload_json->>'agentRequestId'"
    );
  });

  it('uses json_extract on SQLite', () => {
    assert.equal(
      jsonTextFieldSql('me.payload_json', 'agentRequestId', 'sqlite'),
      "json_extract(me.payload_json, '$.agentRequestId')"
    );
  });
});
