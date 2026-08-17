import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDesktopOAuthHandoffUrl, parseMissionDeepLink } from './oauth-handoff.ts';

const TICKET = 'a'.repeat(43);

test('accepts only the desktop OAuth callback URL with an opaque ticket', () => {
  assert.equal(parseDesktopOAuthHandoffUrl(`overlord://auth/callback?ticket=${TICKET}`), TICKET);
});

test('rejects arbitrary deep links and credential-shaped callback values', () => {
  assert.equal(parseDesktopOAuthHandoffUrl(`overlord://auth/other?ticket=${TICKET}`), null);
  assert.equal(parseDesktopOAuthHandoffUrl(`overlord://other/callback?ticket=${TICKET}`), null);
  assert.equal(parseDesktopOAuthHandoffUrl('overlord://auth/callback?ticket=session-token'), null);
  assert.equal(parseDesktopOAuthHandoffUrl(`https://auth/callback?ticket=${TICKET}`), null);
});

test('accepts UUID and display-id mission deep links without a payload', () => {
  assert.deepEqual(
    parseMissionDeepLink('overlord://missions/bc3ae6cd-77ca-4b4d-95b3-728198379963'),
    {
      missionId: 'bc3ae6cd-77ca-4b4d-95b3-728198379963',
      objectiveDisplayId: null
    }
  );
  assert.deepEqual(parseMissionDeepLink('overlord://missions/coo:502'), {
    missionId: 'coo:502',
    objectiveDisplayId: null
  });
});

test('routes objective display ids to their mission without encoding the dot', () => {
  assert.deepEqual(parseMissionDeepLink('overlord://objectives/coo:756.k7xm'), {
    missionId: 'coo:756',
    objectiveDisplayId: 'coo:756.k7xm'
  });
  assert.deepEqual(parseMissionDeepLink('overlord://missions/coo:756.k7xm'), {
    missionId: 'coo:756',
    objectiveDisplayId: 'coo:756.k7xm'
  });
});

test('rejects objective links it cannot resolve to a mission on its own', () => {
  assert.equal(
    parseMissionDeepLink('overlord://objectives/bc3ae6cd-77ca-4b4d-95b3-728198379963'),
    null
  );
  assert.equal(parseMissionDeepLink('overlord://objectives/coo:756'), null);
  assert.equal(parseMissionDeepLink('overlord://objectives/coo:756.k7xm?ticket=secret'), null);
});

test('rejects mission deep links outside the narrow desktop route contract', () => {
  assert.equal(parseMissionDeepLink('overlord://missions/'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/coo:502/other'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/coo:502?ticket=secret'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/../../settings'), null);
  assert.equal(parseMissionDeepLink('overlord://auth/callback'), null);
  assert.equal(parseMissionDeepLink('https://missions/coo:502'), null);
});
