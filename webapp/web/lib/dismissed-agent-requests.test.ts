import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  dismissAgentRequest,
  dismissalStorageKey,
  forgetDismissedAgentRequests,
  getDismissedRequestIds,
  pruneDismissedAgentRequests,
  resetDismissedAgentRequestsForTests,
  setDismissalAccount
} from './dismissed-agent-requests.ts';

const missionA = { workspaceId: 'ws-1', missionId: 'mission-a' };
const missionB = { workspaceId: 'ws-1', missionId: 'mission-b' };

describe('dismissed agent requests (plan §5)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDismissedAgentRequestsForTests();
  });
  afterEach(() => resetDismissedAgentRequestsForTests());

  it('persists per mission, so visiting another mission and a reload keep a dismissal', () => {
    dismissAgentRequest(missionA, 'req-1');
    assert.deepEqual([...getDismissedRequestIds(missionB)], []);
    // A reload: the in-memory cache is gone, storage is not.
    const stored = window.localStorage.getItem(dismissalStorageKey(missionA));
    resetDismissedAgentRequestsForTests();
    window.localStorage.setItem(dismissalStorageKey(missionA), stored ?? '[]');
    assert.deepEqual([...getDismissedRequestIds(missionA)], ['req-1']);
  });

  it('scopes storage by account; switching accounts switches the visible set', () => {
    setDismissalAccount('user-1');
    dismissAgentRequest(missionA, 'req-1');
    setDismissalAccount('user-2');
    assert.deepEqual([...getDismissedRequestIds(missionA)], []);
    setDismissalAccount('user-1');
    assert.deepEqual([...getDismissedRequestIds(missionA)], ['req-1']);
    assert.match(dismissalStorageKey(missionA), /user-1/);
  });

  it('prunes only from an authoritative complete read', () => {
    dismissAgentRequest(missionA, 'req-1');
    dismissAgentRequest(missionA, 'req-2');
    // Loading, failed or partial reads prove nothing about absence.
    pruneDismissedAgentRequests(missionA, { openRequestIds: [], authoritative: false });
    assert.deepEqual([...getDismissedRequestIds(missionA)].sort(), ['req-1', 'req-2']);
    pruneDismissedAgentRequests(missionA, { openRequestIds: ['req-2'], authoritative: true });
    assert.deepEqual([...getDismissedRequestIds(missionA)], ['req-2']);
  });

  it('forgets ids named by an explicit terminal event', () => {
    dismissAgentRequest(missionA, 'req-1');
    forgetDismissedAgentRequests(missionA, ['req-1']);
    assert.deepEqual([...getDismissedRequestIds(missionA)], []);
  });

  it('keeps working in memory when storage throws', () => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error('quota');
    };
    try {
      dismissAgentRequest(missionA, 'req-1');
      assert.deepEqual([...getDismissedRequestIds(missionA)], ['req-1']);
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
