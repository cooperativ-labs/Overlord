import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  parseTranscriptRead,
  readObjectiveTranscript
} from '../packages/core/service/objective-transcript.ts';

import {
  conformanceAdapters,
  createConformanceDatabase,
  seedAuthenticatedOperatorClient
} from './test-helpers.ts';

process.env.OVERLORD_SQLITE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), 'ovld-transcript-test-')),
  'bootstrap.sqlite'
);
const dbModule = await import('./db.ts');
const { createProject, createMission, createObjective, createInboxItem, updateMission } =
  await import('./repository.ts');
const { listObjectiveTranscript } = await import('./objective-transcript.ts');
process.env.GEMINI_API_KEY = '';

for (const adapter of conformanceAdapters())
  describe(`objective transcript (${adapter})`, () => {
    let handle: Awaited<ReturnType<typeof createConformanceDatabase>>;
    let projectId: string;
    let otherProjectId: string;
    let missionId: string;
    let objectiveIds: string[];
    const at = '2026-10-01T00:00:00.000Z';
    before(async () => {
      handle = await createConformanceDatabase(adapter, 'ovld_transcript');
      await dbModule.bindDatabaseClient(handle.db);
      await seedAuthenticatedOperatorClient({ client: handle.db });
      await dbModule.setActiveWorkspace('local-workspace');
      dbModule.setActiveWorkspaceUser('operator-workspace-user');
      projectId = (await createProject({ name: 'Transcript', color: '#123456' })).id;
      otherProjectId = (await createProject({ name: 'Other project' })).id;
      const mission = await createMission({ projectId, title: 'Mission', firstObjective: 'First' });
      missionId = mission.id;
      objectiveIds = [mission.objectives[0]!.id];
      for (let i = 0; i < 6; i++)
        objectiveIds.push(
          (await createObjective({ missionId, instructionText: `Objective ${i}` })).id
        );
      await handle.db.run(
        'UPDATE objectives SET created_at = ?, updated_at = ? WHERE mission_id = ?',
        [at, at, missionId]
      );
      // Let asynchronous local title fallbacks settle outside measured/tested reads.
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    after(async () => {
      await handle?.cleanup();
    });

    it('walks every equal-timestamp boundary exactly once, independent of deletion of a cursor row', async () => {
      const seen: string[] = [];
      let page = await listObjectiveTranscript({ limit: '2' });
      assert.equal(page.items[0]!.projectColor, '#123456');
      assert.equal(page.items.length, 2);
      const firstCursor = page.nextBefore!;
      while (true) {
        seen.push(...page.items.map(row => row.id));
        if (!page.nextBefore) break;
        page = await listObjectiveTranscript({ limit: '2', before: page.nextBefore });
      }
      assert.deepEqual(seen, [...objectiveIds].sort().reverse());
      const cursorId = seen[1]!;
      await handle.db.run('UPDATE objectives SET deleted_at = ? WHERE id = ?', [at, cursorId]);
      const afterDelete = await listObjectiveTranscript({ limit: '2', before: firstCursor });
      assert.deepEqual(
        afterDelete.items.map(row => row.id),
        seen.slice(2, 4)
      );
      await handle.db.run('UPDATE objectives SET deleted_at = NULL WHERE id = ?', [cursorId]);
    });

    it('drains more than one page of new creates in ascending order without missing the middle', async () => {
      const initial = await listObjectiveTranscript({ limit: '1' });
      const newIds: string[] = [];
      for (let i = 0; i < 5; i++)
        newIds.push((await createObjective({ missionId, instructionText: 'New' })).id);
      const expected = await handle.db.all<{ id: string }>(
        'SELECT id FROM objectives WHERE id IN (?,?,?,?,?) ORDER BY created_at ASC, id ASC',
        newIds
      );
      let key = initial.newestCursor!;
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        const page = await listObjectiveTranscript({ after: key, limit: '2' });
        seen.push(...page.items.map(item => item.id));
        assert.equal(page.hasMore, i < 2);
        key = page.nextAfter!;
      }
      assert.deepEqual(
        seen,
        expected.map(row => row.id)
      );
      const empty = await listObjectiveTranscript({ after: key });
      assert.deepEqual(empty.items, []);
      assert.equal(empty.nextAfter, key);
    });

    it('revalidates late edits, provenance, reassignment and deletions without archive reads', async () => {
      const id = objectiveIds[0]!;
      const longText = '😀'.repeat(25000);
      await handle.db.run(
        `UPDATE objectives SET instruction_text = ?, assigned_agent = 'codex',
      created_by_kind = 'agent', created_by_agent = 'claude', revision = revision + 1 WHERE id = ?`,
        [longText, id]
      );
      const page = await listObjectiveTranscript({ ids: id });
      assert.equal(page.items[0]!.instructionText, longText);
      assert.equal(page.items[0]!.createdByAgent, 'claude');
      assert.equal(page.items[0]!.assignedAgent, 'codex');
      assert.equal(page.hasMore, false);
      assert.equal(page.nextBefore, null);
      await handle.db.run('UPDATE missions SET title = ?, revision = revision + 1 WHERE id = ?', [
        'Renamed',
        missionId
      ]);
      assert.equal((await listObjectiveTranscript({ ids: id })).items[0]!.missionTitle, 'Renamed');
      await handle.db.run('UPDATE objectives SET deleted_at = ? WHERE id = ?', [at, id]);
      assert.deepEqual((await listObjectiveTranscript({ ids: id })).items, []);
      await handle.db.run('UPDATE objectives SET deleted_at = NULL WHERE id = ?', [id]);
    });

    it('requires both permissions and scopes selection before paging or ID revalidation', async () => {
      await dbModule.withRequestContextAsync(async () => {
        dbModule.setActiveTokenAuth({
          workspaceUserId: 'operator-workspace-user',
          tokenId: 'test',
          scopeGrants: ['mission:read'],
          projectIds: [projectId]
        });
        assert.deepEqual((await listObjectiveTranscript()).items, []);
        dbModule.setActiveTokenAuth({
          workspaceUserId: 'operator-workspace-user',
          tokenId: 'test',
          scopeGrants: ['mission:read', 'objective:read'],
          projectIds: [otherProjectId]
        });
        assert.deepEqual((await listObjectiveTranscript({ limit: '1' })).items, []);
        assert.deepEqual((await listObjectiveTranscript({ ids: objectiveIds[0] })).items, []);
        dbModule.setActiveTokenAuth({
          workspaceUserId: 'operator-workspace-user',
          tokenId: 'test',
          scopeGrants: ['mission:read', 'objective:read'],
          projectIds: [projectId]
        });
        assert.equal((await listObjectiveTranscript({ limit: '1' })).items.length, 1);
        dbModule.setAuthorizedWorkspacesContext({
          organizationId: 'test-organization',
          workspaces: []
        });
        assert.deepEqual((await listObjectiveTranscript()).items, []);
      });
    });

    it('reads a second accessible workspace and drops it as soon as membership is revoked', async () => {
      await seedAuthenticatedOperatorClient({
        client: handle.db,
        workspaceId: 'second-workspace',
        workspaceUserId: 'second-operator'
      });
      const project = await createProject({ name: 'Secondary', workspaceId: 'second-workspace' });
      const mission = await createMission({
        projectId: project.id,
        firstObjective: 'Secondary history'
      });
      const id = mission.objectives[0]!.id;
      assert.equal(
        (await listObjectiveTranscript({ ids: id })).items[0]!.workspaceId,
        'second-workspace'
      );
      await handle.db.run(
        "UPDATE workspace_users SET status = 'disabled' WHERE id = 'second-operator'"
      );
      assert.deepEqual((await listObjectiveTranscript({ ids: id })).items, []);
      await handle.db.run(
        "UPDATE workspace_users SET status = 'active' WHERE id = 'second-operator'"
      );
      assert.equal((await listObjectiveTranscript({ ids: id })).items.length, 1);
      await handle.db.run('UPDATE missions SET deleted_at = ? WHERE id = ?', [at, mission.id]);
      await dbModule.setActiveWorkspace('local-workspace');
      dbModule.setActiveWorkspaceUser('operator-workspace-user');
    });

    it('revalidates moved objectives and same-time late creates using IDs from the change stream', async () => {
      const id = objectiveIds[0]!;
      await updateMission(missionId, { projectId: otherProjectId });
      assert.equal(
        (await listObjectiveTranscript({ ids: id })).items[0]!.projectId,
        otherProjectId
      );
      assert.equal(
        (await listObjectiveTranscript({ ids: id })).items[0]!.projectName,
        'Other project'
      );
      await updateMission(missionId, { projectId });
      const late = await createObjective({
        missionId,
        instructionText: 'Late create with old timestamp'
      });
      await handle.db.run('UPDATE objectives SET created_at = ? WHERE id = ?', [at, late.id]);
      assert.equal(
        (await listObjectiveTranscript({ ids: late.id })).items[0]!.instructionText,
        'Late create with old timestamp'
      );
    });

    it('does not expose another organization or a private capture belonging to another profile', async () => {
      await seedAuthenticatedOperatorClient({
        client: handle.db,
        organizationId: 'foreign-org',
        workspaceId: 'foreign-workspace',
        workspaceUserId: 'foreign-member',
        profileId: 'foreign-profile'
      });
      await dbModule.setActiveWorkspace('foreign-workspace');
      dbModule.setActiveWorkspaceUser('foreign-member');
      dbModule.setActiveProfileId('foreign-profile');
      const project = await createProject({ name: 'Foreign project' });
      const mission = await createMission({
        projectId: project.id,
        firstObjective: 'Foreign instruction'
      });
      const capture = await createInboxItem({
        title: 'Foreign private',
        objectives: ['Foreign capture']
      });
      await dbModule.setActiveWorkspace('local-workspace');
      dbModule.setActiveWorkspaceUser('operator-workspace-user');
      dbModule.setActiveProfileId('operator-user');
      const query = { ids: `${mission.objectives[0]!.id},${capture.id}` };
      assert.deepEqual((await listObjectiveTranscript(query)).items, []);
      await seedAuthenticatedOperatorClient({
        client: handle.db,
        organizationId: 'foreign-org',
        workspaceId: 'foreign-workspace',
        workspaceUserId: 'operator-foreign-member'
      });
      assert.deepEqual((await listObjectiveTranscript(query)).items, []);
    });

    it('never includes private Inbox captures, archived projects or soft-deleted ancestors', async () => {
      const item = await createInboxItem({ title: 'Private', objectives: ['Private capture'] });
      assert.deepEqual((await listObjectiveTranscript({ ids: item.id })).items, []);
      await handle.db.run("UPDATE projects SET status = 'archived' WHERE id = ?", [projectId]);
      assert.deepEqual((await listObjectiveTranscript()).items, []);
      await handle.db.run("UPDATE projects SET status = 'active' WHERE id = ?", [projectId]);
      for (const [table, id] of [
        ['missions', missionId],
        ['projects', projectId],
        ['workspaces', 'local-workspace']
      ]) {
        await handle.db.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [at, id]);
        assert.deepEqual((await listObjectiveTranscript({ ids: objectiveIds[0] })).items, []);
        await handle.db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, [id]);
      }
    });

    it('uses one bounded data query with a one-row lookahead, regardless of project count', async () => {
      const statements: { sql: string; params: readonly unknown[] }[] = [];
      const client = {
        ...handle.db,
        all: async <T>(sql: string, params: readonly unknown[] = []) => {
          statements.push({ sql, params });
          return handle.db.all<T>(sql, params);
        }
      };
      const page = await readObjectiveTranscript({
        db: client,
        workspaceIds: ['local-workspace'],
        allowedProjectIds: null,
        read: parseTranscriptRead({ limit: '3' })
      });
      assert.equal(page.items.length, 3);
      assert.equal(statements.length, 1);
      assert.match(statements[0]!.sql, /LIMIT \?/);
      assert.equal(statements[0]!.params.at(-1), 4);
      if (adapter === 'sqlite') {
        const plan = await handle.db.all<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${statements[0]!.sql}`,
          statements[0]!.params
        );
        assert.ok(
          plan.some(row => row.detail.includes('idx_objectives_transcript_created')),
          JSON.stringify(plan)
        );
        // The outer merge can sort the bounded candidates; each archive walk uses the index.
      }
      assert.ok(
        await handle.db.get(
          adapter === 'sqlite'
            ? "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_objectives_transcript_created'"
            : "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_objectives_transcript_created'"
        )
      );
    });
  });

it('rejects malformed, oversized, ambiguous and noncanonical cursor/input values', () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const query of [
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: ['2'] },
    { before: '' },
    { before: 'x'.repeat(257) },
    { before: 'not-base64' },
    { before: encode([2, '2026-01-01T00:00:00.000Z', randomUUID()]) },
    { before: encode([1, '2026-02-30T00:00:00.000Z', randomUUID()]) },
    { ids: '' },
    { ids: 'not-an-id' },
    { ids: Array.from({ length: 101 }, randomUUID).join(',') },
    { ids: randomUUID(), limit: '1' },
    { before: 'x', after: 'x' },
    { q: 'secret' }
  ])
    assert.throws(() => parseTranscriptRead(query), { status: 400 });
});
