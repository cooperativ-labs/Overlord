import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * Attach is the only channel that tells the agent about objective attachments
 * (plan coo:1294, step 5): the launch prompt no longer lists them, so attach
 * must say how to download them, worded for the caller's tools.
 */

const NOW = '2026-11-17T12:00:00.000Z';

async function missionWithAttachment(ctx: ServiceContext, name: string, filename?: string) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: `Work for ${name}` }]
  });
  const objective = objectives[0]!;
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objective.id]);
  if (filename) {
    const bucketId = `bucket-${name}`;
    await ctx.db.run(
      `INSERT INTO storage_buckets (id, workspace_id, bucket_key, storage_backend, created_at, updated_at)
       VALUES (?, ?, ?, 'local', ?, ?)`,
      [bucketId, ctx.workspace.id, bucketId, NOW, NOW]
    );
    await ctx.db.run(
      `INSERT INTO attachments (
         id, workspace_id, project_id, mission_id, objective_id, storage_bucket_id,
         storage_key, filename, content_type, size_bytes, upload_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', 10, 'available', ?, ?)`,
      [
        'attachment-123',
        ctx.workspace.id,
        project.id,
        mission.id,
        objective.id,
        bucketId,
        `private/${filename}`,
        filename,
        NOW,
        NOW
      ]
    );
  }
  return { mission, objective };
}

describe('attach attachment instructions', () => {
  it('a CLI attach gives a download command for each attachment of the objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objective } = await missionWithAttachment(ctx, 'Attach CLI', 'spec.pdf');

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objective.id
    });
    const text = attached.agentInstructions;
    assert.equal(attached.attachments.length, 1);
    assert.ok(text.includes('## Attachments'));
    assert.ok(
      text.includes(
        `- spec.pdf: \`ovld protocol attachment-download-url --mission-id ${mission.displayId} --objective-id ${attached.objective.displayId} --attachment-id attachment-123 --output ./.overlord/tmp/attachment-attachment-123-spec.pdf\``
      ),
      text
    );
    assert.ok(text.includes(`ovld protocol attachment-list --mission-id ${mission.displayId}`));
    await db.close();
  });

  it('an MCP attach lists no CLI command and says no tool downloads the files', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objective } = await missionWithAttachment(ctx, 'Attach MCP', 'spec.pdf');

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objective.id,
      connectionMethod: 'mcp'
    });
    const text = attached.agentInstructions;
    assert.ok(text.includes('## Attachments'));
    assert.ok(text.includes('No Overlord MCP'));
    assert.doesNotMatch(text, /attachment-download-url/);
    assert.doesNotMatch(text, /\bovld\b/);
    await db.close();
  });

  it('an objective without attachments gets no attachment section', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objective } = await missionWithAttachment(ctx, 'Attach none');

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objective.id
    });
    assert.ok(!attached.agentInstructions.includes('## Attachments'));
    await db.close();
  });
});
