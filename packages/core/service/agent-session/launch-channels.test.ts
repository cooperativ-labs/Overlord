import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from '../errors.js';
import { createProject } from '../projects.js';
import { protocolCreate } from '../protocol.js';
import { createSeededServiceContext } from '../test-helpers.js';

import {
  authenticateChannelCredential,
  findBindableChannelForMission,
  getChannel
} from './channels.js';
import { CONTROL_PLANE_LAUNCH_KIND, mintControlPlaneLaunchChannel } from './launch-channels.js';

async function seed() {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: 'Launch channels', slug: 'launch-channels' });
  const created = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Run through the app server' }]
  });
  return { db, ctx, missionId: created.mission.id, objective: created.objectives[0]! };
}

describe('control-plane launch channel (ADR 0092)', () => {
  it('mints a credentialed channel bound to the objective that attach can find', async () => {
    const { db, ctx, missionId, objective } = await seed();
    const minted = await mintControlPlaneLaunchChannel({
      ctx,
      objectiveId: objective.id,
      adapterKey: 'codex-app-server',
      adapterVersion: '9.9.9'
    });

    assert.equal(minted.launchKind, CONTROL_PLANE_LAUNCH_KIND);
    assert.equal(minted.adapterKey, 'codex-app-server');
    assert.equal(minted.agentIdentifier, 'codex');
    assert.match(minted.token, /^osc_/);

    const channel = await getChannel({ ctx, channelId: minted.channelId });
    assert.equal(channel.state, 'preparing');
    assert.equal(channel.mission_id, missionId);
    assert.equal(channel.objective_id, objective.id);
    assert.equal(channel.adapter_key, 'codex-app-server');
    assert.equal(channel.agent_identifier, 'codex');
    assert.equal(channel.launch_kind, 'control_plane');

    const authenticated = await authenticateChannelCredential({ db, rawToken: minted.token });
    assert.equal(authenticated?.id, minted.channelId);

    // Protocol attach inside the app server carries no channel env; it binds by objective.
    const bindable = await findBindableChannelForMission({
      ctx,
      missionId,
      objectiveId: objective.id
    });
    assert.equal(bindable, minted.channelId);
  });

  it('refuses adapters that are not control-plane launch adapters', async () => {
    const { ctx, objective } = await seed();
    for (const adapterKey of ['codex', 'claude', 'opencode', '']) {
      await assert.rejects(
        mintControlPlaneLaunchChannel({ ctx, objectiveId: objective.id, adapterKey }),
        (error: unknown) =>
          error instanceof ServiceError && error.code === 'adapter_not_control_plane'
      );
    }
  });

  it('refuses a complete objective and a foreign execution request', async () => {
    const { db, ctx, objective } = await seed();
    await assert.rejects(
      mintControlPlaneLaunchChannel({
        ctx,
        objectiveId: objective.id,
        adapterKey: 'codex-app-server',
        executionRequestId: 'not-this-objectives-request'
      }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === 'execution_request_not_found'
    );
    await db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objective.id]);
    await assert.rejects(
      mintControlPlaneLaunchChannel({
        ctx,
        objectiveId: objective.id,
        adapterKey: 'codex-app-server'
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'objective_not_launchable'
    );
  });
});
