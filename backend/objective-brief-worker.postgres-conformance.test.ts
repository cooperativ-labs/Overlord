import type { ObjectiveBriefGenerate } from '@overlord/automations';
import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Objective brief worker (coo:1275, ADR 0058) on both database adapters:
 * transactional enqueue from the create/edit routes, one combined provider
 * call, publication under the generation/hash guard, edits and removal while
 * a job runs, retries, lease expiry, restart recovery, bounded catch-up and
 * the no-provider state. The provider is always a scripted fake.
 */

const LONG =
  `Implement the brief worker for objective summaries. ${'Keep every constraint and warning visible. '.repeat(10)}`.trim();
const LONG_2 =
  `Rewrite the brief worker for objective summaries. ${'Keep every prohibition visible to people. '.repeat(10)}`.trim();
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const AGENT_ORIGIN = { kind: 'agent' as const, agent: 'claude-code' };

type Row = {
  title: string | null;
  title_source: string | null;
  title_status: string | null;
  title_generation: number;
  description: string | null;
  description_source: string | null;
  description_status: string | null;
  description_failure_code: string | null;
  description_generation: number;
  description_suppressed: boolean;
  description_instruction_hash: string | null;
  instruction_text: string | null;
  state: string;
};

async function row(db: DatabaseClient, id: string): Promise<Row> {
  const raw = await db.get<
    Omit<Row, 'description_suppressed'> & { description_suppressed: unknown }
  >(
    `SELECT title, title_source, title_status, title_generation, description, description_source,
            description_status, description_failure_code, description_generation,
            description_suppressed, description_instruction_hash, instruction_text, state
       FROM objectives WHERE id = ?`,
    [id]
  );
  assert.ok(raw, `objective ${id} exists`);
  return {
    ...raw,
    title_generation: Number(raw.title_generation),
    description_generation: Number(raw.description_generation),
    description_suppressed: raw.description_suppressed === true || raw.description_suppressed === 1
  };
}

type Job = {
  id: string;
  status: string;
  attempt_count: number;
  run_after: unknown;
  created_at: unknown;
};

async function jobsFor(db: DatabaseClient, objectiveId: string): Promise<Job[]> {
  const jobs = await db.all<Job>(
    `SELECT id, status, attempt_count, run_after, created_at FROM worker_jobs
      WHERE type = 'overlord.objective.brief.compose.v1' ORDER BY created_at ASC, id ASC`
  );
  const filtered: Job[] = [];
  for (const job of jobs) {
    const payload = await db.get<{ payload_json: unknown }>(
      'SELECT payload_json FROM worker_jobs WHERE id = ?',
      [job.id]
    );
    const parsed =
      typeof payload!.payload_json === 'string'
        ? (JSON.parse(payload!.payload_json) as { objectiveId: string })
        : (payload!.payload_json as { objectiveId: string });
    if (parsed.objectiveId === objectiveId) {
      filtered.push({ ...job, attempt_count: Number(job.attempt_count) });
    }
  }
  return filtered;
}

/** A scripted provider that answers exactly the requested fields. */
function fakeProvider(
  options: {
    title?: (call: number) => string;
    description?: (call: number) => string;
    onCall?: (call: number) => Promise<void>;
    fail?: (call: number) => boolean;
  } = {}
) {
  const calls: Array<{ required: string[] }> = [];
  const generate: ObjectiveBriefGenerate = async ({ responseSchema }) => {
    const call = calls.length + 1;
    const required = (responseSchema.required ?? []) as string[];
    calls.push({ required });
    await options.onCall?.(call);
    if (options.fail?.(call)) throw Object.assign(new Error('provider down'), { status: 503 });
    const out: Record<string, unknown> = {};
    if (required.includes('title')) out.title = options.title?.(call) ?? 'Write the brief worker';
    if (required.includes('description')) {
      out.description = {
        goal: options.description?.(call) ?? 'Add a worker that writes summaries for people.',
        decisionsNeeded: [],
        body: ['The worker keeps every constraint and warning visible.'],
        doneWhen: '',
        doneWhenStated: false
      };
    }
    return JSON.stringify(out);
  };
  return { generate, calls };
}

for (const adapter of conformanceAdapters()) {
  describe(`objective brief worker [${adapter}]`, () => {
    async function setup(prefix: string) {
      const { db, cleanup } = await createConformanceDatabase(adapter, prefix);
      const workspaceUserId = await bindWebappDatabaseClient({ client: db });
      const repo = await import('./repository.ts');
      const { buildWebappServiceContextForWorkspace } = await import('./db.ts');
      const service = await import('../packages/core/service/objective-brief.ts');
      const jobs = await import('../packages/core/service/worker-jobs.ts');
      const missions = await import('../packages/core/service/missions.ts');
      const { objectiveBriefComposeWorker: worker } =
        await import('./objective-brief-compose-worker.ts');
      const project = await repo.createProject({ name: `Brief worker ${prefix}` });
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
      const addAgent = async (objective: string, extra: { title?: string } = {}) =>
        (
          await missions.addObjectivesToMission({
            ctx: agentCtx,
            missionId: mission.id,
            objectives: [{ objective, ...extra }]
          })
        )[0]!;
      /** Claim the next brief job, ignoring the debounce. */
      const claim = async (now = FAR_FUTURE) =>
        jobs.claimNextWorkerJob({
          db,
          jobType: jobs.OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE,
          workerId: 'test-worker',
          now
        });
      const runNext = async () => {
        const job = await claim();
        assert.ok(job, 'a brief job is queued');
        await worker.processJobForTest(db, job);
        return job;
      };
      const finish = async () => {
        worker.setGenerateOverride(null);
        await cleanup();
      };
      return {
        db,
        repo,
        service,
        jobs,
        worker,
        humanCtx,
        agentCtx,
        mission,
        addAgent,
        claim,
        runNext,
        finish,
        workspaceId
      };
    }

    it('enqueues in the write transaction and publishes title and summary from one call', async () => {
      const t = await setup('ovld_bw_happy');
      try {
        const provider = fakeProvider();
        t.worker.setGenerateOverride(provider.generate);
        const objective = await t.addAgent(LONG);
        let current = await row(t.db, objective.id);
        assert.equal(current.title_status, 'pending');
        assert.equal(current.description_status, 'pending');
        const queued = await jobsFor(t.db, objective.id);
        assert.equal(queued.length, 1, 'the create transaction queued one job');
        assert.ok(String(queued[0]!.run_after) > '', 'debounced run_after');

        await t.runNext();
        current = await row(t.db, objective.id);
        assert.equal(provider.calls.length, 1, 'title and summary share one provider call');
        assert.deepEqual(provider.calls[0]!.required.sort(), ['description', 'title']);
        assert.equal(current.title, 'Write the brief worker');
        assert.equal(current.title_status, null);
        assert.equal(current.description_source, 'generated');
        assert.equal(current.description_status, null);
        assert.match(current.description ?? '', /^Add a worker that writes summaries for people\./);
        assert.ok(
          current.description!.endsWith(
            'The instructions do not say how to confirm that the work is complete.'
          )
        );
        assert.equal(current.instruction_text, LONG, 'instructions are never rewritten');
        const [done] = await jobsFor(t.db, objective.id);
        assert.equal(done!.status, 'succeeded');
      } finally {
        await t.finish();
      }
    });

    it('requests only the eligible fields: a person-written objective gets a title, never an automatic summary', async () => {
      const t = await setup('ovld_bw_fields');
      try {
        const provider = fakeProvider();
        t.worker.setGenerateOverride(provider.generate);
        const human = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: LONG
        });
        await t.runNext();
        assert.deepEqual(provider.calls[0]!.required, ['title']);
        const current = await row(t.db, human.id);
        assert.equal(current.title, 'Write the brief worker');
        assert.equal(current.description, null);

        // An authored title and short instructions ask for nothing.
        const titled = await t.addAgent('Fix the README typo.', { title: 'Mine' });
        assert.equal((await jobsFor(t.db, titled.id)).length, 0);
        const shortRest = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: 'Fix the README typo.'
        });
        assert.equal((await jobsFor(t.db, shortRest.id)).length, 0);
        // A short instruction edit writes the local title in the same statement.
        await t.repo.updateObjective(shortRest.id, { instructionText: 'Fix the CHANGELOG typo.' });
        assert.equal((await row(t.db, shortRest.id)).title, 'Fix the CHANGELOG typo.');
        assert.equal((await jobsFor(t.db, shortRest.id)).length, 0);
        // Clearing a title hands it back to automation now.
        await t.repo.updateObjective(shortRest.id, { title: 'Custom' });
        await t.repo.updateObjective(shortRest.id, { title: '' });
        assert.equal((await row(t.db, shortRest.id)).title, 'Fix the CHANGELOG typo.');
      } finally {
        await t.finish();
      }
    });

    it('processes the newest instructions when they change while the provider call runs', async () => {
      const t = await setup('ovld_bw_edit_during');
      try {
        const objective = await t.addAgent(LONG);
        const provider = fakeProvider({
          description: call => (call === 1 ? 'Old summary.' : 'New summary.'),
          onCall: async call => {
            if (call === 1) {
              await t.repo.updateObjective(
                objective.id,
                { instructionText: LONG_2 },
                { origin: AGENT_ORIGIN }
              );
            }
          }
        });
        t.worker.setGenerateOverride(provider.generate);
        await t.runNext();
        const current = await row(t.db, objective.id);
        assert.equal(provider.calls.length, 2, 'the stale result triggered a second pass');
        assert.match(current.description ?? '', /^New summary\./);
        assert.equal(current.instruction_text, LONG_2);
        const { hashObjectiveInstruction } = t.service;
        assert.equal(current.description_instruction_hash, hashObjectiveInstruction(LONG_2));
      } finally {
        await t.finish();
      }
    });

    it('queues a successor when a request lands after the last pass, so no request is lost', async () => {
      const t = await setup('ovld_bw_successor');
      try {
        t.worker.setGenerateOverride(fakeProvider().generate);
        const objective = await t.addAgent(LONG);
        const job = await t.claim();
        assert.ok(job);
        // The edit sees a running job and does not queue a second one.
        await t.repo.updateObjective(
          objective.id,
          { instructionText: LONG_2 },
          { origin: AGENT_ORIGIN }
        );
        assert.equal((await jobsFor(t.db, objective.id)).length, 1);
        // The job finishes without having seen the edit: completion queues a successor.
        const { successorJobId } = await t.jobs.completeObjectiveBriefComposeJob({
          db: t.db,
          jobId: job.id,
          objectiveId: objective.id,
          status: 'succeeded'
        });
        assert.ok(successorJobId);
        await t.runNext();
        const current = await row(t.db, objective.id);
        assert.equal(current.description_status, null);
        assert.equal(
          current.description_instruction_hash,
          t.service.hashObjectiveInstruction(LONG_2)
        );
        // A further completion with nothing pending queues nothing.
        assert.equal((await t.claim()) ?? null, null);
      } finally {
        await t.finish();
      }
    });

    it('never restores a summary removed while the provider call runs; only Summarize re-enables it', async () => {
      const t = await setup('ovld_bw_remove');
      try {
        const objective = await t.addAgent(LONG);
        const provider = fakeProvider({
          onCall: async call => {
            if (call === 1) {
              await t.service.removeObjectiveDescription({
                ctx: t.humanCtx,
                objectiveId: objective.id
              });
            }
          }
        });
        t.worker.setGenerateOverride(provider.generate);
        await t.runNext();
        let current = await row(t.db, objective.id);
        assert.equal(current.description, null);
        assert.equal(current.description_suppressed, true);
        assert.equal(current.title, 'Write the brief worker', 'title generation is independent');

        // Agent edits, catch-up and restart recovery keep it removed.
        await t.repo.updateObjective(
          objective.id,
          { instructionText: LONG_2 },
          { origin: AGENT_ORIGIN }
        );
        const sweep = await t.worker.catchUp(t.db);
        assert.equal(sweep.marked, 0);
        // Drain the title-only work the edit asked for.
        for (let job = await t.claim(); job; job = await t.claim()) {
          await t.worker.processJobForTest(t.db, job);
        }
        current = await row(t.db, objective.id);
        assert.equal(current.description, null);
        assert.equal(current.description_status, null);

        // An agent request is refused; a person's Summarize turns it back on.
        await assert.rejects(
          t.service.requestObjectiveDescriptionGeneration({
            ctx: t.agentCtx,
            objectiveId: objective.id,
            mode: 'summarize'
          }),
          (e: { code?: string }) => e.code === 'description_suppressed'
        );
        await t.service.requestObjectiveDescriptionGeneration({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          mode: 'summarize'
        });
        const [explicit] = (await jobsFor(t.db, objective.id)).filter(j => j.status === 'queued');
        assert.ok(explicit, 'Summarize queues a job without the debounce');
        await t.runNext();
        current = await row(t.db, objective.id);
        assert.equal(current.description_suppressed, false);
        assert.equal(current.description_source, 'generated');
      } finally {
        await t.finish();
      }
    });

    it('retries provider errors with backoff, then records a stable failure that Retry clears', async () => {
      const t = await setup('ovld_bw_retry');
      try {
        const objective = await t.addAgent(LONG);
        t.worker.setGenerateOverride(fakeProvider({ fail: () => true }).generate);
        await t.runNext();
        let current = await row(t.db, objective.id);
        assert.equal(current.description_status, 'pending', 'intent survives a transient error');
        let [job] = await jobsFor(t.db, objective.id);
        assert.equal(job!.status, 'queued');
        assert.equal(job!.attempt_count, 1);

        // Final attempt.
        await t.db.run('UPDATE worker_jobs SET max_attempts = 2 WHERE id = ?', [job!.id]);
        await t.runNext();
        current = await row(t.db, objective.id);
        assert.equal(current.description_status, 'failed');
        assert.equal(current.description_failure_code, 'provider_error');
        assert.equal(current.title_status, 'failed');
        assert.equal(current.description, null, 'the instructions stay the readable text');
        [job] = await jobsFor(t.db, objective.id);
        assert.equal(job!.status, 'failed');

        // Catch-up leaves failed rows alone; Retry re-requests.
        assert.equal((await t.worker.catchUp(t.db)).marked, 0);
        t.worker.setGenerateOverride(fakeProvider().generate);
        await t.service.requestObjectiveDescriptionGeneration({
          ctx: t.humanCtx,
          objectiveId: objective.id,
          mode: 'retry'
        });
        await t.runNext();
        current = await row(t.db, objective.id);
        assert.equal(current.description_status, null);
        assert.equal(current.description_source, 'generated');
      } finally {
        await t.finish();
      }
    });

    it('records unfaithful output and keeps showing the instructions', async () => {
      const t = await setup('ovld_bw_unfaithful');
      try {
        const objective = await t.addAgent(LONG);
        const provider = fakeProvider({
          description: () => 'Edit `backend/invented-file.ts` for people.'
        });
        t.worker.setGenerateOverride(provider.generate);
        await t.runNext();
        const current = await row(t.db, objective.id);
        assert.equal(provider.calls.length, 2, 'one bounded rewrite');
        assert.equal(current.description, null);
        assert.equal(current.description_status, 'failed');
        assert.equal(current.description_failure_code, 'unfaithful_output');
        assert.equal(current.title, 'Write the brief worker', 'the title still publishes');
      } finally {
        await t.finish();
      }
    });

    it('keeps local titles and marks summaries unavailable when no provider is configured', async () => {
      const t = await setup('ovld_bw_noprovider');
      const savedKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      try {
        t.worker.setGenerateOverride(null);
        const objective = await t.addAgent(LONG);
        const localTitle = (await row(t.db, objective.id)).title;
        await t.runNext();
        const current = await row(t.db, objective.id);
        assert.equal(current.title, localTitle, 'the local title stays');
        assert.equal(current.title_status, null);
        assert.equal(current.description_status, 'failed');
        assert.equal(current.description_failure_code, 'provider_unavailable');
        // Objectives stay fully usable: lifecycle writes are unaffected.
        await t.repo.updateObjective(objective.id, { state: 'submitted' });
        assert.equal((await row(t.db, objective.id)).state, 'submitted');
      } finally {
        if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
        await t.finish();
      }
    });

    it('recovers a job whose lease expired and re-enqueues pending rows that lost their job', async () => {
      const t = await setup('ovld_bw_lease');
      try {
        t.worker.setGenerateOverride(fakeProvider().generate);
        const objective = await t.addAgent(LONG);
        // A worker claims the job and dies before finishing.
        const crashed = await t.claim('2998-01-01T00:00:00.000Z');
        assert.ok(crashed);
        assert.equal(await t.claim('2998-01-01T00:00:30.000Z'), null, 'the lease holds');
        // After the lease expires another worker reclaims it.
        const reclaimed = await t.claim('2998-01-01T00:05:00.000Z');
        assert.equal(reclaimed?.id, crashed.id);
        assert.equal(reclaimed?.attempt_count, 2);
        await t.worker.processJobForTest(t.db, reclaimed!);
        assert.equal((await row(t.db, objective.id)).description_status, null);

        // Restart: pending intent with no job (for example written before the
        // worker existed) is re-enqueued by the bounded sweep, once.
        const second = await t.addAgent(LONG_2);
        await t.db.run(
          "DELETE FROM worker_jobs WHERE type = 'overlord.objective.brief.compose.v1' AND status = 'queued'"
        );
        const sweep = await t.worker.catchUp(t.db);
        assert.ok(sweep.recovered >= 1);
        assert.equal((await t.worker.catchUp(t.db)).recovered, 0, 'idempotent');
        assert.equal((await jobsFor(t.db, second.id)).length, 1);
        await t.runNext();
        assert.equal((await row(t.db, second.id)).description_source, 'generated');
      } finally {
        await t.finish();
      }
    });

    it('catches up only eligible open agent-written rows, once, and debounces automatic requests', async () => {
      const t = await setup('ovld_bw_catchup');
      try {
        t.worker.setGenerateOverride(fakeProvider().generate);
        const eligible = await t.addAgent(LONG);
        const person = await t.repo.createObjective({
          missionId: t.mission.id,
          instructionText: LONG
        });
        // Simulate rows that predate automatic intent.
        await t.db.run(
          'UPDATE objectives SET description_status = NULL, description_request_kind = NULL, title_status = NULL WHERE id IN (?, ?)',
          [eligible.id, person.id]
        );
        await t.db.run(
          "DELETE FROM worker_jobs WHERE type = 'overlord.objective.brief.compose.v1'"
        );
        const first = await t.worker.catchUp(t.db);
        assert.equal(first.marked, 1);
        assert.equal((await row(t.db, eligible.id)).description_status, 'pending');
        assert.equal((await row(t.db, person.id)).description_status, null);
        const second = await t.worker.catchUp(t.db);
        assert.equal(second.marked, 0);
        assert.equal((await jobsFor(t.db, eligible.id)).length, 1, 'no duplicate job');

        // Debounce: repeated automatic edits reuse one queued job and push it
        // back, bounded by the maximum debounce.
        const edited = await t.addAgent(LONG);
        const [queued] = await jobsFor(t.db, edited.id);
        await t.repo.updateObjective(
          edited.id,
          { instructionText: LONG_2 },
          { origin: AGENT_ORIGIN }
        );
        await t.repo.updateObjective(
          edited.id,
          { instructionText: LONG },
          { origin: AGENT_ORIGIN }
        );
        const after = await jobsFor(t.db, edited.id);
        assert.equal(after.length, 1);
        assert.equal(after[0]!.id, queued!.id);
        const runAfter = Date.parse(new Date(String(after[0]!.run_after as string)).toISOString());
        const createdAt = Date.parse(
          new Date(String(after[0]!.created_at as string)).toISOString()
        );
        assert.ok(runAfter - createdAt <= t.jobs.OBJECTIVE_BRIEF_MAX_DEBOUNCE_MS);
      } finally {
        await t.finish();
      }
    });
  });
}
