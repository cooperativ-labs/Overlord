import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * The agent-facing mission summary through the protocol dispatch
 * (coo:1260.shmg): the attach baseline, a delivery that writes the summary and
 * closes items, and the agent-only narrative boundary (ADR 0076): stale prose
 * is accepted and withheld, then published once through the narrow commands;
 * nothing composes prose for a delivery without it.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-mission-summary-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const { createMission, createObjective, createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { getMissionSummary } = await import('./mission-summary.ts');
const { ServiceError } = await import('../packages/core/service/errors.ts');

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Baseline = {
  contentRevision: number;
  evidenceRevision: number;
  narrative: { state: string; outstandingDeliveryId: string | null };
  headline: string;
  summary: string;
  author: string | null;
  openItems: Array<{ id: string; kind: string; objective: string | null; text: string }>;
  truncated: boolean;
};
type AttachResult = { sessionKey: string; missionSummary?: Baseline; agentInstructions: string };
type DeliverResult = {
  deliveryId: string;
  missionSummary?: {
    contentRevision: number | null;
    narrativeWritten: boolean;
    closedItemIds: string[];
    warnings: Array<{ code: string; itemId?: string }>;
    publication?: { id: string; available: boolean; withheldReason: string | null };
    baseline?: Baseline;
  };
  instruction: string;
};

const report = (tag: string) => ({
  schemaVersion: 1,
  agentReport: {
    humanActions: [
      {
        action: `Run the ${tag} migration in production.`,
        reason: 'Missing table.',
        category: 'database'
      }
    ],
    knownRisks: [`The ${tag} export is slow.`],
    deferredWork: []
  }
});

async function missionFixture(name: string) {
  const project = await createProject({ name: `${name} ${Date.now()}`, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} first` });
  const second = await createObjective({
    missionId: mission.id,
    instructionText: `${name} second`,
    state: 'draft'
  });
  return {
    mission,
    first: mission.objectives[0]!,
    second: { id: second.id, displayId: `${mission.displayId}.${second.displayKey}` }
  };
}

function attach(objectiveDisplayId: string): Promise<AttachResult> {
  return runProtocolSubcommand('attach', {
    flags: { '--objective-id': objectiveDisplayId, '--model': 'claude-opus-5-5' }
  }) as Promise<AttachResult>;
}

function deliver(
  objectiveDisplayId: string,
  sessionKey: string,
  payload: Record<string, unknown>,
  extra: { flags?: Record<string, string | boolean>; fileInputs?: Record<string, string> } = {}
): Promise<DeliverResult> {
  return runProtocolSubcommand('deliver', {
    flags: {
      '--objective-id': objectiveDisplayId,
      '--session-key': sessionKey,
      '--summary': 'Delivered.',
      '--payload-json': JSON.stringify(payload),
      ...extra.flags
    },
    ...(extra.fileInputs ? { fileInputs: extra.fileInputs } : {})
  }) as Promise<DeliverResult>;
}

test('attach returns the baseline; load-context and connect do not', async () => {
  const { mission, first } = await missionFixture('Baseline');
  const attached = await attach(first.displayId);
  assert.deepEqual(attached.missionSummary, {
    contentRevision: 0,
    evidenceRevision: 0,
    narrative: {
      state: 'absent',
      evidenceRevision: 0,
      publishedEvidenceRevision: null,
      deliveryId: null,
      objectiveId: null,
      publishedAt: null,
      changedAt: null,
      outstandingDeliveryId: null
    },
    headline: '',
    summary: '',
    author: null,
    openItems: [],
    totalOpenItems: 0,
    otherMissionOpenItems: 0,
    truncated: false
  });
  assert.ok(attached.agentInstructions.includes('## Mission summary'));

  const context = (await runProtocolSubcommand('load-context', {
    flags: { '--mission-id': mission.displayId }
  })) as Record<string, unknown>;
  assert.equal('missionSummary' in context, false);
  const connected = (await runProtocolSubcommand('connect', {
    flags: { '--objective-id': first.displayId }
  })) as Record<string, unknown>;
  assert.equal('missionSummary' in connected, false);
});

test('attach --connection-method mcp returns MCP wording first; other values are rejected', async () => {
  const { first, second } = await missionFixture('Connection Method');
  const mcp = (await runProtocolSubcommand('attach', {
    flags: { '--objective-id': first.displayId, '--connection-method': 'mcp' }
  })) as AttachResult;
  assert.equal(Object.keys(mcp)[0], 'agentInstructions');
  assert.match(mcp.agentInstructions, /overlord_deliver_session/);
  assert.doesNotMatch(mcp.agentInstructions, /\bovld\b|--[a-z]/);

  const cli = await attach(second.displayId);
  assert.match(cli.agentInstructions, /`ovld protocol deliver`/);

  await assert.rejects(
    runProtocolSubcommand('attach', {
      flags: { '--objective-id': second.displayId, '--connection-method': 'chat' }
    }),
    (error: { status?: number; code?: string }) =>
      error.status === 400 && error.code === 'invalid_input'
  );
});

test('objective-changes and deliver return their own instruction by connection method (coo:1294.s9m6)', async () => {
  const { mission, first } = await missionFixture('Rare Case Routes');
  const attached = (await runProtocolSubcommand('attach', {
    flags: { '--objective-id': first.displayId, '--connection-method': 'mcp' }
  })) as AttachResult;
  const read = (connectionMethod?: string) =>
    runProtocolSubcommand('objective-changes', {
      flags: {
        '--objective-id': first.displayId,
        ...(connectionMethod ? { '--connection-method': connectionMethod } : {})
      }
    }) as Promise<{ capture: { warnings: string[] }; instruction?: string }>;

  const mcpRead = await read('mcp');
  assert.ok(mcpRead.capture.warnings.length > 0);
  assert.match(mcpRead.instruction ?? '', /`declaredPaths`/);
  assert.doesNotMatch(mcpRead.instruction ?? '', /\bovld\b|--[a-z]/);
  assert.match((await read())?.instruction ?? '', /--paths a,b/);
  await assert.rejects(read('chat'), (error: { status?: number }) => error.status === 400);

  const delivered = (await runProtocolSubcommand('deliver', {
    flags: {
      '--mission-id': mission.displayId,
      '--session-key': attached.sessionKey,
      '--summary': 'Done.'
    }
  })) as { instruction: string };
  assert.match(delivered.instruction, /start follow-up work from Overlord/);
});

test('a delivery with missionSummary shows agent prose at once and closes own items', async () => {
  const { mission, first, second } = await missionFixture('Agent Prose');
  const other = await missionFixture('Agent Prose Other');

  const a = await attach(first.displayId);
  await deliver(first.displayId, a.sessionKey, { deliveryReport: report('first') });
  const o = await attach(other.first.displayId);
  await deliver(other.first.displayId, o.sessionKey, { deliveryReport: report('other') });
  const foreign = await getMissionSummary(other.mission.id);
  const foreignRiskId = (await requireDatabaseClient().get<{ id: string }>(
    `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
    [other.mission.id]
  ))!.id;
  assert.equal(foreign.summary?.headline, '', 'nothing composes prose for a delivery without it');
  assert.equal(foreign.narrative?.state, 'absent');

  const b = await attach(second.displayId);
  const risk = b.missionSummary!.openItems.find(item => item.kind === 'risk')!;
  assert.equal(risk.objective, first.displayId);

  // The flag form, as the CLI sends `--mission-summary-file -`.
  const delivered = await deliver(
    second.displayId,
    b.sessionKey,
    {},
    {
      flags: { '--mission-summary-file': true },
      fileInputs: {
        '--mission-summary-file': JSON.stringify({
          baseContentRevision: b.missionSummary!.contentRevision,
          baseEvidenceRevision: b.missionSummary!.evidenceRevision,
          headline: 'The export is fast and tested.',
          summary: 'The export streams rows. It is tested and not deployed.',
          closeItems: [
            { id: risk.id, status: 'done', reason: 'Streaming removed the slow path.' },
            { id: foreignRiskId, status: 'dismissed', reason: 'Not this mission.' }
          ]
        })
      }
    }
  );
  assert.deepEqual(delivered.missionSummary?.closedItemIds, [risk.id]);
  assert.deepEqual(
    delivered.missionSummary?.warnings
      .filter(warning => warning.code === 'mission_summary_item_skipped')
      .map(warning => warning.itemId),
    [foreignRiskId]
  );

  const response = await getMissionSummary(mission.displayId);
  const summary = response.summary!;
  assert.equal(summary.status, 'composed', 'no pending state over agent text');
  assert.equal(summary.headline, 'The export is fast and tested.');
  assert.equal(summary.generatedBy, 'agent');
  assert.equal(summary.model, 'claude-opus-5-5');
  assert.deepEqual(summary.author, {
    kind: 'agent',
    objectiveId: second.id,
    deliveryId: delivered.deliveryId
  });
  assert.equal(summary.contentRevision, 1);
  assert.equal(
    summary.risks.some(item => item.id === risk.id),
    false,
    'the closed risk left the open list'
  );
  const closed = summary.closedItems.find(item => item.id === risk.id);
  assert.equal(closed?.status, 'done');
  assert.equal(closed?.reason, 'Streaming removed the slow path.');
  assert.equal(closed?.resolvedBy?.kind, 'agent');

  const foreignItem = await requireDatabaseClient().get<{ status: string }>(
    `SELECT status FROM mission_items WHERE id = ?`,
    [foreignRiskId]
  );
  assert.equal(foreignItem?.status, 'open', "another mission's item is never closed");
  assert.equal(response.narrative?.state, 'current');
  assert.equal(response.narrativeWatermark, response.narrative?.changedAt);
  assert.ok(response.narrativeWatermark);
});

test('stale parallel prose is accepted and withheld, then published once through the narrow commands', async () => {
  const { mission, first, second } = await missionFixture('Parallel');
  const a = await attach(first.displayId);
  const b = await attach(second.displayId);

  await deliver(first.displayId, a.sessionKey, {
    deliveryReport: report('a'),
    missionSummary: {
      baseContentRevision: 0,
      baseEvidenceRevision: 0,
      headline: 'A landed.',
      summary: 'A is tested.'
    }
  });

  const delivered = await deliver(second.displayId, b.sessionKey, {
    deliveryReport: report('b'),
    missionSummary: {
      baseContentRevision: 0,
      baseEvidenceRevision: 0,
      headline: 'B landed.',
      summary: 'B is tested.'
    }
  });
  assert.equal(delivered.missionSummary?.narrativeWritten, false);
  assert.equal(delivered.missionSummary?.publication?.withheldReason, 'stale_content');
  assert.equal(delivered.missionSummary?.baseline?.headline, 'A landed.');
  assert.match(delivered.instruction, /ovld protocol publish-delivery-summary/);
  const deliveries = await requireDatabaseClient().all<{ objective_id: string }>(
    `SELECT objective_id FROM deliveries WHERE mission_id = ?`,
    [mission.id]
  );
  assert.equal(deliveries.length, 2, 'both deliveries were accepted');
  const outdated = await getMissionSummary(mission.id);
  assert.equal(outdated.narrative?.state, 'outdated');
  assert.equal(outdated.narrative?.outstandingDeliveryId, delivered.deliveryId);

  for (const command of ['delivery-summary-context', 'publish-delivery-summary']) {
    await assert.rejects(
      runProtocolSubcommand(command, {
        flags: {
          '--mission-id': mission.displayId,
          '--delivery-id': delivered.deliveryId,
          '--session-key': b.sessionKey,
          '--connection-method': 'bogus'
        }
      }),
      (error: unknown) => error instanceof Error && /--connection-method/.test(error.message)
    );
  }

  const context = (await runProtocolSubcommand('delivery-summary-context', {
    flags: {
      '--mission-id': mission.displayId,
      '--delivery-id': delivered.deliveryId,
      '--session-key': b.sessionKey
    }
  })) as { publication: { available: boolean }; baseline: Baseline };
  assert.equal(context.publication.available, true);

  const published = (await runProtocolSubcommand('publish-delivery-summary', {
    flags: {
      '--mission-id': mission.displayId,
      '--delivery-id': delivered.deliveryId,
      '--session-key': b.sessionKey,
      '--operation-id': 'publish-parallel-b1',
      '--payload-json': JSON.stringify({
        baseContentRevision: context.baseline.contentRevision,
        baseEvidenceRevision: context.baseline.evidenceRevision,
        headline: 'A and B landed.',
        summary: 'Both are tested and not deployed.'
      })
    }
  })) as { contentRevision: number; publication: { state: string } };
  assert.equal(published.contentRevision, 2);
  assert.equal(published.publication.state, 'published');
  const current = await getMissionSummary(mission.id);
  assert.equal(current.summary?.headline, 'A and B landed.');
  assert.equal(current.narrative?.state, 'current');
  assert.equal(current.narrative?.outstandingDeliveryId, null);
});

test('malformed missionSummary is a 400 before any write', async () => {
  const { mission, first } = await missionFixture('Malformed');
  const a = await attach(first.displayId);
  await assert.rejects(
    deliver(first.displayId, a.sessionKey, {
      missionSummary: { baseContentRevision: 0, closeItems: [{ id: 'x', status: 'done' }] }
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.status === 400 && error.code === 'invalid_input'
  );
  const count = await requireDatabaseClient().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`,
    [mission.id]
  );
  assert.equal(Number(count?.n), 0);
});

test('a delivery without missionSummary succeeds, keeps the agent prose and marks it outdated', async () => {
  const { mission, first, second } = await missionFixture('Fallback');
  const a = await attach(first.displayId);
  await deliver(first.displayId, a.sessionKey, {
    missionSummary: {
      baseContentRevision: 0,
      baseEvidenceRevision: 0,
      headline: 'A landed.',
      summary: 'A is tested.'
    }
  });
  const b = await attach(second.displayId);
  // An older client: no missionSummary field at all.
  const delivered = await deliver(second.displayId, b.sessionKey, { deliveryReport: report('b') });
  assert.equal(delivered.missionSummary?.narrativeWritten, false);
  assert.equal(delivered.missionSummary?.publication?.available, true);

  const response = await getMissionSummary(mission.id);
  const summary = response.summary!;
  assert.equal(summary.generatedBy, 'agent');
  assert.equal(summary.headline, 'A landed.');
  assert.equal(summary.contentRevision, 1);
  assert.equal(response.narrative?.state, 'outdated');
  const jobs = await requireDatabaseClient().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM worker_jobs WHERE type = 'overlord.mission.summary.compose.v1'`
  );
  assert.equal(Number(jobs?.n), 0, 'no automatic narrative job exists');
});

test('record-work accepts missionSummary without a base', async () => {
  const project = await createProject({
    name: `Record Work Summary ${Date.now()}`,
    color: '#123456'
  });
  const result = (await runProtocolSubcommand('record-work', {
    flags: {
      '--project-id': project.id,
      '--payload-json': JSON.stringify({
        objective: 'Fixed the export.',
        summary: 'Fixed the export.',
        missionSummary: { headline: 'The export works.', summary: 'Fixed and tested.' }
      })
    }
  })) as {
    mission: { id: string };
    deliveryId: string;
    missionSummary?: { narrativeWritten: boolean };
  };
  assert.equal(result.missionSummary?.narrativeWritten, true);
  const summary = (await getMissionSummary(result.mission.id)).summary!;
  assert.equal(summary.author.kind, 'agent');
  assert.equal(summary.headline, 'The export works.');
  const payload = await requireDatabaseClient().get<{ payload_json: string }>(
    `SELECT payload_json FROM deliveries WHERE id = ?`,
    [result.deliveryId]
  );
  assert.equal(JSON.parse(payload!.payload_json).missionSummary, undefined);
});

test('item commands read full detail and close with file input without delivering', async () => {
  const { first, second } = await missionFixture('Standalone items');
  const a = await attach(first.displayId);
  await deliver(first.displayId, a.sessionKey, { deliveryReport: report('standalone') });
  const b = await attach(second.displayId);
  const flags = { '--objective-id': second.displayId, '--session-key': b.sessionKey };
  const page = (await runProtocolSubcommand('mission-items', {
    flags: { ...flags, '--limit': '1', '--offset': '0' }
  })) as any;
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.nextOffset, 1);
  const closed = (await runProtocolSubcommand('close-items', {
    flags: { ...flags, '--close-items-file': '-' },
    fileInputs: {
      '--close-items-file': JSON.stringify([
        { id: page.items[0].id, status: 'dismissed', reason: 'No longer needed.' }
      ])
    }
  })) as any;
  assert.deepEqual(closed.closedItemIds, [page.items[0].id]);
  assert.equal(closed.narrativeWritten, false);
  const next = (await runProtocolSubcommand('mission-items', { flags })) as any;
  assert.equal(next.total, 1);
  await assert.rejects(
    runProtocolSubcommand('mission-items', { flags: { ...flags, '--offset': 'invalid' } })
  );
  await assert.rejects(
    runProtocolSubcommand('close-items', { flags: { ...flags, '--close-items-json': '[{}]' } })
  );
  const db = requireDatabaseClient();
  const session = await db.get<any>('SELECT ended_at FROM agent_sessions WHERE objective_id = ?', [
    second.id
  ]);
  assert.equal(session.ended_at, null);
});

test('cross-mission protocol checks real token grants and exposes live resolver and delivery projections', async () => {
  const { createUserToken, listMissionDeliveries } = await import('./repository.ts');
  const { setActiveTokenAuth, getActorWorkspaceUserId } = await import('./db.ts');
  const workspaceUserId = getActorWorkspaceUserId();
  const project = await createProject({ name: 'Cross-mission protocol grants' });
  const target = await createMission({
    projectId: project.id,
    firstObjective: 'Report target risk'
  });
  const targetSession = await attach(target.objectives[0]!.displayId);
  await deliver(target.objectives[0]!.displayId, targetSession.sessionKey, {
    deliveryReport: report('foreign')
  });
  const source = await createMission({
    projectId: project.id,
    firstObjective: 'Resolve foreign risk'
  });
  const attached = await attach(source.objectives[0]!.displayId);
  const ownId = (
    await requireDatabaseClient().all<{ id: string }>(
      'SELECT id FROM mission_items WHERE mission_id = ? ORDER BY id',
      [target.id]
    )
  )[0]!.id;
  const { token: lifecycle } = await createUserToken({
    label: 'Lifecycle close',
    scope: 'mission_lifecycle'
  });
  const { token: full } = await createUserToken({ label: 'Full close', scope: 'full' });
  const { token: automation } = await createUserToken({
    label: 'Automation denied',
    scope: 'project_automation',
    projectIds: [project.id]
  });
  const flags = {
    '--mission-id': source.id,
    '--session-key': attached.sessionKey,
    '--close-items-json': JSON.stringify([
      { id: ownId, status: 'done', reason: 'Verified project fix.' }
    ])
  };
  try {
    setActiveTokenAuth({
      workspaceUserId,
      tokenId: full.id,
      scopeGrants: ['event:create', 'mission:read']
    });
    const skipped = (await runProtocolSubcommand('close-items', { flags })) as {
      closedItemIds: string[];
      warnings: { message: string }[];
    };
    assert.deepEqual(skipped.closedItemIds, []);
    assert.match(skipped.warnings[0]!.message, /mission:update/);
    setActiveTokenAuth({
      workspaceUserId,
      tokenId: automation.id,
      scopeGrants: automation.scopeGrants,
      projectIds: [project.id]
    });
    await assert.rejects(runProtocolSubcommand('close-items', { flags }));
    setActiveTokenAuth({
      workspaceUserId,
      tokenId: lifecycle.id,
      scopeGrants: lifecycle.scopeGrants
    });
    const closed = (await runProtocolSubcommand('close-items', { flags })) as {
      closedItemIds: string[];
    };
    assert.deepEqual(closed.closedItemIds, [ownId]);
    setActiveTokenAuth({ workspaceUserId, tokenId: full.id, scopeGrants: full.scopeGrants });
    const accepted = await deliver(source.objectives[0]!.displayId, attached.sessionKey, {});
    const deliveries = await listMissionDeliveries(source.id);
    assert.equal(
      deliveries.items.find(d => d.id === accepted.deliveryId)!.closedElsewhere![0]!.itemId,
      ownId
    );
    const targetSummary = await getMissionSummary(target.id);
    const resolver = targetSummary.summary!.closedItems!.find(i => i.id === ownId)!.resolvedBy!;
    assert.equal(resolver.missionDisplayId, source.displayId);
    assert.equal(resolver.objectiveDisplayId, source.objectives[0]!.displayId);
    assert.equal(resolver.crossMission, true);
    assert.equal(resolver.deliveryId, accepted.deliveryId);
    const item = targetSummary.summary!.closedItems!.find(i => i.id === ownId)!;
    assert.equal(targetSummary.itemsWatermark, item.resolvedAt);
    assert.equal(targetSummary.itemsTruncated, false);
  } finally {
    setActiveTokenAuth({ workspaceUserId, tokenId: null, scopeGrants: null });
  }
});

test('project-items dispatch requires read authority and excludes automation tokens', async () => {
  const project = await createProject({ name: 'Discovery dispatch' });
  const target = await createMission({
    projectId: project.id,
    title: 'Discovery target',
    firstObjective: 'Target'
  });
  const attached = await attach(target.objectives[0]!.displayId);
  const flags = {
    '--mission-id': target.id,
    '--session-key': attached.sessionKey,
    '--kind': 'risk,suggestion',
    '--path': 'backend/service/retry.ts'
  };
  const page = (await runProtocolSubcommand('project-items', { flags })) as any;
  assert.equal(page.responseShapeVersion, 1);
  assert.equal(page.limit, 20);
  assert.deepEqual(page.items, []);
  await assert.rejects(
    runProtocolSubcommand('project-items', { flags: { ...flags, '--limit': '101' } })
  );
  const { createUserToken } = await import('./repository.ts');
  const { setActiveTokenAuth } = await import('./db.ts');
  const { workspaceUserId } = await requireDatabaseClient().get<any>(
    'SELECT id AS workspaceUserId FROM workspace_users LIMIT 1'
  );
  const { token } = await createUserToken({
    label: 'Discovery denied',
    scope: 'project_automation',
    projectIds: [project.id]
  });
  try {
    setActiveTokenAuth({
      workspaceUserId,
      tokenId: token.id,
      scopeGrants: ['mission:read'],
      projectIds: [project.id]
    });
    await assert.rejects(runProtocolSubcommand('project-items', { flags }), /Not found/);
  } finally {
    setActiveTokenAuth({ workspaceUserId, tokenId: null, scopeGrants: null });
  }
});
