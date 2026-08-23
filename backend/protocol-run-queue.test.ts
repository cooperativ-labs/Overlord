import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-protocol-run-queue-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const { createProject } = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { ServiceError } = await import('../packages/core/service/errors.ts');
const { SUBCOMMAND_PERMISSIONS } = await import('./protocol.ts');
const { PERMISSIONS, scopeGrantsForPreset, tokenScopeAllows } = await import('@overlord/auth');

type QueueEntry = {
  id: string;
  objectiveId: string;
  objectiveDisplayId: string;
  state: string;
};

type RunQueue = {
  id: string;
  name: string;
  isDefault: boolean;
  paused: boolean;
  entries: QueueEntry[];
};

type RunQueues = {
  projectId: string;
  queues: RunQueue[];
};

type CreatedMission = {
  objectives: Array<{ id: string; displayId: string }>;
};

test('sync-changes requires the same event-create permission as lifecycle writes', () => {
  assert.equal(SUBCOMMAND_PERMISSIONS['sync-changes'], PERMISSIONS.EVENT_CREATE);
});

async function createQueuedObjectives() {
  const project = await createProject({ name: `Run Queue protocol ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objectives-json': JSON.stringify([
        { objective: 'First queued objective', autoAdvance: true },
        { objective: 'Second queued objective', autoAdvance: true },
        { objective: 'Third queued objective', autoAdvance: true }
      ])
    }
  })) as CreatedMission;
  const queueState = (await runProtocolSubcommand('run-queue', {
    flags: { '--project-id': project.id }
  })) as RunQueues;
  const queue = queueState.queues[0];
  assert.ok(queue);
  return { project, objectives: created.objectives, queue };
}

/** Mark one queue as the project default so the default-queue guards can be exercised. */
function markDefaultQueue(queueId: string): void {
  bootstrap.db.prepare('UPDATE run_queues SET is_default = 1 WHERE id = ?').run(queueId);
}

test('protocol reorders every Run Queue entry with entry ids or objective display ids', async () => {
  const { project, objectives, queue } = await createQueuedObjectives();
  const first = objectives[0];
  const second = objectives[1];
  const third = objectives[2];
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);

  const reordered = (await runProtocolSubcommand('reorder-run-queue', {
    flags: {
      '--project-id': project.id,
      '--queue': queue.id,
      '--ordered-entries-json': JSON.stringify([third.displayId, queue.entries[0]?.id, second.id])
    }
  })) as RunQueue;

  assert.deepEqual(
    reordered.entries.map(entry => entry.objectiveId),
    [third.id, first.id, second.id]
  );

  const restored = (await runProtocolSubcommand('reorder-run-queue', {
    flags: {
      '--project-id': project.id,
      '--queue': queue.id,
      '--ordered-entries-file': '-'
    },
    fileInputs: {
      '--ordered-entries-file': JSON.stringify([first.id, second.id, third.id])
    }
  })) as RunQueue;
  assert.deepEqual(
    restored.entries.map(entry => entry.objectiveId),
    [first.id, second.id, third.id]
  );
});

test('protocol Run Queue reorder returns the live current order for an incomplete input', async () => {
  const { project, objectives, queue } = await createQueuedObjectives();
  const first = objectives[0];
  const second = objectives[1];
  const third = objectives[2];
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);

  await assert.rejects(
    () =>
      runProtocolSubcommand('reorder-run-queue', {
        flags: {
          '--project-id': project.id,
          '--queue': queue.id,
          '--ordered-entries-json': JSON.stringify([first.id, second.id])
        }
      }),
    error => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'invalid_run_queue_order');
      assert.deepEqual(error.details, {
        currentOrder: [first.displayId, second.displayId, third.displayId],
        runningEntryId: null
      });
      return true;
    }
  );
});

test('protocol Run Queue reorder refuses a running entry and identifies it for retry', async () => {
  const { project, objectives, queue } = await createQueuedObjectives();
  const first = objectives[0];
  const second = objectives[1];
  const third = objectives[2];
  const running = queue.entries[1];
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);
  assert.ok(running);

  bootstrap.db
    .prepare("UPDATE run_queue_entries SET state = 'running' WHERE id = ?")
    .run(running.id);

  await assert.rejects(
    () =>
      runProtocolSubcommand('reorder-run-queue', {
        flags: {
          '--project-id': project.id,
          '--queue': queue.id,
          '--ordered-entries-json': JSON.stringify([second.id, first.id, third.id])
        }
      }),
    error => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'run_queue_entry_running');
      assert.deepEqual(error.details, {
        currentOrder: [first.displayId, second.displayId, third.displayId],
        runningEntryId: running.id
      });
      return true;
    }
  );
});

test('protocol run-queue derives a project from an objective and rejects a mismatch', async () => {
  const { project, objectives, queue } = await createQueuedObjectives();
  const objective = objectives[0];
  assert.ok(objective);

  const derived = (await runProtocolSubcommand('run-queue', {
    flags: { '--objective-id': objective.displayId, '--queue': queue.id }
  })) as RunQueues;
  assert.equal(derived.projectId, project.id);
  assert.equal(derived.queues.length, 1);

  const otherProject = await createProject({ name: `Other Run Queue project ${Date.now()}` });
  await assert.rejects(
    () =>
      runProtocolSubcommand('run-queue', {
        flags: { '--project-id': otherProject.id, '--objective-id': objective.displayId }
      }),
    error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, '--project-id does not own the addressed objective');
      return true;
    }
  );
});

test('protocol creates, renames, pauses, and deletes a Run Queue', async () => {
  const { project, objectives, queue: sourceQueue } = await createQueuedObjectives();
  const first = objectives[0];
  assert.ok(first);

  const created = (await runProtocolSubcommand('create-run-queue', {
    flags: { '--project-id': project.id, '--name': 'Priority' }
  })) as RunQueue;
  assert.equal(created.name, 'Priority');
  assert.equal(created.isDefault, false);
  assert.equal(created.paused, false);

  const renamed = (await runProtocolSubcommand('update-run-queue', {
    flags: { '--project-id': project.id, '--queue': 'Priority', '--name': 'Hot path' }
  })) as RunQueue;
  assert.equal(renamed.name, 'Hot path');

  const paused = (await runProtocolSubcommand('update-run-queue', {
    flags: { '--project-id': project.id, '--queue': 'Hot path', '--pause': true }
  })) as RunQueue;
  assert.equal(paused.paused, true);

  const resumed = (await runProtocolSubcommand('update-run-queue', {
    flags: { '--project-id': project.id, '--queue': created.id, '--resume': true }
  })) as RunQueue;
  assert.equal(resumed.paused, false);

  await assert.rejects(
    () =>
      runProtocolSubcommand('update-run-queue', {
        flags: {
          '--project-id': project.id,
          '--queue': created.id,
          '--pause': true,
          '--resume': true
        }
      }),
    error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, 'Choose only one pause option: --pause or --resume');
      return true;
    }
  );

  await assert.rejects(
    () =>
      runProtocolSubcommand('update-run-queue', {
        flags: { '--project-id': project.id, '--queue': created.id }
      }),
    error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, 'Nothing to update: supply --name, --pause, or --resume');
      return true;
    }
  );

  // Move one entry into the new queue so deletion has to relocate it.
  await runProtocolSubcommand('queue-objective', {
    flags: { '--objective-id': first.displayId, '--queue': created.id }
  });
  await assert.rejects(
    () =>
      runProtocolSubcommand('delete-run-queue', {
        flags: { '--project-id': project.id, '--queue': created.id }
      }),
    error => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'run_queue_not_empty');
      assert.equal(error.status, 409);
      return true;
    }
  );

  const removed = await runProtocolSubcommand('delete-run-queue', {
    flags: {
      '--project-id': project.id,
      '--queue': created.id,
      '--move-entries-to': sourceQueue.id
    }
  });
  assert.deepEqual(removed, { removed: true, projectId: project.id });

  const after = (await runProtocolSubcommand('run-queue', {
    flags: { '--project-id': project.id }
  })) as RunQueues;
  assert.equal(
    after.queues.some(entry => entry.id === created.id),
    false
  );
  assert.equal(after.queues.find(entry => entry.id === sourceQueue.id)?.entries.length, 3);
});

test('protocol refuses to delete the default Run Queue', async () => {
  const { project } = await createQueuedObjectives();
  const fallback = (await runProtocolSubcommand('create-run-queue', {
    flags: { '--project-id': project.id, '--name': 'Default' }
  })) as RunQueue;
  markDefaultQueue(fallback.id);

  await assert.rejects(
    () =>
      runProtocolSubcommand('delete-run-queue', {
        flags: { '--project-id': project.id, '--queue': fallback.id }
      }),
    error => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'default_run_queue');
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test('protocol reorders queue definitions and keeps the default queue first', async () => {
  const { project } = await createQueuedObjectives();
  const fallback = (await runProtocolSubcommand('create-run-queue', {
    flags: { '--project-id': project.id, '--name': 'Default' }
  })) as RunQueue;
  markDefaultQueue(fallback.id);
  const priority = (await runProtocolSubcommand('create-run-queue', {
    flags: { '--project-id': project.id, '--name': 'Priority' }
  })) as RunQueue;
  const backlog = (await runProtocolSubcommand('create-run-queue', {
    flags: { '--project-id': project.id, '--name': 'Backlog' }
  })) as RunQueue;
  const missionQueue = (
    (await runProtocolSubcommand('run-queue', {
      flags: { '--project-id': project.id }
    })) as RunQueues
  ).queues.find(
    entry => entry.id !== fallback.id && entry.id !== priority.id && entry.id !== backlog.id
  );
  assert.ok(missionQueue);

  const reordered = (await runProtocolSubcommand('reorder-project-run-queues', {
    flags: {
      '--project-id': project.id,
      '--ordered-queues-json': JSON.stringify([fallback.id, 'Backlog', 'Priority', missionQueue.id])
    }
  })) as RunQueues;
  assert.deepEqual(
    reordered.queues.map(entry => entry.id),
    [fallback.id, backlog.id, priority.id, missionQueue.id]
  );

  const piped = (await runProtocolSubcommand('reorder-project-run-queues', {
    flags: { '--project-id': project.id, '--ordered-queues-file': '-' },
    fileInputs: {
      '--ordered-queues-file': JSON.stringify([
        fallback.id,
        priority.id,
        backlog.id,
        missionQueue.id
      ])
    }
  })) as RunQueues;
  assert.deepEqual(
    piped.queues.map(entry => entry.id),
    [fallback.id, priority.id, backlog.id, missionQueue.id]
  );

  await assert.rejects(
    () =>
      runProtocolSubcommand('reorder-project-run-queues', {
        flags: {
          '--project-id': project.id,
          '--ordered-queues-json': JSON.stringify([
            priority.id,
            fallback.id,
            backlog.id,
            missionQueue.id
          ])
        }
      }),
    error => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'default_run_queue_position');
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test('a mission_lifecycle token can reorder entries but cannot manage queue definitions', () => {
  const scope = scopeGrantsForPreset('mission_lifecycle');
  assert.equal(SUBCOMMAND_PERMISSIONS['reorder-run-queue'], PERMISSIONS.EXECUTION_REQUEST_CREATE);
  assert.equal(tokenScopeAllows(scope, PERMISSIONS.EXECUTION_REQUEST_CREATE), true);

  for (const subcommand of [
    'create-run-queue',
    'update-run-queue',
    'delete-run-queue',
    'reorder-project-run-queues'
  ]) {
    assert.equal(SUBCOMMAND_PERMISSIONS[subcommand], PERMISSIONS.PROJECT_UPDATE, subcommand);
  }
  // Section 5 of the plan: queue-definition lifecycle is a full-token surface.
  assert.equal(tokenScopeAllows(scope, PERMISSIONS.PROJECT_UPDATE), false);
});
