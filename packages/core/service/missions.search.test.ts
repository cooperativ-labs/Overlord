import { parseMatchesPerResult, parseSearchEntityTypes } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import {
  mergeWorkspaceSearchV3,
  normalizeSearchV3Options,
  searchChildRelevance
} from './mission-search.js';
import { createMissionWithObjectives, searchMissions, searchMissionsV3 } from './missions.js';
import { createProject } from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';
import { newId, nowIso } from './util.js';

async function setup(): Promise<{ ctx: ServiceContext; projectId: string }> {
  const { ctx } = await createSeededServiceContext({ source: 'cli' });
  const project = await createProject({ ctx, name: 'Search Project' });
  return { ctx, projectId: project.id };
}

async function recordEvent(
  ctx: ServiceContext,
  missionId: string,
  projectId: string,
  summary: string
): Promise<void> {
  await ctx.db.run(
    `INSERT INTO mission_events (
         id, workspace_id, project_id, mission_id, type, summary, source, created_at
       ) VALUES (?, ?, ?, ?, 'update', ?, 'cli', ?)`,
    [newId(), ctx.workspace.id, projectId, missionId, summary, nowIso()]
  );
}

async function recordDelivery(
  ctx: ServiceContext,
  {
    missionId,
    objectiveId,
    projectId,
    summary
  }: { missionId: string; objectiveId: string; projectId: string; summary: string }
): Promise<void> {
  const now = nowIso();
  await ctx.db.run(
    `INSERT INTO deliveries (
       id, workspace_id, project_id, mission_id, objective_id, summary,
       payload_json, delivered_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    [newId(), ctx.workspace.id, projectId, missionId, objectiveId, summary, now, now, now]
  );
}

describe('searchMissions full-text ranking', () => {
  it('matches on mission title, objective body, and event summary', async () => {
    const { ctx, projectId } = await setup();

    const titled = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Zylophonics dashboard rewrite',
      objectives: [{ objective: 'Plain unrelated work' }]
    });
    const viaObjective = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Generic mission two',
      objectives: [{ objective: 'Investigate the quarkbarrel ingestion pipeline' }]
    });
    const viaEvent = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Generic mission three',
      objectives: [{ objective: 'Some baseline task' }]
    });
    await recordEvent(
      ctx,
      viaEvent.mission.id,
      projectId,
      'Agent noted a flux capacitor regression in logs'
    );

    assert.deepEqual(
      (await searchMissions({ ctx, query: 'zylophonics' })).map(t => t.id),
      [titled.mission.id]
    );
    assert.deepEqual(
      (await searchMissions({ ctx, query: 'quarkbarrel' })).map(t => t.id),
      [viaObjective.mission.id]
    );
    assert.deepEqual(
      (await searchMissions({ ctx, query: 'capacitor' })).map(t => t.id),
      [viaEvent.mission.id]
    );

    await ctx.db.close();
  });

  it('supports prefix matching on partial words', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Implement efficient mission search',
      objectives: [{ objective: 'baseline' }]
    });

    assert.deepEqual(
      (await searchMissions({ ctx, query: 'effic' })).map(t => t.id),
      [mission.mission.id]
    );
    await ctx.db.close();
  });

  it('ranks a title match above an event-only match for the same term', async () => {
    const { ctx, projectId } = await setup();
    const inTitle = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Moonbeam telemetry overhaul',
      objectives: [{ objective: 'baseline one' }]
    });
    const inEvent = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Logging cleanup',
      objectives: [{ objective: 'baseline two' }]
    });
    await recordEvent(
      ctx,
      inEvent.mission.id,
      projectId,
      'Discussed moonbeam edge cases with the team'
    );

    const ranked = (await searchMissions({ ctx, query: 'moonbeam' })).map(t => t.id);
    assert.deepEqual(ranked, [inTitle.mission.id, inEvent.mission.id]);
    await ctx.db.close();
  });

  it('keeps delivery documents out of the frozen v1/v2 search corpus', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Delivery exclusion regression',
      objectives: [{ objective: 'baseline' }]
    });
    await recordDelivery(ctx, {
      missionId: mission.mission.id,
      objectiveId: mission.objectives[0]!.id,
      projectId,
      summary: 'Only deliveryneedle appears in this delivery summary'
    });

    assert.deepEqual(await searchMissions({ ctx, query: 'deliveryneedle' }), []);
    await ctx.db.close();
  });

  it('drops soft-deleted missions from results', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Krypton storage migration',
      objectives: [{ objective: 'baseline' }]
    });

    assert.equal((await searchMissions({ ctx, query: 'krypton' })).length, 1);

    await ctx.db.run(`UPDATE missions SET deleted_at = ?, revision = revision + 1 WHERE id = ?`, [
      nowIso(),
      mission.mission.id
    ]);

    assert.equal((await searchMissions({ ctx, query: 'krypton' })).length, 0);
    // Soft-deleting the mission removes all of its indexed documents.
    const remaining = (await ctx.db.get(
      `SELECT COUNT(*) AS c FROM search_documents WHERE mission_id = ?`,
      [mission.mission.id]
    )) as { c: number };
    assert.equal(remaining.c, 0);
    await ctx.db.close();
  });

  it('falls back to a recency listing when the query has no usable terms', async () => {
    const { ctx, projectId } = await setup();
    const older = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Older mission',
      objectives: [{ objective: 'baseline' }]
    });
    const newer = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Newer mission',
      objectives: [{ objective: 'baseline' }]
    });
    // Touch the newer mission so it sorts first by updated_at.
    await ctx.db.run(`UPDATE missions SET updated_at = ? WHERE id = ?`, [
      '2999-01-01T00:00:00.000Z',
      newer.mission.id
    ]);

    const results = await searchMissions({ ctx, query: '   ' });
    assert.ok(results.length >= 2);
    assert.equal(results[0]?.id, newer.mission.id);
    assert.ok(results.some(t => t.id === older.mission.id));
    await ctx.db.close();
  });
});

describe('searchMissionsV3 grouped retrieval', () => {
  it('returns identifiable objective and delivery matches under the mission', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Grouped retrieval parent',
      objectives: [
        { objective: 'Investigate the groupneedle ingestion path' },
        { objective: 'Document groupneedle fallback behaviour' }
      ]
    });
    await recordDelivery(ctx, {
      missionId: mission.mission.id,
      objectiveId: mission.objectives[0]!.id,
      projectId,
      summary: 'Closed the groupneedle follow-up: still need to rotate keys'
    });

    const v3 = await searchMissionsV3({ ctx, query: 'groupneedle' });
    assert.equal(v3.version, 3);
    assert.equal(v3.results.length, 1);
    const result = v3.results[0]!;
    assert.equal(result.id, mission.mission.id);
    assert.equal(result.anchorOnly, true);
    const objectiveIds = result.matches
      .filter(match => match.entityType === 'objective')
      .map(match => match.id)
      .sort();
    assert.deepEqual(objectiveIds, [mission.objectives[0]!.id, mission.objectives[1]!.id].sort());
    assert.equal(
      result.matches.find(match => match.id === mission.objectives[0]!.id)?.displayId,
      mission.objectives[0]!.displayId
    );
    const delivery = result.matches.find(match => match.entityType === 'delivery');
    assert.ok(delivery);
    assert.equal(delivery.objectiveId, mission.objectives[0]!.id);
    assert.equal(result.matchCounts.objective, 2);
    assert.equal(result.matchCounts.delivery, 1);
    assert.equal(v3.entityCounts.objective, 2);
    assert.equal(v3.entityCounts.delivery, 1);
    assert.equal(v3.truncatedCandidates, false);
    await ctx.db.close();
  });

  it('keeps events corroborating-only and can filter to delivery matches', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Filter corpus parent',
      objectives: [{ objective: 'baseline work' }]
    });
    await recordEvent(ctx, mission.mission.id, projectId, 'Noted a deliveryfilterterm in logs');
    await recordDelivery(ctx, {
      missionId: mission.mission.id,
      objectiveId: mission.objectives[0]!.id,
      projectId,
      summary: 'Only deliveryfilterterm lives in this delivery'
    });

    const deliveries = await searchMissionsV3({
      ctx,
      query: 'deliveryfilterterm',
      entityTypes: ['delivery']
    });
    assert.equal(deliveries.results.length, 1);
    assert.equal(deliveries.results[0]?.anchorOnly, true);
    assert.deepEqual(
      deliveries.results[0]?.matches.map(match => match.entityType),
      ['delivery']
    );
    assert.ok(!deliveries.results[0]?.matches.some(match => match.entityType === 'objective'));
    assert.ok(deliveries.results[0]!.matchCounts.event >= 1);

    const objectivesOnly = await searchMissionsV3({
      ctx,
      query: 'deliveryfilterterm',
      entityTypes: ['objective']
    });
    assert.equal(objectivesOnly.results.length, 0);
    await ctx.db.close();
  });

  it('filters matches by objective state and caps children per result', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'State filter parent',
      objectives: [
        { objective: 'stateneedle first' },
        { objective: 'stateneedle second' },
        { objective: 'stateneedle third' },
        { objective: 'stateneedle fourth' }
      ]
    });
    await ctx.db.run(`UPDATE objectives SET state = 'executing' WHERE id = ?`, [
      mission.objectives[0]!.id
    ]);
    await ctx.db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [
      mission.objectives[1]!.id
    ]);

    const executing = await searchMissionsV3({
      ctx,
      query: 'stateneedle',
      objectiveStates: ['executing']
    });
    assert.equal(executing.results.length, 1);
    assert.deepEqual(
      executing.results[0]?.matches.map(match => match.id),
      [mission.objectives[0]!.id]
    );
    assert.equal(executing.results[0]?.matchCounts.objective, 1);

    const capped = await searchMissionsV3({
      ctx,
      query: 'stateneedle',
      matchesPerResult: 2
    });
    assert.equal(capped.results[0]?.matches.length, 2);
    assert.equal(capped.results[0]?.matchCounts.objective, 4);
    assert.equal(capped.appliedFilters.matchesPerResult, 2);
    await ctx.db.close();
  });

  it('short-circuits an objective display id to that single match', async () => {
    const { ctx, projectId } = await setup();
    const mission = await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Display id parent',
      objectives: [
        { objective: 'first display objective' },
        { objective: 'second display objective' }
      ]
    });
    const target = mission.objectives[1]!;
    const v3 = await searchMissionsV3({ ctx, query: target.displayId });
    assert.equal(v3.appliedFilters.mode, 'display_id');
    assert.equal(v3.results.length, 1);
    assert.equal(v3.results[0]?.id, mission.mission.id);
    assert.equal(v3.results[0]?.matches.length, 1);
    assert.equal(v3.results[0]?.matches[0]?.id, target.id);
    assert.equal(v3.results[0]?.matches[0]?.displayId, target.displayId);
    await ctx.db.close();
  });

  it('reports truncatedCandidates when the candidate fetch cap is hit', async () => {
    const { ctx, projectId } = await setup();
    await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Truncation alpha truncneedle',
      objectives: [{ objective: 'truncneedle body one' }]
    });
    await createMissionWithObjectives({
      ctx,
      projectId,
      title: 'Truncation beta truncneedle',
      objectives: [{ objective: 'truncneedle body two' }]
    });
    const v3 = await searchMissionsV3({
      ctx,
      query: 'truncneedle',
      candidateLimit: 1
    });
    assert.equal(v3.truncatedCandidates, true);
    assert.ok(v3.totalMatchedBeforeLimit >= 1);
    await ctx.db.close();
  });

  it('rejects event as an entityTypes value', async () => {
    assert.equal(parseSearchEntityTypes(['event']).ok, false);
    assert.throws(() => normalizeSearchV3Options({ entityTypes: ['event'] }), /event/);
    assert.equal(parseMatchesPerResult(11).ok, false);
    assert.equal(searchChildRelevance({ docScore: 2, missionScore: 4 }), 2 + 0.15 * 4);
  });

  it('splits mission-group quotas without redistributing unused slots', () => {
    const merged = mergeWorkspaceSearchV3({
      limit: 2,
      results: [
        {
          parsed: {
            raw: 'q',
            mode: 'any',
            displayId: null,
            objectiveDisplayKey: null,
            terms: ['q'],
            coverageFloor: 1
          },
          hits: [
            {
              id: 'm-a1',
              displayId: 'ws:1',
              title: 'A1',
              statusType: 'execute',
              statusId: 's',
              priority: 'normal',
              projectId: 'p',
              projectName: 'P',
              workspaceId: 'ws-a',
              workspaceName: 'A',
              workspaceSlug: 'a',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
              dueDatetime: null,
              objectiveCount: 1,
              relevance: 3,
              snippet: null,
              matchedTerms: ['q'],
              matchedIn: ['title'],
              anchorOnly: false,
              matches: [],
              matchCounts: { objective: 0, delivery: 0, event: 0 }
            },
            {
              id: 'm-a2',
              displayId: 'ws:2',
              title: 'A2',
              statusType: 'execute',
              statusId: 's',
              priority: 'normal',
              projectId: 'p',
              projectName: 'P',
              workspaceId: 'ws-a',
              workspaceName: 'A',
              workspaceSlug: 'a',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              dueDatetime: null,
              objectiveCount: 1,
              relevance: 2,
              snippet: null,
              matchedTerms: ['q'],
              matchedIn: ['title'],
              anchorOnly: false,
              matches: [],
              matchCounts: { objective: 0, delivery: 0, event: 0 }
            }
          ],
          totalMatchedBeforeLimit: 2,
          appliedFilters: {
            query: 'q',
            mode: 'any',
            projectIds: [],
            resourceKeys: [],
            statusTypes: [],
            dateField: null,
            from: null,
            to: null,
            coverageFloor: 1,
            entityTypes: ['mission', 'objective', 'delivery'],
            objectiveStates: [],
            matchesPerResult: 3
          },
          workspaceCounts: [{ workspaceId: 'ws-a', matched: 2, returned: 2 }],
          entityCounts: { mission: 2, objective: 0, delivery: 0, event: 0 },
          truncatedCandidates: false
        },
        {
          parsed: {
            raw: 'q',
            mode: 'any',
            displayId: null,
            objectiveDisplayKey: null,
            terms: ['q'],
            coverageFloor: 1
          },
          hits: [
            {
              id: 'm-b1',
              displayId: 'ws:3',
              title: 'B1',
              statusType: 'execute',
              statusId: 's',
              priority: 'normal',
              projectId: 'p',
              projectName: 'P',
              workspaceId: 'ws-b',
              workspaceName: 'B',
              workspaceSlug: 'b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-03T00:00:00.000Z',
              dueDatetime: null,
              objectiveCount: 1,
              relevance: 2.5,
              snippet: null,
              matchedTerms: ['q'],
              matchedIn: ['title'],
              anchorOnly: false,
              matches: [],
              matchCounts: { objective: 0, delivery: 0, event: 0 }
            }
          ],
          totalMatchedBeforeLimit: 1,
          appliedFilters: {
            query: 'q',
            mode: 'any',
            projectIds: [],
            resourceKeys: [],
            statusTypes: [],
            dateField: null,
            from: null,
            to: null,
            coverageFloor: 1,
            entityTypes: ['mission', 'objective', 'delivery'],
            objectiveStates: [],
            matchesPerResult: 3
          },
          workspaceCounts: [{ workspaceId: 'ws-b', matched: 1, returned: 1 }],
          entityCounts: { mission: 1, objective: 0, delivery: 0, event: 0 },
          truncatedCandidates: true
        }
      ]
    });
    assert.equal(merged.version, 3);
    assert.deepEqual(
      merged.results.map(result => result.id),
      ['m-a1', 'm-b1']
    );
    assert.equal(merged.totalMatchedBeforeLimit, 3);
    assert.equal(merged.truncatedCandidates, true);
    assert.equal(merged.entityCounts.mission, 3);
    assert.equal(merged.workspaceCounts.find(count => count.workspaceId === 'ws-a')?.returned, 1);
    assert.equal(merged.workspaceCounts.find(count => count.workspaceId === 'ws-b')?.returned, 1);
  });
});
