import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  publishDeliverySummary,
  readDeliverySummaryContext
} from './delivery-summary-publication.js';
import { createMissionWithObjectives } from './missions.js';
import { countOtherMissionOpenItems, matchProjectItem } from './project-items.js';
import { createProject } from './projects.js';
import {
  attachSession,
  closeAgentMissionItems,
  deliverSession,
  readAgentProjectItems,
  recordWork
} from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contract/project-item-match-vectors.json', import.meta.url),
    'utf8'
  )
);
for (const vector of fixture.vectors)
  test(`project item matching: ${vector.name}`, () => {
    assert.deepEqual(matchProjectItem(vector.text, vector.paths), vector.expected);
  });

async function source(ctx: any, projectId: string) {
  const created = await createMissionWithObjectives({
    ctx,
    projectId,
    objectives: [{ objective: 'Resolve project items' }]
  });
  const attached = await attachSession({ ctx, missionId: created.mission.id });
  return {
    ...created,
    attached,
    scope: { ctx, missionId: created.mission.id, sessionKey: attached.sessionKey }
  };
}
const report = {
  deliveryReport: {
    schemaVersion: 1,
    agentReport: { knownRisks: ['backend/services/retry.ts can fail'] }
  }
};

test('500-item project: ranking, compact attach, filters, paging, capture, scope and replay-publication journey', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
  try {
    const project = await createProject({ ctx, name: 'Discovery project' });
    const target = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Earlier work',
      summary: 'Earlier delivery',
      payloadJson: report
    });
    const original = await db.get<any>('SELECT * FROM mission_items WHERE delivery_id = ?', [
      target.deliveryId
    ]);
    // Clone accepted item rows to exercise realistic size without manufacturing reports or sessions.
    for (let i = 0; i < 499; i++)
      await db.run(
        `INSERT INTO mission_items
    (id,workspace_id,project_id,mission_id,objective_id,delivery_id,kind,item_ref,position,text,detail_json,status,reported_at,created_at,updated_at,revision)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          `candidate-${i}`,
          original.workspace_id,
          project.id,
          original.mission_id,
          original.objective_id,
          target.deliveryId,
          'risk',
          `risk-${i}`,
          i + 1,
          i === 0 ? 'retry.ts ' + 'x'.repeat(260) : `Unrelated risk ${i}`,
          '{}',
          'open',
          original.reported_at,
          original.created_at,
          original.updated_at
        ]
      );
    const active = await source(ctx, project.id);
    assert.equal(active.attached.missionSummary?.otherMissionOpenItems, 500);
    assert.match(active.attached.agentInstructions, /project-items/);
    assert.equal('otherMissionOpenItems' in active.attached, false);
    const base = await readAgentProjectItems(active.scope);
    assert.equal(base.items.length, 20);
    assert.equal(base.total, 500);
    assert.equal(base.nextOffset, 20);
    assert.equal(base.ledger.captureGap, true);
    const ranked = await readAgentProjectItems({
      ...active.scope,
      paths: ['backend/services/retry.ts']
    });
    assert.equal(ranked.items[0]!.id, original.id);
    assert.equal(ranked.items[0]!.match.strength, 'strong');
    assert.equal(ranked.items[1]!.match.strength, 'weak');
    assert.equal(ranked.items[1]!.text.length, 240);
    assert.equal(ranked.items[1]!.textTruncated, true);
    const second = await readAgentProjectItems({
      ...active.scope,
      paths: ['backend/services/retry.ts'],
      offset: 20
    });
    assert.equal(new Set([...ranked.items, ...second.items].map(i => i.id)).size, 40);
    assert.equal((await readAgentProjectItems({ ...active.scope, query: original.id })).total, 0);
    assert.equal((await readAgentProjectItems({ ...active.scope, query: 'RETRY.TS' })).total, 2);
    assert.equal(
      (await readAgentProjectItems({ ...active.scope, kinds: ['suggestion'] })).total,
      0
    );
    for (const options of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { query: 'x'.repeat(201) },
      { kinds: ['bad'] },
      { paths: ['../bad'] }
    ])
      await assert.rejects(readAgentProjectItems({ ...active.scope, ...options }));
    await assert.rejects(
      readAgentProjectItems({ ...active.scope, objectiveId: original.objective_id })
    );
    await assert.rejects(
      readAgentProjectItems({ ...active.scope, ctx: { ...ctx, allowedProjectIds: [] } })
    );
    const other = await createProject({ ctx, name: 'Foreign' });
    const foreign = await source(ctx, other.id);
    assert.equal((await readAgentProjectItems(foreign.scope)).total, 0);
    await assert.rejects(
      readAgentProjectItems({ ...active.scope, sessionKey: foreign.attached.sessionKey })
    );
    // A verified standalone close links exactly once at accepted delivery; stale prose does not roll it back.
    const closed = await closeAgentMissionItems({
      ...active.scope,
      closeItems: [{ id: original.id, status: 'done', reason: 'Verified retry fix' }]
    });
    assert.deepEqual(closed.closedItemIds, [original.id]);
    const input = {
      ...active.scope,
      summary: 'Resolved retry',
      operationId: 'discovery-journey-1',
      missionSummary: {
        baseContentRevision: 999,
        baseEvidenceRevision: 999,
        headline: 'Resolved retry',
        summary: 'Retry fixed',
        closeItems: [{ id: 'candidate-0', status: 'done', reason: 'Verified the same retry fix' }]
      }
    };
    const delivery = await deliverSession(input);
    const replay = await deliverSession(input);
    assert.equal(replay.deliveryId, delivery.deliveryId);
    assert.equal(replay.replayed, true);
    await assert.rejects(readAgentProjectItems(active.scope));
    assert.equal(
      (
        await db.get<any>('SELECT resolved_by_delivery_id FROM mission_items WHERE id = ?', [
          original.id
        ])
      ).resolved_by_delivery_id,
      delivery.deliveryId
    );
    const publication = await readDeliverySummaryContext({
      ...active.scope,
      deliveryId: delivery.deliveryId
    });
    const published = await publishDeliverySummary({
      ...active.scope,
      deliveryId: delivery.deliveryId,
      operationId: 'discovery-publish-1',
      narrative: {
        baseContentRevision: publication.baseline!.contentRevision,
        baseEvidenceRevision: publication.baseline!.evidenceRevision,
        headline: 'Retry resolved',
        summary: 'Accepted retry work and earlier outcomes.'
      }
    });
    assert.ok(published);
    assert.equal(
      await countOtherMissionOpenItems(db, {
        workspaceId: ctx.workspace.id,
        projectId: project.id,
        missionId: active.mission.id
      }),
      498
    );
  } finally {
    await db.close();
  }
});

test('draft-only projects produce zero discovery results/counts and no conditional hint', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
  try {
    const project = await createProject({ ctx, name: 'Draft project' });
    const active = await source(ctx, project.id);
    const { updateSession } = await import('./protocol.js');
    await updateSession({
      ...active.scope,
      summary: 'Collect provisional risk',
      reportDraft: {
        expectedRevision: 0,
        operationId: 'discovery-draft-1',
        operations: [
          {
            op: 'upsert',
            kind: 'known_risk',
            entryId: 'risk-1',
            content: { text: 'backend/services/retry.ts provisional' }
          }
        ]
      }
    });
    assert.equal((await readAgentProjectItems(active.scope)).total, 0);
    const another = await source(ctx, project.id);
    assert.equal(another.attached.missionSummary?.otherMissionOpenItems, 0);
    assert.doesNotMatch(another.attached.agentInstructions, /Before delivery, run/);
  } finally {
    await db.close();
  }
});

test('scan bound, live ledger, own mission inclusion, deleted sources and MCP attach vocabulary', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
  try {
    const project = await createProject({ ctx, name: 'Scan project' });
    const target = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Report risks',
      summary: 'Reported',
      payloadJson: report
    });
    const active = await source(ctx, project.id);
    const { syncChanges } = await import('./protocol.js');
    await syncChanges({
      ...active.scope,
      changes: [
        {
          filePath: 'backend/services/retry.ts',
          idempotencyKey: 'discovery-ledger-1',
          source: 'declared_edit'
        }
      ]
    });
    const first = await readAgentProjectItems(active.scope);
    assert.equal(first.ledger.paths, 1);
    assert.equal(first.items[0]!.match.strength, 'strong');
    const row = await db.get<any>('SELECT * FROM mission_items WHERE delivery_id = ?', [
      target.deliveryId
    ]);
    for (let i = 0; i < 2001; i++)
      await db.run(
        `INSERT INTO mission_items
      (id,workspace_id,project_id,mission_id,objective_id,delivery_id,kind,item_ref,position,text,detail_json,status,reported_at,created_at,updated_at,revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          `scan-${i}`,
          ctx.workspace.id,
          project.id,
          row.mission_id,
          row.objective_id,
          target.deliveryId,
          'risk',
          `scan-${i}`,
          i + 1,
          `Risk ${i}`,
          '{}',
          'open',
          row.reported_at,
          row.created_at,
          row.updated_at
        ]
      );
    const page = await readAgentProjectItems({ ...active.scope, limit: 100, offset: 1990 });
    assert.equal(page.scanTruncated, true);
    assert.equal(page.total, 2000);
    assert.equal(page.items.length, 10);
    assert.equal(page.nextOffset, null);
    assert.equal((await readAgentProjectItems({ ...active.scope, query: 'Risk 2000' })).total, 0);
    const mcp = await attachSession({
      ...active.scope,
      objectiveId: active.objectives[0]!.id,
      existingSessionKey: active.attached.sessionKey,
      connectionMethod: 'mcp'
    });
    assert.match(mcp.agentInstructions, /overlord_project_items/);
    assert.match(mcp.agentInstructions, /overlord_close_items/);
    await db.run('UPDATE deliveries SET deleted_at = ? WHERE id = ?', [
      new Date().toISOString(),
      target.deliveryId
    ]);
    assert.equal((await readAgentProjectItems(active.scope)).total, 0);
    assert.equal(
      await countOtherMissionOpenItems(db, {
        workspaceId: ctx.workspace.id,
        projectId: project.id,
        missionId: active.mission.id
      }),
      0
    );
    // An accepted delivery in the active mission is included only on explicit request.
    const sibling = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Earlier own work' }, { objective: 'Current own work' }]
    });
    const a = await attachSession({
      ctx,
      missionId: sibling.mission.id,
      objectiveId: sibling.objectives[0]!.id
    });
    await deliverSession({
      ctx,
      missionId: sibling.mission.id,
      sessionKey: a.sessionKey,
      summary: 'Own risk',
      payloadJson: report
    });
    const b = await attachSession({
      ctx,
      missionId: sibling.mission.id,
      objectiveId: sibling.objectives[1]!.id
    });
    const ownScope = { ctx, missionId: sibling.mission.id, sessionKey: b.sessionKey };
    assert.equal((await readAgentProjectItems(ownScope)).total, 0);
    const own = await readAgentProjectItems({ ...ownScope, includeOwnMission: true });
    assert.equal(own.total, 1);
    assert.equal(own.excludedMissionId, null);
  } finally {
    await db.close();
  }
});

test('kind and substring filters search complete suggestion fields before compact projection', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
  try {
    const project = await createProject({ ctx, name: 'Suggestion filters' });
    await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Report work',
      summary: 'Reported',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            humanActions: [{ action: 'Run migration', category: 'database', blocking: true }],
            deferredWork: [
              {
                title: 'Improve retries',
                change: 'Handle RATE_LIMIT safely',
                location: 'backend/services/retry.ts',
                doneWhen: 'No duplicate dispatches'
              }
            ]
          }
        }
      }
    });
    const active = await source(ctx, project.id);
    for (const query of ['rate_limit', 'services/retry.ts', 'duplicate dispatches']) {
      const page = await readAgentProjectItems({ ...active.scope, kinds: ['suggestion'], query });
      assert.equal(page.total, 1);
      assert.equal(page.items[0]!.location, 'backend/services/retry.ts');
    }
    const actions = await readAgentProjectItems({ ...active.scope, kinds: ['human_action'] });
    assert.equal(actions.items[0]!.blocking, true);
  } finally {
    await db.close();
  }
});
