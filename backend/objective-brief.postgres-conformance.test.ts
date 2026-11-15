import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Objective brief state and ownership (coo:1275, ADR 0057) on both database
 * adapters, through the real REST/protocol repository paths and the core
 * service operations: authorship tracking in both directions, human edits
 * after completion, durable removal suppression, stale-write protection and
 * title ownership.
 */

const LONG =
  `Implement the objective brief state. ${'Keep every constraint and warning. '.repeat(12)}`.trim();
const LONG_2 =
  `Rewrite the objective brief state. ${'Keep every prohibition visible. '.repeat(12)}`.trim();

type Brief = {
  title: string | null;
  title_source: string | null;
  title_generation: number;
  title_status: string | null;
  description: string | null;
  description_source: string | null;
  description_status: string | null;
  description_request_kind: string | null;
  description_generation: number;
  description_revision: number;
  description_suppressed: unknown;
  description_author_workspace_user_id: string | null;
  description_author_agent: string | null;
  instruction_author_kind: string | null;
  instruction_text: string | null;
  state: string;
  updated_at: unknown;
  revision: number;
  launched_at: unknown;
  completed_at: unknown;
};

async function brief(db: DatabaseClient, id: string): Promise<Brief> {
  const row = await db.get<Brief>(
    `SELECT title, title_source, title_generation, title_status, description, description_source,
            description_status, description_request_kind, description_generation,
            description_revision, description_suppressed, description_author_workspace_user_id,
            description_author_agent, instruction_author_kind, instruction_text, state,
            updated_at, revision, launched_at, completed_at
       FROM objectives WHERE id = ?`,
    [id]
  );
  assert.ok(row, `objective ${id} exists`);
  return {
    ...row,
    title_generation: Number(row.title_generation),
    description_generation: Number(row.description_generation),
    description_revision: Number(row.description_revision),
    revision: Number(row.revision),
    description_suppressed: row.description_suppressed === true || row.description_suppressed === 1
  };
}

for (const adapter of conformanceAdapters()) {
  describe(`objective brief state [${adapter}]`, () => {
    async function setup(prefix: string) {
      const { db, cleanup } = await createConformanceDatabase(adapter, prefix);
      const workspaceUserId = await bindWebappDatabaseClient({ client: db });
      const repo = await import('./repository.ts');
      const { buildWebappServiceContextForWorkspace } = await import('./db.ts');
      const service = await import('../packages/core/service/objective-brief.ts');
      const missions = await import('../packages/core/service/missions.ts');
      const project = await repo.createProject({ name: `Brief ${prefix}` });
      const { workspace_id: workspaceId } = (await db.get<{ workspace_id: string }>(
        'SELECT workspace_id FROM projects WHERE id = ?',
        [project.id]
      ))!;
      const humanCtx = await buildWebappServiceContextForWorkspace(
        workspaceId,
        db,
        workspaceUserId
      );
      const agentCtx = {
        ...humanCtx,
        source: 'protocol' as const,
        origin: { kind: 'agent' as const, agent: 'claude-code', sessionId: null }
      };
      const mission = await repo.createMission({
        projectId: project.id,
        firstObjective: 'Plan it'
      });
      const addAgent = async (
        objective: string,
        extra: { title?: string; description?: string | null } = {}
      ) =>
        (
          await missions.addObjectivesToMission({
            ctx: agentCtx,
            missionId: mission.id,
            objectives: [{ objective, ...extra }]
          })
        )[0]!;
      return { db, cleanup, repo, service, humanCtx, agentCtx, mission, addAgent, workspaceUserId };
    }

    it('tracks current-instruction authorship and title ownership across create and edit paths', async () => {
      const t = await setup('ovld_brief_author');
      try {
        // Person-written via REST: no automatic summary, system-owned title.
        const human = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: LONG
        });
        let row = await brief(t.db, human.id);
        assert.equal(row.instruction_author_kind, 'human');
        assert.equal(row.title_source, 'generated');
        assert.equal(row.description_status, null);

        // Agent/assistant-written without an attached session: automatic summary intent.
        const agent = await t.addAgent(LONG, { title: 'Agent title' });
        row = await brief(t.db, agent.id);
        assert.equal(row.instruction_author_kind, 'agent');
        assert.equal(row.title_source, 'agent');
        assert.equal(row.description_status, 'pending');
        assert.equal(row.description_request_kind, 'automatic');

        // A person rewrites the agent's instructions: authorship flips, automatic intent is withdrawn.
        await t.repo.updateObjective(agent.id, { instructionText: LONG_2 });
        row = await brief(t.db, agent.id);
        assert.equal(row.instruction_author_kind, 'human');
        assert.equal(row.description_status, null);
        assert.equal(row.title_source, 'agent', 'an authored title survives an instruction edit');
        assert.equal(row.title, 'Agent title');

        // The protocol path (agent origin) rewrites the person's instructions: summary requested.
        await t.repo.updateObjective(
          human.id,
          { instructionText: LONG_2 },
          { origin: { kind: 'agent', agent: 'claude-code' } }
        );
        row = await brief(t.db, human.id);
        assert.equal(row.instruction_author_kind, 'agent');
        assert.equal(row.description_status, 'pending');

        // Lifecycle and configuration edits do not touch the brief.
        const generation = row.description_generation;
        await t.repo.updateObjective(human.id, { state: 'submitted' });
        row = await brief(t.db, human.id);
        assert.equal(row.description_generation, generation);
        assert.equal(row.instruction_author_kind, 'agent');

        // A REST title edit is user-owned; clearing hands it back to automation.
        await t.repo.updateObjective(human.id, { title: 'My title' });
        assert.equal((await brief(t.db, human.id)).title_source, 'user');
        await t.repo.updateObjective(human.id, { title: '' });
        assert.equal((await brief(t.db, human.id)).title_source, 'generated');
      } finally {
        await t.cleanup();
      }
    });

    it('guards generated titles by ownership and generation', async () => {
      const t = await setup('ovld_brief_title');
      try {
        const { hashObjectiveInstruction, publishObjectiveBrief } = t.service;
        const publishTitle = (
          objectiveId: string,
          generation: number,
          text: string,
          hash: string
        ) =>
          publishObjectiveBrief({
            ctx: t.humanCtx,
            objectiveId,
            result: { instructionHash: hash, title: { generation, text } }
          });
        const created = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: LONG
        });
        assert.equal((await brief(t.db, created.id)).title_status, 'pending');
        // Instruction edit moves the generation: a result scheduled before it is stale.
        await t.repo.updateObjective(created.id, { instructionText: LONG_2 });
        const hash2 = hashObjectiveInstruction(LONG_2)!;
        await publishTitle(created.id, 0, 'Stale', hashObjectiveInstruction(LONG)!);
        assert.notEqual((await brief(t.db, created.id)).title, 'Stale');
        await publishTitle(created.id, 1, 'Fresh', hash2);
        assert.equal((await brief(t.db, created.id)).title, 'Fresh');

        // An authored title is never replaced by generation.
        await t.repo.updateObjective(created.id, { title: 'Mine' });
        const { title_generation: g } = await brief(t.db, created.id);
        await publishTitle(created.id, g, 'Model', hash2);
        assert.equal((await brief(t.db, created.id)).title, 'Mine');

        // Unknown legacy provenance is protected too.
        await t.db.run('UPDATE objectives SET title_source = NULL WHERE id = ?', [created.id]);
        await publishTitle(created.id, g, 'Model', hash2);
        assert.equal((await brief(t.db, created.id)).title, 'Mine');

        // An agent-titled objective keeps its title and asks for no title job.
        const titled = await t.addAgent(LONG, { title: 'Agent title' });
        assert.equal((await brief(t.db, titled.id)).title_status, null);
        await publishTitle(titled.id, 0, 'Model', hashObjectiveInstruction(LONG)!);
        assert.equal((await brief(t.db, titled.id)).title, 'Agent title');
      } finally {
        await t.cleanup();
      }
    });

    it('lets people edit descriptions after completion without touching instructions or evidence', async () => {
      const t = await setup('ovld_brief_edit');
      try {
        const objective = await t.addAgent(LONG);
        await t.repo.updateObjective(objective.id, { state: 'executing' });
        await t.repo.updateObjective(objective.id, { state: 'complete' });
        const before = await brief(t.db, objective.id);
        const changesBefore = await t.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM entity_changes WHERE entity_id = ? AND entity_type = 'objective'",
          [objective.id]
        );

        const result = await t.service.setObjectiveDescription({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          description: 'Add brief state. The work is done when both adapters pass.',
          expectedDescriptionRevision: before.description_revision
        });
        assert.equal(result.brief.descriptionSource, 'user');
        assert.equal(result.brief.descriptionAuthorWorkspaceUserId, t.workspaceUserId);
        assert.equal(result.brief.descriptionStale, false);

        const after = await brief(t.db, objective.id);
        assert.equal(after.state, 'complete');
        assert.equal(after.instruction_text, before.instruction_text);
        assert.deepEqual(after.completed_at, before.completed_at);
        assert.deepEqual(after.launched_at, before.launched_at);
        assert.deepEqual(after.updated_at, before.updated_at, 'activity ordering is not moved');
        assert.equal(after.revision, before.revision + 1);
        assert.equal(after.description_revision, before.description_revision + 1);
        const changesAfter = await t.db.get<{ n: number; fields: string }>(
          "SELECT COUNT(*) AS n FROM entity_changes WHERE entity_id = ? AND entity_type = 'objective'",
          [objective.id]
        );
        assert.equal(Number(changesAfter!.n), Number(changesBefore!.n) + 1);

        // The edit did not unlock instruction editing after launch.
        await assert.rejects(
          t.repo.updateObjective(objective.id, { instructionText: LONG_2 }),
          (e: { status?: number }) => e.status === 400
        );

        // Stale write: a second editor working from the old revision conflicts.
        await assert.rejects(
          t.service.setObjectiveDescription({
            ctx: t.agentCtx,
            objectiveId: objective.id,
            description: 'Other text.',
            expectedDescriptionRevision: before.description_revision
          }),
          (e: { code?: string; status?: number }) =>
            e.code === 'description_conflict' && e.status === 409
        );
        assert.match((await brief(t.db, objective.id)).description ?? '', /both adapters/);

        // An agent edit records the agent attribution.
        const agentEdit = await t.service.setObjectiveDescription({
          ctx: t.agentCtx,
          objectiveId: objective.id,
          description: 'Agent text.'
        });
        assert.equal(agentEdit.brief.descriptionSource, 'agent');
        assert.equal(agentEdit.brief.descriptionAuthorAgent, 'claude-code');
      } finally {
        await t.cleanup();
      }
    });

    it('keeps a removed summary absent across edits, catch-up and late results until a person selects Summarize', async () => {
      const t = await setup('ovld_brief_remove');
      try {
        const objective = await t.addAgent(LONG);
        const pending = await brief(t.db, objective.id);
        assert.equal(pending.description_status, 'pending');
        const inFlight = {
          generation: pending.description_generation,
          hash: (
            await import('../packages/core/service/objective-brief.ts')
          ).hashObjectiveInstruction(LONG)!
        };

        await t.service.removeObjectiveDescription({ ctx: t.humanCtx, objectiveId: objective.id });
        let row = await brief(t.db, objective.id);
        assert.equal(row.description_suppressed, true);
        assert.equal(row.description_status, null);
        assert.equal(row.description, null);

        // The in-flight result cannot restore it.
        const late = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          result: {
            instructionHash: inFlight.hash,
            description: { generation: inFlight.generation, text: 'Late summary.' }
          }
        });
        assert.equal(late.description, 'suppressed');

        // Agent instruction edits, reorder/reopen-free lifecycle moves and catch-up do not re-enable it.
        await t.repo.updateObjective(
          objective.id,
          { instructionText: LONG_2 },
          {
            origin: { kind: 'agent', agent: 'claude-code' }
          }
        );
        await t.repo.updateObjective(objective.id, { state: 'submitted' });
        assert.deepEqual(
          (await t.service.listObjectiveBriefCatchUpCandidates(t.db, { limit: 50 })).includes(
            objective.id
          ),
          false
        );
        assert.equal(
          await t.service.markObjectiveBriefCatchUpPending(t.humanCtx, objective.id),
          false
        );
        row = await brief(t.db, objective.id);
        assert.equal(row.description_suppressed, true);
        assert.equal(row.description_status, null);

        // Agents cannot store text or request a summary while suppressed.
        const refused = await t.service.setObjectiveDescription({
          ctx: t.agentCtx,
          objectiveId: objective.id,
          description: 'Agent text.'
        });
        assert.deepEqual(
          refused.warnings.map(w => w.code),
          ['description_suppressed']
        );
        assert.equal(refused.brief.description, null);
        await assert.rejects(
          t.service.requestObjectiveDescriptionGeneration({
            ctx: t.agentCtx,
            objectiveId: objective.id,
            mode: 'summarize'
          }),
          (e: { code?: string }) => e.code === 'description_suppressed'
        );

        // A person selects Summarize: suppression clears and a fresh generation is pending.
        const summarize = await t.service.requestObjectiveDescriptionGeneration({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          mode: 'summarize'
        });
        assert.equal(summarize.brief.descriptionSuppressed, false);
        assert.equal(summarize.brief.descriptionStatus, 'pending');
        row = await brief(t.db, objective.id);
        const published = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          result: {
            instructionHash: (
              await import('../packages/core/service/objective-brief.ts')
            ).hashObjectiveInstruction(LONG_2)!,
            description: {
              generation: row.description_generation,
              text: 'Rewrite the brief state.'
            }
          }
        });
        assert.equal(published.description, 'published');
        row = await brief(t.db, objective.id);
        assert.equal(row.description_source, 'generated');
        assert.equal(row.description_status, null);
      } finally {
        await t.cleanup();
      }
    });

    it('reopen keeps the summary and its provenance, requests nothing, and keeps a removed summary absent', async () => {
      const t = await setup('ovld_brief_reopen');
      try {
        const { hashObjectiveInstruction } =
          await import('../packages/core/service/objective-brief.ts');
        const briefJobs = async (id: string) =>
          Number(
            (await t.db.get<{ n: number }>(
              `SELECT COUNT(*) AS n FROM worker_jobs
                WHERE type = 'overlord.objective.brief.compose.v1' AND CAST(payload_json AS TEXT) LIKE ?`,
              [`%${id}%`]
            ))!.n
          );
        const runToCompletion = async (id: string) => {
          for (const state of ['launching', 'executing', 'complete'] as const) {
            await t.repo.updateObjective(id, { state });
          }
        };

        // A generated summary survives a run and a reopen unchanged.
        const kept = await t.addAgent(LONG);
        const pending = await brief(t.db, kept.id);
        const published = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: kept.id,
          result: {
            instructionHash: hashObjectiveInstruction(LONG)!,
            description: { generation: pending.description_generation, text: 'Build the state.' }
          }
        });
        assert.equal(published.description, 'published');
        await runToCompletion(kept.id);
        const beforeReopen = await brief(t.db, kept.id);
        const jobsBeforeReopen = await briefJobs(kept.id);
        await t.repo.updateObjective(kept.id, { state: 'draft' });
        const reopened = await brief(t.db, kept.id);
        assert.equal(reopened.state, 'draft');
        assert.equal(reopened.description, 'Build the state.');
        assert.equal(reopened.description_source, 'generated');
        assert.equal(reopened.description_status, null);
        assert.equal(reopened.description_generation, beforeReopen.description_generation);
        assert.equal(reopened.title_status, beforeReopen.title_status);
        assert.equal(reopened.title_generation, beforeReopen.title_generation);
        assert.equal(await briefJobs(kept.id), jobsBeforeReopen, 'reopen queues no brief job');
        assert.equal(
          (await t.service.listObjectiveBriefCatchUpCandidates(t.db, { limit: 50 })).includes(
            kept.id
          ),
          false
        );

        // A removed summary stays absent through a run, reopen and catch-up.
        const removed = await t.addAgent(LONG_2);
        await t.service.removeObjectiveDescription({ ctx: t.humanCtx, objectiveId: removed.id });
        await runToCompletion(removed.id);
        await t.repo.updateObjective(removed.id, { state: 'draft' });
        assert.equal(
          (await t.service.listObjectiveBriefCatchUpCandidates(t.db, { limit: 50 })).includes(
            removed.id
          ),
          false
        );
        assert.equal(
          await t.service.markObjectiveBriefCatchUpPending(t.humanCtx, removed.id),
          false
        );
        const removedRow = await brief(t.db, removed.id);
        assert.equal(removedRow.state, 'draft');
        assert.equal(removedRow.description, null);
        assert.equal(removedRow.description_suppressed, true);
        assert.equal(removedRow.description_status, null);
      } finally {
        await t.cleanup();
      }
    });

    it('serializes concurrent writers on the objective row, so a stale snapshot cannot replace a person summary', async t2 => {
      if (adapter !== 'postgres') {
        t2.skip('SQLite serializes write transactions');
        return;
      }
      const t = await setup('ovld_brief_lock');
      try {
        const objective = await t.addAgent(LONG);
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        let locked!: () => void;
        const holding = new Promise<void>(resolve => (locked = resolve));
        const holder = t.db.transaction(async tx => {
          await tx.get('SELECT id FROM objectives WHERE id = ? FOR UPDATE', [objective.id]);
          locked();
          await gate;
        });
        await holding;

        // A person writes a summary, then an agent rewrites the instructions.
        // Both wait on the row; each must plan from the row it then writes.
        const personEdit = t.service.setObjectiveDescription({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          description: 'A summary a person wrote.'
        });
        await sleep(150);
        const agentEdit = t.repo.updateObjective(
          objective.id,
          { instructionText: LONG_2 },
          { origin: { kind: 'agent', agent: 'claude-code' } }
        );
        await sleep(150);
        release();
        await holder;
        await personEdit;
        await agentEdit;

        const row = await brief(t.db, objective.id);
        assert.equal(row.instruction_text, LONG_2);
        assert.equal(row.description, 'A summary a person wrote.');
        assert.equal(row.description_source, 'user');
        assert.notEqual(
          row.description_status,
          'pending',
          'an agent edit planned from a stale snapshot must not queue a replacement for a person summary'
        );
      } finally {
        await t.cleanup();
      }
    });

    it('drops stale results, keeps the newest request pending and survives reorder and launch', async () => {
      const t = await setup('ovld_brief_stale');
      try {
        const { hashObjectiveInstruction } =
          await import('../packages/core/service/objective-brief.ts');
        const objective = await t.addAgent(LONG);
        const other = await t.addAgent(LONG_2);
        const first = await brief(t.db, objective.id);

        // Edit during a run: the old result is stale and the newer request stays pending.
        await t.repo.updateObjective(
          objective.id,
          { instructionText: LONG_2 },
          {
            origin: { kind: 'agent', agent: 'claude-code' }
          }
        );
        const stale = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          result: {
            instructionHash: hashObjectiveInstruction(LONG)!,
            description: { generation: first.description_generation, text: 'Old summary.' }
          }
        });
        assert.equal(stale.description, 'stale');
        let row = await brief(t.db, objective.id);
        assert.equal(row.description, null);
        assert.equal(row.description_status, 'pending');

        // A failure for a superseded generation is ignored; the current one is recorded.
        assert.equal(
          await t.service.failObjectiveDescriptionGeneration({
            ctx: t.humanCtx,
            objectiveId: objective.id,
            generation: first.description_generation,
            failureCode: 'provider_error'
          }),
          false
        );
        assert.equal(
          await t.service.failObjectiveDescriptionGeneration({
            ctx: t.humanCtx,
            objectiveId: objective.id,
            generation: row.description_generation,
            failureCode: 'provider_unavailable'
          }),
          true
        );
        row = await brief(t.db, objective.id);
        assert.equal(row.description_status, 'failed');
        const retry = await t.service.requestObjectiveDescriptionGeneration({
          ctx: t.agentCtx,
          objectiveId: objective.id,
          mode: 'retry'
        });
        assert.equal(retry.brief.descriptionStatus, 'pending');
        assert.equal(retry.brief.descriptionFailureCode, null);

        // Reorder and launch do not invalidate a still-current result.
        row = await brief(t.db, objective.id);
        await t.repo.reorderObjectives(t.mission.id, {
          orderedObjectiveIds: (
            await t.db.all<{ id: string }>(
              "SELECT id FROM objectives WHERE mission_id = ? AND state IN ('draft', 'submitted') AND deleted_at IS NULL ORDER BY position DESC",
              [t.mission.id]
            )
          ).map(r => r.id)
        });
        await t.repo.updateObjective(objective.id, { state: 'launching' });
        const current = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          result: {
            instructionHash: hashObjectiveInstruction(LONG_2)!,
            description: {
              generation: row.description_generation,
              text: 'Rewrite the brief state.'
            }
          }
        });
        assert.equal(current.description, 'published');
        assert.equal((await brief(t.db, objective.id)).state, 'launching');

        // A manual edit without an instruction change still invalidates an in-flight result.
        const regenerate = await t.service.requestObjectiveDescriptionGeneration({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          mode: 'regenerate'
        });
        const regenGeneration = (await brief(t.db, objective.id)).description_generation;
        assert.equal(regenerate.brief.descriptionStatus, 'pending');
        await t.service.setObjectiveDescription({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          description: 'My own summary.'
        });
        const overwritten = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          result: {
            instructionHash: hashObjectiveInstruction(LONG_2)!,
            description: { generation: regenGeneration, text: 'Model summary.' }
          }
        });
        assert.equal(overwritten.description, 'stale');
        assert.equal((await brief(t.db, objective.id)).description, 'My own summary.');

        // Deleted objectives accept no results.
        const otherRow = await brief(t.db, other.id);
        await t.repo.deleteObjectives([other.id]);
        const deleted = await t.service.publishObjectiveBrief({
          ctx: t.humanCtx,
          objectiveId: other.id,
          result: {
            instructionHash: hashObjectiveInstruction(LONG_2)!,
            description: { generation: otherRow.description_generation, text: 'Ghost.' }
          }
        });
        assert.equal(deleted.description, 'stale');
      } finally {
        await t.cleanup();
      }
    });

    it('selects only eligible open agent-written rows for bounded catch-up', async () => {
      const t = await setup('ovld_brief_catchup');
      try {
        const eligible = await t.addAgent(LONG);
        const human = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: LONG
        });
        const short = await t.addAgent('Short agent text.');
        const done = await t.addAgent(LONG);
        const unknown = await t.addAgent(LONG);
        // Simulate rows whose automatic intent was lost or never recorded.
        await t.db.run(
          'UPDATE objectives SET description_status = NULL, description_request_kind = NULL WHERE mission_id = ?',
          [t.mission.id]
        );
        await t.db.run("UPDATE objectives SET state = 'complete' WHERE id = ?", [done.id]);
        await t.db.run('UPDATE objectives SET instruction_author_kind = NULL WHERE id = ?', [
          unknown.id
        ]);

        const candidates = await t.service.listObjectiveBriefCatchUpCandidates(t.db, { limit: 50 });
        assert.ok(candidates.includes(eligible.id));
        for (const skipped of [human.id, short.id, done.id, unknown.id]) {
          assert.equal(candidates.includes(skipped), false, skipped);
        }
        assert.equal(
          await t.service.markObjectiveBriefCatchUpPending(t.humanCtx, eligible.id),
          true
        );
        assert.equal(
          await t.service.markObjectiveBriefCatchUpPending(t.humanCtx, eligible.id),
          false,
          'repeat scans are deduplicated'
        );
        assert.equal((await brief(t.db, eligible.id)).description_request_kind, 'automatic');
      } finally {
        await t.cleanup();
      }
    });
  });
}
