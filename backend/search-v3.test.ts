import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-search-v3-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const {
  createMission,
  createProject,
  searchMissionsAcrossWorkspacesV2,
  searchMissionsAcrossWorkspacesV3
} = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { requireDatabaseClient } = await import('./db.ts');

test('GET /api/search/v3 repository surface returns grouped objective matches', async () => {
  const project = await createProject({ name: 'V3 Search Board' });
  const mission = await createMission({
    projectId: project.id,
    title: 'Route grouped search',
    firstObjective: 'Implement routeneedle retrieval'
  });

  const v3 = await searchMissionsAcrossWorkspacesV3({ query: 'routeneedle' });
  assert.equal(v3.version, 3);
  const hit = v3.results.find(result => result.id === mission.id);
  assert.ok(hit);
  assert.equal(hit.matches.length, 1);
  assert.equal(hit.matches[0]?.entityType, 'objective');
  assert.equal(hit.matches[0]?.id, mission.objectives[0]?.id);
  assert.equal(v3.truncatedCandidates, false);

  const v2 = await searchMissionsAcrossWorkspacesV2({ query: 'routeneedle' });
  assert.equal(v2.version, 2);
  assert.ok(v2.results.some(result => result.id === mission.id));
  assert.equal('matches' in v2.results[0]!, false);
});

test('protocol search-missions --response-version 3 returns SearchResponseV3', async () => {
  const project = await createProject({ name: 'V3 Protocol Board' });
  await createMission({
    projectId: project.id,
    title: 'Protocol grouped search',
    firstObjective: 'Wire protocolneedle into the envelope'
  });

  const v3 = (await runProtocolSubcommand('search-missions', {
    flags: {
      '--query': 'protocolneedle',
      '--response-version': '3'
    }
  })) as { version: number; results: Array<{ matches?: unknown[] }>; truncatedCandidates: boolean };

  assert.equal(v3.version, 3);
  assert.ok(v3.results.some(result => (result.matches?.length ?? 0) > 0));
  assert.equal(typeof v3.truncatedCandidates, 'boolean');
});

test('canonical protocol search forwards v3 filters', async () => {
  const project = await createProject({ name: 'Canonical V3 Search Board' });
  await createMission({
    projectId: project.id,
    title: 'Canonical grouped search',
    firstObjective: 'Find canonicalprotocolneedle'
  });

  const v3 = (await runProtocolSubcommand('search', {
    flags: {
      '--query': 'canonicalprotocolneedle',
      '--response-version': '3',
      '--entity-types': 'objective',
      '--objective-states': 'draft',
      '--matches-per-result': '1'
    }
  })) as { version: number; appliedFilters: { matchesPerResult: number; entityTypes: string[] } };

  assert.equal(v3.version, 3);
  assert.equal(v3.appliedFilters.matchesPerResult, 1);
  assert.deepEqual(v3.appliedFilters.entityTypes, ['objective']);
});

test('v3 repository rejects event entityTypes', async () => {
  await assert.rejects(
    searchMissionsAcrossWorkspacesV3({ query: 'anything', entityTypes: ['event'] }),
    (error: unknown) => (error as { status?: number; message?: string }).status === 400
  );
});

test('v1/v2 repository search still ignores delivery-only documents', async () => {
  const project = await createProject({ name: 'V3 Delivery Exclusion' });
  const mission = await createMission({
    projectId: project.id,
    title: 'Delivery exclusion parent',
    firstObjective: 'baseline'
  });
  const client = requireDatabaseClient();
  const now = new Date().toISOString();
  await client.run(
    `INSERT INTO deliveries (
       id, workspace_id, project_id, mission_id, objective_id, summary,
       payload_json, delivered_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    [
      randomUUID(),
      mission.workspaceId,
      project.id,
      mission.id,
      mission.objectives[0]!.id,
      'Only route deliveryneedle appears here',
      now,
      now,
      now
    ]
  );

  const v2 = await searchMissionsAcrossWorkspacesV2({ query: 'deliveryneedle' });
  assert.equal(
    v2.results.some(result => result.id === mission.id),
    false
  );
  const v3 = await searchMissionsAcrossWorkspacesV3({ query: 'deliveryneedle' });
  assert.ok(v3.results.some(result => result.id === mission.id));
});
