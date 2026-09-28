import type { NextFunction, Request, Response } from 'express';
import assert from 'node:assert/strict';
import test from 'node:test';

import { setActiveTokenAuth, setActiveWorkspaceUser } from './db.ts';
import { projectAutomationRouteGuard } from './project-automation-routes.ts';

function allowed(method: string, originalUrl: string): boolean {
  let called = false;
  const req = { method, originalUrl } as Request;
  const res = {
    status(code: number) {
      assert.equal(code, 404);
      return this;
    },
    json() {
      return this;
    }
  } as unknown as Response;
  projectAutomationRouteGuard(req, res, (() => {
    called = true;
  }) as NextFunction);
  return called;
}

test('automation route guard closes legacy search and writes before handlers', () => {
  setActiveTokenAuth({ workspaceUserId: null, tokenId: 'token', scopeGrants: [], projectIds: [] });
  try {
    assert.equal(allowed('GET', '/api/missions/search?q=secret'), false);
    assert.equal(allowed('POST', '/api/objectives'), false);
    assert.equal(allowed('GET', '/ext/github/projects'), false);
    assert.equal(allowed('GET', '/api/missions/mission-id'), true);
    assert.equal(allowed('POST', '/api/protocol/create'), true);
    assert.equal(allowed('GET', '/sync/changes?after=0'), true);
  } finally {
    setActiveWorkspaceUser(null);
  }
});
