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
  assert.equal(
    parseMissionDeepLink('overlord://missions/bc3ae6cd-77ca-4b4d-95b3-728198379963'),
    'bc3ae6cd-77ca-4b4d-95b3-728198379963'
  );
  assert.equal(parseMissionDeepLink('overlord://missions/coo:502'), 'coo:502');
});

test('rejects mission deep links outside the narrow desktop route contract', () => {
  assert.equal(parseMissionDeepLink('overlord://missions/'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/coo:502/other'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/coo:502?ticket=secret'), null);
  assert.equal(parseMissionDeepLink('overlord://missions/../../settings'), null);
  assert.equal(parseMissionDeepLink('overlord://auth/callback'), null);
  assert.equal(parseMissionDeepLink('https://missions/coo:502'), null);
});
