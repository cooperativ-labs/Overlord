import type { NextFunction, Request, Response } from 'express';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const scratch = process.env.OVERLORD_TMPDIR ?? path.join(import.meta.dirname, '../.overlord/tmp');
mkdirSync(scratch, { recursive: true });
const tempDir = mkdtempSync(path.join(scratch, 'ovld-project-automation-routes-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'webapp.sqlite');
const { setActiveTokenAuth, setActiveWorkspaceUser } = await import('./db.ts');
const { projectAutomationRouteGuard } = await import('./project-automation-routes.ts');
const { SUBCOMMAND_PERMISSIONS } = await import('./protocol.ts');

function allowed(method: string, originalUrl: string): boolean {
  let called = false;
  const req = { method, originalUrl } as Request;
  const res = {
    status(code: number) {
      assert.equal(code, 404);
      return this;
    },
    json(body: unknown) {
      assert.deepEqual(body, { error: 'Not found' });
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
    assert.equal(allowed('GET', '/sync/baseline'), true);
  } finally {
    setActiveWorkspaceUser(null);
  }
});

test('automation route guard admits POST for exactly the contract protocol subcommands', () => {
  const expected = [
    'create',
    'load-context',
    'search',
    'discover-project',
    'statuses',
    'list-deliveries',
    'objective-changes',
    'attachment-list',
    'attachment-download-url',
    'auth-status'
  ].sort();
  setActiveTokenAuth({
    workspaceUserId: null,
    tokenId: 'token',
    scopeGrants: [],
    projectIds: ['selected-project']
  });
  try {
    const admitted = Object.keys(SUBCOMMAND_PERMISSIONS).filter(name =>
      allowed('POST', `/api/protocol/${name}`)
    );
    assert.deepEqual(admitted.sort(), expected);
    assert.equal(allowed('POST', '/api/protocol/no-such-subcommand'), false);
    assert.equal(allowed('POST', '/api/protocol/auth-status/'), false);
    assert.equal(allowed('GET', '/api/protocol/auth-status'), false);
  } finally {
    setActiveWorkspaceUser(null);
  }
});
