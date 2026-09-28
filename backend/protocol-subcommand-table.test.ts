import { PERMISSIONS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-protocol-subcommand-table-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });
const { ApiError } = await import('./errors.ts');
const { runProtocolSubcommand, SUBCOMMAND_PERMISSIONS } = await import('./protocol.ts');

// The permission every subcommand carried before the handlers were split into
// ./protocol/<group>.ts. Moving a handler between groups must not change it.
const EXPECTED_PERMISSIONS = {
  attach: PERMISSIONS.SESSION_ATTACH,
  update: PERMISSIONS.EVENT_CREATE,
  'sync-changes': PERMISSIONS.EVENT_CREATE,
  heartbeat: PERMISSIONS.EVENT_CREATE,
  ask: PERMISSIONS.EVENT_CREATE,
  deliver: PERMISSIONS.EVENT_CREATE,
  'hook-event': PERMISSIONS.EVENT_CREATE,
  'resume-follow-up': PERMISSIONS.SESSION_ATTACH,
  create: null,
  prompt: PERMISSIONS.MISSION_CREATE,
  'load-context': PERMISSIONS.MISSION_READ,
  'list-deliveries': PERMISSIONS.MISSION_READ,
  'launch-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'reorder-future-objectives': PERMISSIONS.OBJECTIVE_UPDATE,
  'queue-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'dequeue-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'retry-queue-entry': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'reorder-run-queue': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'create-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'update-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'delete-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'reorder-project-run-queues': PERMISSIONS.PROJECT_UPDATE,
  'run-queue': PERMISSIONS.OBJECTIVE_READ,
  connect: PERMISSIONS.SESSION_ATTACH,
  'search-missions': PERMISSIONS.MISSION_READ,
  'discuss-objective': PERMISSIONS.OBJECTIVE_SUBMIT,
  'add-objectives': PERMISSIONS.OBJECTIVE_UPDATE,
  'update-objective': PERMISSIONS.OBJECTIVE_UPDATE,
  'delete-missions': null,
  'delete-objectives': null,
  'record-work': PERMISSIONS.MISSION_CREATE,
  'read-context': PERMISSIONS.MISSION_READ,
  'write-context': PERMISSIONS.MISSION_UPDATE,
  'add-artifact': PERMISSIONS.ARTIFACT_CREATE,
  'update-artifact': PERMISSIONS.MISSION_UPDATE,
  'attachment-list': PERMISSIONS.ARTIFACT_READ,
  'attachment-download-url': PERMISSIONS.ARTIFACT_READ,
  'auth-status': null,
  'discover-project': PERMISSIONS.PROJECT_READ,
  statuses: PERMISSIONS.PROJECT_READ,
  'create-project': null,
  'register-target': null,
  'list-organizations': PERMISSIONS.PROJECT_READ
};

test('every protocol subcommand keeps its permission across the group split', () => {
  assert.deepEqual({ ...SUBCOMMAND_PERMISSIONS }, EXPECTED_PERMISSIONS);
});

test('an unknown subcommand is a 404 listing the supported names', async () => {
  for (const name of ['no-such-subcommand', 'toString', 'constructor']) {
    await assert.rejects(
      () => runProtocolSubcommand(name, {}),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        assert.match(error.message, /Unknown protocol subcommand/);
        return true;
      }
    );
  }
});

test('subcommand group modules never import the dispatcher', () => {
  const groupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'protocol');
  for (const file of readdirSync(groupDir).filter(name => name.endsWith('.ts'))) {
    const source = readFileSync(path.join(groupDir, file), 'utf8');
    assert.doesNotMatch(source, /from '\.\.\/protocol\.ts'/, `${file} imports ../protocol.ts`);
  }
});
