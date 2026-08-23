import { createIsolatedCheckout } from '@overlord/core/service/test-checkout';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-pm-management-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createProject, createProjectResource } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

type CreatedMission = {
  mission: { id: string };
  objectives: Array<{ id: string; displayId: string; objective: string; state: string }>;
};

test('PM protocol commands preserve delivery, launch, and future-order service behavior', async () => {
  const project = await createProject({ name: `PM protocol ${Date.now()}` });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-protocol-pm-management-resource-'),
    executionTargetId: null,
    isPrimary: true
  });

  const queuedMission = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objectives-json': JSON.stringify([
        { objective: 'Launch through the normal execution queue' },
        { objective: 'Second future objective' },
        { objective: 'Third future objective' }
      ])
    }
  })) as CreatedMission;
  const [launchable, secondFuture, thirdFuture] = queuedMission.objectives;
  assert.ok(launchable && secondFuture && thirdFuture);

  const queued = (await runProtocolSubcommand('launch-objective', {
    flags: { '--objective-id': launchable.displayId, '--agent': 'codex' }
  })) as { objectiveId: string; requestedAgent: string };
  assert.equal(queued.objectiveId, launchable.id);
  assert.equal(queued.requestedAgent, 'codex');

  const reordered = (await runProtocolSubcommand('reorder-future-objectives', {
    flags: {
      '--mission-id': queuedMission.mission.id,
      '--ordered-objective-ids-json': JSON.stringify([thirdFuture.id, secondFuture.id])
    }
  })) as Array<{ id: string; state: string }>;
  assert.deepEqual(
    reordered.filter(objective => objective.state === 'future').map(objective => objective.id),
    [thirdFuture.id, secondFuture.id]
  );

  const deliveryMission = (await runProtocolSubcommand('create', {
    flags: { '--project-id': project.id, '--objective': 'Deliver evidence for PM retrieval' }
  })) as CreatedMission;
  const deliveredObjective = deliveryMission.objectives[0];
  assert.ok(deliveredObjective);
  const attached = (await runProtocolSubcommand('attach', {
    flags: { '--mission-id': deliveryMission.mission.id, '--agent': 'codex' }
  })) as { sessionKey: string };
  await runProtocolSubcommand('deliver', {
    flags: {
      '--mission-id': deliveryMission.mission.id,
      '--session-key': attached.sessionKey,
      '--summary': 'Delivered evidence is visible to PM agents.'
    }
  });

  const deliveries = (await runProtocolSubcommand('list-deliveries', {
    flags: { '--objective-id': deliveredObjective.displayId }
  })) as Array<{
    objectiveId: string;
    summary: string;
    report: { agentReport: { humanActions: unknown[] } };
  }>;
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.objectiveId, deliveredObjective.id);
  assert.equal(deliveries[0]?.summary, 'Delivered evidence is visible to PM agents.');
  assert.deepEqual(deliveries[0]?.report.agentReport.humanActions, []);
});
