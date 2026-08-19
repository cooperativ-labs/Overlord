import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-status-discovery-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createMission, createProject, listProjectStatuses, searchMissions, updateMission } =
  await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

type ProtocolStatus = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  type: string;
  position: number;
  isDefault: boolean;
  isTerminal: boolean;
};

/**
 * Board columns vary per project (coo:752), so `protocol statuses` — which
 * backs both `ovld statuses list` and the `overlord_list_project_statuses` MCP
 * tool — is the only discovery path an agent has for a specific board.
 */
test('protocol statuses returns one project ordered board columns', async () => {
  const project = await createProject({ name: 'Discovery Board' });
  const expected = await listProjectStatuses(project.id);

  const statuses = (await runProtocolSubcommand('statuses', {
    flags: { '--project-id': project.id }
  })) as ProtocolStatus[];

  assert.deepEqual(
    statuses.map(status => status.id),
    expected.map(status => status.id)
  );
  assert.deepEqual(
    statuses.map(status => status.position),
    [...statuses.map(status => status.position)].sort((left, right) => left - right)
  );
  for (const status of statuses) assert.equal(status.projectId, project.id);
  assert.equal(statuses.filter(status => status.isDefault).length, 1);
  const execute = statuses.find(status => status.type === 'execute');
  assert.ok(execute, 'every project keeps exactly one execute column');
  assert.equal(typeof execute.key, 'string');
});

test('protocol statuses resolves a project by slug and reads only that project set', async () => {
  const alpha = await createProject({ name: 'Discovery Alpha' });
  const beta = await createProject({ name: 'Discovery Beta' });

  const bySlug = (await runProtocolSubcommand('statuses', {
    flags: { '--project-id': alpha.slug }
  })) as ProtocolStatus[];
  const betaStatuses = (await runProtocolSubcommand('statuses', {
    flags: { '--project-id': beta.id }
  })) as ProtocolStatus[];

  for (const status of bySlug) assert.equal(status.projectId, alpha.id);
  for (const status of betaStatuses) assert.equal(status.projectId, beta.id);
  assert.equal(
    bySlug.filter(status => betaStatuses.some(other => other.id === status.id)).length,
    0,
    'two projects never share a status row'
  );
});

test('protocol statuses requires a project id', async () => {
  await assert.rejects(
    runProtocolSubcommand('statuses', { flags: {} }),
    (error: unknown) => (error as { status?: number }).status === 400
  );
});

/**
 * `ovld missions list --status <csv>` was documented for a long time but never
 * forwarded; it now reaches this endpoint as a `statusTypes` CSV. It filters
 * status TYPES, which are invariant across projects — never the project-defined
 * column names, which are not.
 */
test('mission search filters on status types across projects with diverged column names', async () => {
  const alpha = await createProject({ name: 'Filter Alpha' });
  const beta = await createProject({ name: 'Filter Beta' });

  const alphaExecute = (await listProjectStatuses(alpha.id)).find(
    status => status.type === 'execute'
  )!;
  const betaExecute = (await listProjectStatuses(beta.id)).find(
    status => status.type === 'execute'
  )!;
  // Deliberately diverge the two boards' names for the same lifecycle type.
  const { updateProjectStatus } = await import('./repository.ts');
  await updateProjectStatus(alpha.id, alphaExecute.id, { name: 'Cooking' });
  await updateProjectStatus(beta.id, betaExecute.id, { name: 'Doing' });

  const running = await createMission({ projectId: alpha.id, firstObjective: 'Alpha running' });
  const betaRunning = await createMission({ projectId: beta.id, firstObjective: 'Beta running' });
  const idle = await createMission({ projectId: alpha.id, firstObjective: 'Alpha idle' });
  await updateMission(running.id, { statusId: alphaExecute.id });
  await updateMission(betaRunning.id, { statusId: betaExecute.id });

  const executing = await searchMissions({ statusTypes: ['execute'] });
  const executingIds = executing.map(mission => mission.id);
  assert.ok(executingIds.includes(running.id));
  assert.ok(executingIds.includes(betaRunning.id));
  assert.ok(!executingIds.includes(idle.id));

  // Scoping to one project narrows the same type filter to that board.
  const alphaOnly = await searchMissions({ projectId: alpha.id, statusTypes: ['execute'] });
  assert.deepEqual(
    alphaOnly.map(mission => mission.id),
    [running.id]
  );

  // A project-defined status NAME is not a type and matches nothing.
  assert.deepEqual(await searchMissions({ statusTypes: ['Cooking'] }), []);

  // An empty/absent filter is not a filter.
  const unfiltered = await searchMissions({ projectId: alpha.id, statusTypes: [] });
  assert.ok(unfiltered.map(mission => mission.id).includes(idle.id));
});

test('mission search combines a full-text query with a status type filter', async () => {
  const project = await createProject({ name: 'Filter Query' });
  const execute = (await listProjectStatuses(project.id)).find(
    status => status.type === 'execute'
  )!;

  const match = await createMission({
    projectId: project.id,
    firstObjective: 'Zylophonics ingestion rewrite'
  });
  const other = await createMission({
    projectId: project.id,
    firstObjective: 'Zylophonics ingestion audit'
  });
  await updateMission(match.id, { statusId: execute.id });

  const found = await searchMissions({ query: 'zylophonics', statusTypes: ['execute'] });
  const foundIds = found.map(mission => mission.id);
  assert.ok(foundIds.includes(match.id));
  assert.ok(!foundIds.includes(other.id));

  // The same query without the filter still returns both, so the filter — and
  // not a broken placeholder binding — is what narrowed the result above.
  const all = (await searchMissions({ query: 'zylophonics' })).map(mission => mission.id);
  assert.ok(all.includes(match.id) && all.includes(other.id));
});

/**
 * Regression for a placeholder-order bug found while adding the status filter:
 * the project predicate used to sit in the JOIN while its parameter was pushed
 * after the full-text match parameter, so a project-scoped keyword search bound
 * the match text to `project_id` (and vice versa) and returned nothing.
 */
test('mission search scoped to a project still honors the keyword query', async () => {
  const project = await createProject({ name: 'Filter Scoped' });
  const other = await createProject({ name: 'Filter Scoped Other' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Quarkbarrel telemetry backfill'
  });
  await createMission({ projectId: other.id, firstObjective: 'Quarkbarrel telemetry sibling' });

  const found = await searchMissions({ query: 'quarkbarrel', projectId: project.id });
  assert.deepEqual(
    found.map(row => row.id),
    [mission.id]
  );
});
