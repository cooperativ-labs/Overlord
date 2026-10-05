import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives } from '../missions.js';

import { ChatAccess } from './access.js';
import { proposalFixture, proposalOwner as owner } from './proposal-test-fixture.js';

for (const adapter of ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])])
  describe(`proposal transactions [${adapter}]`, () => {
    it('outer rollback includes nested mission creations in different workspaces, sequence, changes and receipt', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const t = await c.create(owner);
        const now = new Date().toISOString();
        await db.run(
          "INSERT INTO chat_work_proposals (id, thread_id, state, current_revision, created_at, updated_at) VALUES ('p', ?, 'open', 1, ?, ?)",
          [t.thread.id, now, now]
        );
        await db.run(
          "INSERT INTO chat_work_proposal_revisions (proposal_id, proposal_revision, spec_json, responsible_profile_id, created_at) VALUES ('p', 1, '{}', 'owner', ?)",
          [now]
        );
        const before = await db.all('SELECT * FROM mission_sequences ORDER BY id');
        const changes = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entity_changes');
        const access = new ChatAccess(db);
        await assert.rejects(
          db.transaction(async tx => {
            for (const projectId of projects) {
              const scope = await access.projectGrant(owner, projectId, 'mission:create');
              await createMissionWithObjectives({
                ctx: { ...access.context(scope!.grant), db: tx },
                projectId,
                title: 'Draft',
                objectives: [{ objective: 'Implement', agent: 'codex' }]
              });
            }
            await tx.run(
              "INSERT INTO chat_work_receipts (id, proposal_id, proposal_revision, owner_profile_id, client_request_id, request_digest, authorization_revision, created_at) VALUES ('r', 'p', 1, 'owner', 'create', 'digest', 1, ?)",
              [now]
            );
            await createMissionWithObjectives({
              ctx: {
                ...access.context((await access.grants(owner, 'mission:create'))[0]!),
                db: tx
              },
              projectId: 'missing',
              objectives: [{ objective: 'Fail' }]
            });
          })
        );
        for (const table of ['missions', 'objectives', 'chat_work_receipts'])
          assert.equal(
            Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n),
            0
          );
        assert.deepEqual(await db.all('SELECT * FROM mission_sequences ORDER BY id'), before);
        assert.deepEqual(await db.get('SELECT COUNT(*) AS n FROM entity_changes'), changes);
      }));
  });

import { ChatProposals } from './proposals.js';
import { ChatRuns, StaleChatAttempt } from './runs.js';
import { ChatStore } from './store.js';
const identity = { provider: 'fake', model: 'fake', configDigest: 'fake', checkpointVersion: 1 };
const code = (value: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === value);
const spec = (projects: string[]) =>
  projects.map((projectId, i) => ({
    key: `m${i}`,
    projectId,
    title: `Mission ${i}`,
    dependencies: i ? ['m0'] : [],
    objectives: [
      {
        title: 'Implement',
        objective: 'Build the feature',
        acceptanceCriteria: ['Works'],
        resourceKey: 'primary',
        evidenceIds: [],
        assignment: { agent: 'codex', model: 'test-model', reasoningEffort: 'high' }
      },
      {
        title: 'Verify',
        objective: 'Verify feature',
        acceptanceCriteria: ['Tests pass'],
        resourceKey: 'primary',
        evidenceIds: [],
        assignment: { agent: 'codex', model: 'test-model' }
      }
    ]
  }));
async function active(db: DatabaseClient, c: Conversations) {
  const created = await c.create(owner, {
    clientRequestId: randomUUID(),
    text: 'Please prepare drafts'
  });
  const runs = new ChatRuns(db, c.options);
  const a = await runs.claim('test', identity);
  assert.ok(a);
  return { thread: created.thread, a, runs, p: new ChatProposals(db, c.options) };
}
import type { DatabaseClient } from '@overlord/database';
import { randomUUID } from 'node:crypto';

import { Conversations } from './conversations.js';
for (const adapter of ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])])
  describe(`versioned proposals and Create [${adapter}]`, () => {
    it('discussion creates nothing; frozen cross-workspace drafts preserve responsibility, reasoning, provenance and receipt under concurrent replay', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p, thread } = await active(db, c);
        const card = await p.prepare(a, 'prepare', { missions: spec(projects) });
        assert.deepEqual(await p.prepare(a, 'prepare', { missions: [] }), card);
        assert.equal(
          Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          0
        );
        assert.equal((await c.snapshot(owner, thread.id)).openProposals[0]!.id, card.id);
        const events = await c.events(owner, thread.id, 0);
        assert.ok(events.events.some(e => e.kind === 'proposal.revised'));
        const body = { clientRequestId: 'create', expectedRevision: 1 };
        const [first, second] = await Promise.all([
          p.create(owner, card.id, body),
          p.create(owner, card.id, body)
        ]);
        assert.deepEqual(first.receipt, second.receipt);
        assert.equal(Number(first.replayed) + Number(second.replayed), 1);
        assert.deepEqual(
          (
            await new ChatProposals(db, c.options).create(owner, card.id, {
              clientRequestId: 'new-key',
              expectedRevision: 1
            })
          ).receipt,
          first.receipt
        );
        assert.equal(first.receipt.missions.length, 2);
        for (const m of first.receipt.missions) {
          const row = await db.get<{
            status_type: string;
            assigned_workspace_user_id: string;
            created_by_kind: string;
            created_by_agent: string;
            created_from_chat_thread_id: string;
          }>('SELECT * FROM missions WHERE id = ?', [m.missionId]);
          assert.equal(row!.status_type, 'draft');
          assert.equal(row!.created_by_kind, 'agent');
          assert.equal(row!.created_by_agent, 'overlord-assistant');
          assert.equal(row!.created_from_chat_thread_id, thread.id);
          const member = await db.get<{ profile_id: string }>(
            'SELECT profile_id FROM workspace_users WHERE id = ?',
            [row!.assigned_workspace_user_id]
          );
          assert.equal(member!.profile_id, 'owner');
          const objectives = await db.all<{
            state: string;
            assigned_agent: string;
            model: string;
            reasoning_effort: string | null;
            auto_advance: unknown;
            instruction_text: string;
          }>('SELECT * FROM objectives WHERE mission_id = ? ORDER BY position', [m.missionId]);
          assert.deepEqual(
            objectives.map(o => o.state),
            ['draft', 'future']
          );
          assert.deepEqual(
            objectives.map(o => o.reasoning_effort),
            ['high', null]
          );
          assert.ok(
            objectives.every(
              o => o.assigned_agent === 'codex' && o.model === 'test-model' && !o.auto_advance
            )
          );
          assert.match(objectives[0]!.instruction_text, /Acceptance criteria:\n- Works/);
        }
        for (const table of ['execution_requests', 'run_queue_entries'])
          assert.equal(
            Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n),
            0
          );
        const after = await c.snapshot(owner, thread.id);
        assert.equal(after.openProposals.length, 0);
        // The created card's block still names it, so the snapshot carries its receipt.
        assert.deepEqual(
          after.referencedProposals.map(r => [r.id, r.state, r.receipt?.id]),
          [[card.id, 'created', first.receipt.id]]
        );
      }));
    it('preparation failures carry a specific reason for the assistant, never in the client error text', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p } = await active(db, c);
        const reason = async (missions: unknown) => {
          try {
            await p.prepare(a, `prepare-${Math.random()}`, { missions });
          } catch (e) {
            const error = e as { code?: string; message?: string; detail?: string };
            return { code: error.code, message: error.message, detail: error.detail ?? '' };
          }
          return { code: 'accepted', message: '', detail: '' };
        };
        const base = spec(projects);
        const unregistered = await reason([
          { ...base[0]!, objectives: [{ ...base[0]!.objectives[0]!, resourceKey: 'docs' }] }
        ]);
        assert.equal(unregistered.code, 'not_found');
        assert.equal(unregistered.message, 'not found');
        assert.match(unregistered.detail, /"docs" is not registered.*Registered keys: primary/);
        const model = await reason([
          {
            ...base[0]!,
            objectives: [
              {
                ...base[0]!.objectives[0]!,
                assignment: { agent: 'codex', model: 'no-such-model', reasoningEffort: 'high' }
              }
            ]
          }
        ]);
        assert.equal(model.code, 'proposal_not_creatable');
        assert.match(model.detail, /"no-such-model" is not enabled for agent "codex"/);
        const evidence = await reason([
          { ...base[0]!, objectives: [{ ...base[0]!.objectives[0]!, evidenceIds: ['E4'] }] }
        ]);
        assert.equal(evidence.code, 'invalid_request');
        assert.match(evidence.detail, /not an evidence id from this conversation/);
        const foreign = await reason([{ ...base[0]!, projectId: 'someone-elses-project' }]);
        assert.equal(foreign.code, 'not_found');
        assert.doesNotMatch(foreign.detail, /someone-elses-project/);
      }));
    it('rolls back all drafts and receipt if a later destination has no draft status', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p } = await active(db, c);
        const card = await p.prepare(a, 'prepare', { missions: spec(projects) });
        await db.run("DELETE FROM project_statuses WHERE project_id = ? AND type = 'draft'", [
          projects[1]!
        ]);
        const sequences = await db.all('SELECT * FROM mission_sequences ORDER BY id');
        const changes = await db.get('SELECT COUNT(*) AS n FROM entity_changes');
        await assert.rejects(
          p.create(owner, card.id, { clientRequestId: 'fail', expectedRevision: 1 }),
          code('proposal_not_creatable')
        );
        for (const table of ['missions', 'objectives', 'chat_work_receipts'])
          assert.equal(
            Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n),
            0
          );
        assert.deepEqual(await db.all('SELECT * FROM mission_sequences ORDER BY id'), sequences);
        assert.deepEqual(await db.get('SELECT COUNT(*) AS n FROM entity_changes'), changes);
      }));
    it('revisions are frozen, stale confirmations fail, and a published revision survives cancellation', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p, thread } = await active(db, c);
        const first = await p.prepare(a, 'p1', { missions: spec(projects) });
        await assert.rejects(
          p.prepare(a, 'bad', {
            proposalId: first.id,
            expectedRevision: 2,
            missions: spec(projects)
          }),
          code('stale_revision')
        );
        const revised = await p.prepare(a, 'p2', {
          proposalId: first.id,
          expectedRevision: 1,
          missions: spec(projects)
        });
        assert.equal(revised.currentRevision, 2);
        await assert.rejects(
          db.run("UPDATE chat_work_proposal_revisions SET spec_json = '{}' WHERE proposal_id = ?", [
            first.id
          ])
        );
        await assert.rejects(
          p.create(owner, first.id, { clientRequestId: 'stale', expectedRevision: 1 }),
          code('stale_revision')
        );
        const run = await c.cancel(owner, a.runId, 'cancel');
        assert.equal(run.state, 'cancelled');
        await assert.rejects(p.prepare(a, 'p3', { missions: spec(projects) }), StaleChatAttempt);
        const created = await p.create(owner, first.id, {
          clientRequestId: 'current',
          expectedRevision: 2
        });
        assert.equal(created.receipt.revision, 2);
        assert.equal((await c.snapshot(owner, thread.id)).openProposals.length, 0);
      }));
    it('project preference is resolved during preparation; changed defaults cannot change frozen assignments or draft status', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p } = await active(db, c);
        const access = new ChatAccess(db);
        for (const projectId of projects) {
          const scope = (await access.projectGrant(owner, projectId))!;
          const now = new Date().toISOString();
          await db.run(
            'INSERT INTO project_user_preferences (id, workspace_id, project_id, workspace_user_id, preferences_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
              randomUUID(),
              scope.grant.workspaceId,
              projectId,
              scope.grant.workspaceUserId,
              JSON.stringify({
                launchPreference: {
                  selectedAgent: 'codex',
                  selectedModel: 'test-model',
                  selectedReasoningEffort: 'high'
                }
              }),
              now,
              now
            ]
          );
        }
        const input = spec(projects);
        for (const m of input)
          for (const o of m.objectives) delete (o as { assignment?: unknown }).assignment;
        const card = await p.prepare(a, 'pref', { missions: input });
        assert.equal(card.current.missions[0]!.objectives[0]!.assignment.source, 'project_default');
        await db.run("UPDATE project_user_preferences SET preferences_json = '{}'");
        await db.run("UPDATE project_statuses SET is_default = ? WHERE type = 'draft'", [
          db.dialect === 'sqlite' ? 0 : false
        ]);
        await db.run("UPDATE project_statuses SET is_default = ? WHERE type = 'next'", [
          db.dialect === 'sqlite' ? 1 : true
        ]);
        const result = await p.create(owner, card.id, {
          clientRequestId: 'pref',
          expectedRevision: 1
        });
        const objectives = await db.all<{ reasoning_effort: string }>(
          'SELECT reasoning_effort FROM objectives'
        );
        assert.ok(objectives.every(o => o.reasoning_effort === 'high'));
        assert.equal(result.receipt.missions.length, 2);
      }));
    it('missing/null selections, invented agents/models, unknown resources and foreign evidence do not publish cards', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p, thread } = await active(db, c);
        for (const assignment of [
          null,
          undefined,
          { agent: 'unknown', model: 'test-model' },
          { agent: 'codex', model: 'unknown' },
          { agent: 'codex', model: 'test-model', reasoningEffort: 'invalid' }
        ]) {
          const input = spec(projects.slice(0, 1));
          (input[0]!.objectives[0] as { assignment: unknown }).assignment = assignment;
          await assert.rejects(
            p.prepare(a, randomUUID(), { missions: input }),
            code('proposal_not_creatable')
          );
        }
        const bad = spec(projects.slice(0, 1));
        bad[0]!.objectives[0]!.resourceKey = 'unknown';
        await assert.rejects(p.prepare(a, 'bad-resource', { missions: bad }), code('not_found'));
        const foreign = spec(projects.slice(0, 1));
        foreign[0]!.objectives[0]!.evidenceIds.push('foreign');
        await assert.rejects(
          p.prepare(a, 'bad-evidence', { missions: foreign }),
          code('invalid_request')
        );
        assert.equal((await c.snapshot(owner, thread.id)).openProposals.length, 0);
      }));
    it('live destination authorization and catalog removals reject Create; another owner/organization learns nothing', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p } = await active(db, c);
        const card = await p.prepare(a, 'prep', { missions: spec(projects) });
        for (const foreign of [
          { ...owner, profileId: 'stranger' },
          { ...owner, organizationId: 'other' }
        ])
          await assert.rejects(
            p.create(foreign, card.id, { clientRequestId: 'foreign', expectedRevision: 1 }),
            code('not_found')
          );
        await db.run("UPDATE workspaces SET settings_json = '{}' WHERE id = 'ws-b'");
        await assert.rejects(
          p.create(owner, card.id, { clientRequestId: 'bad-catalog', expectedRevision: 1 }),
          code('proposal_not_creatable')
        );
        await db.run("DELETE FROM role_assignments WHERE workspace_id = 'ws-b'");
        await assert.rejects(
          p.create(owner, card.id, { clientRequestId: 'lost-role', expectedRevision: 1 }),
          code('proposal_not_creatable')
        );
        assert.equal(
          Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          0
        );
      }));
    it('revoked source invalidates the card and its event and prevents all creation', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, thread } = await active(db, c);
        let authorized = true;
        const options = {
          checkSource: async () => (authorized ? ('authorized' as const) : ('revoked' as const))
        };
        const store = new ChatStore(db, options);
        const p = new ChatProposals(db, options);
        const ids = await store.registerSources(owner, thread.id, [
          {
            scopeKey: 'source',
            locator: {
              kind: 'overlord',
              entityType: 'project',
              entityId: projects[0]!,
              projectId: projects[0]!
            }
          }
        ]);
        await store.checkSources(thread.id, ids);
        await store.dependencySet(thread.id, ids);
        const card = await p.prepare(a, 'prep', { missions: spec(projects) });
        authorized = false;
        await assert.rejects(
          p.create(owner, card.id, { clientRequestId: 'revoked', expectedRevision: 1 }),
          code('proposal_not_creatable')
        );
        const snapshot = await c.snapshot(owner, thread.id);
        assert.equal(snapshot.openProposals[0]!.current.invalidated, true);
        assert.deepEqual(snapshot.openProposals[0]!.current.missions, []);
        const events = await c.events(owner, thread.id, 0);
        assert.ok(!events.events.some(e => e.kind === 'proposal.revised'));
        assert.ok(events.events.some(e => e.kind === 'content.invalidated'));
        assert.equal(
          Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          0
        );
      }));
    it('an owner request key cannot create two proposals, including concurrent calls across threads', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const one = await active(db, c);
        const first = await one.p.prepare(one.a, 'first', { missions: spec(projects.slice(0, 1)) });
        await one.runs.complete(one.a);
        const two = await active(db, c);
        const second = await two.p.prepare(two.a, 'second', { missions: spec(projects.slice(1)) });
        const settled = await Promise.allSettled([
          one.p.create(owner, first.id, { clientRequestId: 'shared', expectedRevision: 1 }),
          two.p.create(owner, second.id, { clientRequestId: 'shared', expectedRevision: 1 })
        ]);
        assert.equal(settled.filter(s => s.status === 'fulfilled').length, 1);
        const failed = settled.find(s => s.status === 'rejected') as PromiseRejectedResult;
        assert.ok(code('invalid_request')(failed.reason));
        assert.equal(
          Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          1
        );
      }));
  });

for (const adapter of ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])])
  describe(`Create alongside ordinary mission creation [${adapter}]`, () => {
    it('shares atomic sequence allocation with the existing mission creation surface', () =>
      proposalFixture(adapter, async (db, c, projects) => {
        const { a, p } = await active(db, c);
        const card = await p.prepare(a, 'prepare', { missions: spec(projects.slice(0, 1)) });
        const access = new ChatAccess(db);
        const scope = (await access.projectGrant(owner, projects[0]!))!;
        const [chat, ordinary] = await Promise.all([
          p.create(owner, card.id, { clientRequestId: 'chat', expectedRevision: 1 }),
          createMissionWithObjectives({
            ctx: access.context(scope.grant),
            projectId: projects[0]!,
            title: 'Ordinary',
            objectives: [{ objective: 'Another feature', agent: 'codex', model: 'test-model' }]
          })
        ]);
        assert.notEqual(chat.receipt.missions[0]!.missionDisplayId, ordinary.mission.displayId);
        assert.equal(
          Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          2
        );
      }));
  });
