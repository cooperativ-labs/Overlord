import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-search-v3-'));
const { bootstrapIntegrationTestDb, seedDelivery } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const {
  createMission,
  createProject,
  searchMissionsAcrossWorkspacesV2,
  searchMissionsAcrossWorkspacesV3
} = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

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

test('protocol search --response-version 3 returns SearchResponseV3', async () => {
  const project = await createProject({ name: 'V3 Protocol Board' });
  await createMission({
    projectId: project.id,
    title: 'Protocol grouped search',
    firstObjective: 'Wire protocolneedle into the envelope'
  });

  const v3 = (await runProtocolSubcommand('search', {
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
  const now = new Date().toISOString();
  seedDelivery(db, {
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: mission.objectives[0]!.id,
    summary: 'Only route deliveryneedle appears here',
    deliveredAt: now
  });

  const v2 = await searchMissionsAcrossWorkspacesV2({ query: 'deliveryneedle' });
  assert.equal(
    v2.results.some(result => result.id === mission.id),
    false
  );
  const v3 = await searchMissionsAcrossWorkspacesV3({ query: 'deliveryneedle' });
  assert.ok(v3.results.some(result => result.id === mission.id));
});

test('protocol search rejects an invalid --date-field with the REST 400 on every version', async () => {
  for (const version of ['2', '3']) {
    await assert.rejects(
      runProtocolSubcommand('search', {
        flags: { '--query': 'anything', '--date-field': 'startedAt', '--response-version': version }
      }),
      (error: unknown) => {
        const { status, message } = error as { status?: number; message?: string };
        assert.equal(status, 400, `version ${version}`);
        assert.equal(message, 'dateField must be createdAt, updatedAt, or dueDatetime');
        return true;
      }
    );
  }
});

test('protocol search keeps resolving human project references on v2/v3', async () => {
  const project = await createProject({ name: 'V3 Named Ref Board' });
  const mission = await createMission({
    projectId: project.id,
    title: 'Named reference search',
    firstObjective: 'Find namedrefneedle by project name'
  });

  for (const version of ['2', '3']) {
    const result = (await runProtocolSubcommand('search', {
      flags: {
        '--query': 'namedrefneedle',
        '--project-id': 'V3 Named Ref Board',
        '--response-version': version
      }
    })) as { results: Array<{ id: string }>; appliedFilters: { projectIds: string[] } };
    assert.ok(
      result.results.some(hit => hit.id === mission.id),
      `version ${version}`
    );
    assert.deepEqual(result.appliedFilters.projectIds, [project.id]);
  }
});

test('protocol search defaults to v3 and rejects the retired v1 response and alias', async () => {
  const project = await createProject({ name: 'Default Version Board' });
  await createMission({
    projectId: project.id,
    title: 'Default version search',
    firstObjective: 'Find defaultversionneedle'
  });
  const result = (await runProtocolSubcommand('search', {
    flags: { '--query': 'defaultversionneedle' }
  })) as { version: number };
  assert.equal(result.version, 3);

  for (const version of ['1', '4']) {
    await assert.rejects(
      runProtocolSubcommand('search', {
        flags: { '--query': 'defaultversionneedle', '--response-version': version }
      }),
      (error: unknown) => {
        const { status, code } = error as { status?: number; code?: string };
        assert.equal(status, 400, `version ${version}`);
        assert.equal(code, 'invalid_input');
        return true;
      }
    );
  }
  for (const retired of ['search-missions', 'list-organizations']) {
    await assert.rejects(
      runProtocolSubcommand(retired, { flags: {} }),
      (error: unknown) => (error as { status?: number }).status === 404
    );
  }
});
