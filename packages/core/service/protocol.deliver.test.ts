import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSessionChannel } from './agent-session/channels.js';
import { resolveRequest } from './agent-session/requests.js';
import { listObjectiveFileChanges } from './changes.js';
import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import { createMissionWithObjectives, insertObjective } from './missions.js';
import { addProjectResource, createProject } from './projects.js';
import {
  askQuestion,
  attachSession,
  deliverSession,
  resumeFollowUp,
  syncChanges,
  updateSession
} from './protocol.js';
import { createRunQueue, enqueueRunQueueEntry, listProjectRunQueues } from './run-queue.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';
import { nowIso } from './util.js';

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

async function submittedMission(ctx: ServiceContext, name: string) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: `Work for ${name}` }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
  return { project, mission, objectiveId: objectives[0]?.id as string };
}

async function entityChangesFor(ctx: ServiceContext, entityType: string, entityId: string) {
  return (await ctx.db.all(
    `SELECT entity_type, entity_id, operation, entity_revision, changed_fields_json,
            project_id, mission_id, objective_id
       FROM entity_changes
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY seq ASC`,
    [entityType, entityId]
  )) as Array<{
    entity_type: string;
    entity_id: string;
    operation: string;
    entity_revision: number | null;
    changed_fields_json: string;
    project_id: string | null;
    mission_id: string | null;
    objective_id: string | null;
  }>;
}

function changedFields(row: { changed_fields_json: string }): string[] {
  return JSON.parse(row.changed_fields_json) as string[];
}

describe('deliverSession mechanical change capture', () => {
  it('records objective change feed coverage when attach moves an objective to executing', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Attach Feed');

    await attachSession({ ctx, missionId: mission.displayId, agentIdentifier: 'codex' });

    const changes = await entityChangesFor(ctx, 'objective', objectiveId);
    const attachChange = changes.find(change => change.operation === 'update');
    assert.ok(attachChange);
    assert.equal(attachChange.project_id, mission.projectId);
    assert.equal(attachChange.mission_id, mission.id);
    assert.equal(attachChange.objective_id, objectiveId);
    assert.deepEqual(changedFields(attachChange), [
      'state',
      'launched_at',
      'started_at',
      'assigned_agent'
    ]);

    await db.close();
  });

  it('emits changed-file feed rows only for accepted ledger observations', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Ledger Feed');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const first = await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/feed.ts',
          idempotencyKey: 'feed-1',
          source: 'declared_edit'
        }
      ]
    });
    assert.equal(first.outcomes[0]?.status, 'accepted');

    const changedFile = (await ctx.db.get(
      `SELECT id FROM changed_files WHERE objective_id = ? AND file_path = ?`,
      [objectiveId, 'src/feed.ts']
    )) as { id: string };
    assert.equal((await entityChangesFor(ctx, 'changed_file', changedFile.id)).length, 1);

    const second = await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/feed.ts',
          idempotencyKey: 'feed-2',
          source: 'declared_edit',
          hookHealth: 'capture_healthy'
        }
      ]
    });
    assert.equal(second.outcomes[0]?.status, 'accepted');
    const afterUpdate = await entityChangesFor(ctx, 'changed_file', changedFile.id);
    assert.deepEqual(
      afterUpdate.map(change => change.operation),
      ['insert', 'update']
    );

    const replay = await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/feed.ts',
          idempotencyKey: 'feed-2',
          source: 'declared_edit',
          hookHealth: 'capture_healthy'
        }
      ]
    });
    assert.equal(replay.outcomes[0]?.status, 'ignored');
    assert.equal((await entityChangesFor(ctx, 'changed_file', changedFile.id)).length, 2);

    await db.close();
  });

  it('records declared update paths once with scoped feed rows and bounded warnings', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Update Declared Paths');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const updated = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Ran the generator.',
      declaredPaths: ['gen/out.ts', 'gen/out.ts', '../escape.ts']
    });

    const row = (await ctx.db.get(
      `SELECT id, source, session_id FROM changed_files WHERE objective_id = ? AND file_path = ?`,
      [objectiveId, 'gen/out.ts']
    )) as { id: string; source: string | null; session_id: string | null };
    assert.equal(row.source, 'agent_declared');
    assert.equal(row.session_id, attached.session.id);
    assert.equal((await entityChangesFor(ctx, 'changed_file', row.id)).length, 1);
    assert.equal((await entityChangesFor(ctx, 'mission_event', updated.eventId)).length, 1);

    const event = (await ctx.db.get(`SELECT payload_json FROM mission_events WHERE id = ?`, [
      updated.eventId
    ])) as { payload_json: string };
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    assert.match(JSON.stringify(payload.declaredPathWarnings), /declaredPaths\[2\]/);

    await db.close();
  });

  it('stamps the lifecycle timestamps the mission objective list is ordered by', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Lifecycle Stamps');

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });
    const afterAttach = (await ctx.db.get(
      `SELECT launched_at, started_at, completed_at FROM objectives WHERE id = ?`,
      [objectiveId]
    )) as { launched_at: string | null; started_at: string | null; completed_at: string | null };
    assert.ok(afterAttach.launched_at);
    assert.ok(afterAttach.started_at);
    assert.equal(afterAttach.completed_at, null);

    // Re-attaching must not move the objective in the list: both stamps are
    // first-wins, so the second attach leaves them exactly as they were.
    await attachSession({ ctx, missionId: mission.displayId, agentIdentifier: 'codex' });
    const afterReattach = (await ctx.db.get(
      `SELECT launched_at, started_at FROM objectives WHERE id = ?`,
      [objectiveId]
    )) as { launched_at: string; started_at: string };
    assert.equal(afterReattach.launched_at, afterAttach.launched_at);
    assert.equal(afterReattach.started_at, afterAttach.started_at);

    await deliverSession({
      ctx,
      sessionKey: attached.sessionKey,
      missionId: mission.displayId,
      summary: 'Delivered the work.'
    });
    const afterDeliver = (await ctx.db.get(
      `SELECT state, started_at, completed_at FROM objectives WHERE id = ?`,
      [objectiveId]
    )) as { state: string; started_at: string; completed_at: string | null };
    assert.equal(afterDeliver.state, 'complete');
    assert.equal(afterDeliver.started_at, afterAttach.started_at);
    assert.ok(afterDeliver.completed_at);

    await db.close();
  });

  it('keeps resume follow-up objective changes in the durable change feed', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Resume Feed');
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered before follow-up.'
    });

    await resumeFollowUp({ ctx, missionId: mission.displayId, objectiveId });

    const changes = await entityChangesFor(ctx, 'objective', objectiveId);
    const latestUpdate = changes.filter(change => change.operation === 'update').at(-1);
    assert.ok(latestUpdate);
    assert.deepEqual(changedFields(latestUpdate), ['state', 'completed_at']);

    await db.close();
  });

  it('records delivery workflow state transitions in the durable change feed', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Deliver Feed');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered with feed coverage.'
    });

    const eventChanges = await entityChangesFor(ctx, 'mission_event', delivered.eventId);
    assert.equal(eventChanges.length, 1);
    assert.equal(eventChanges[0]?.operation, 'insert');
    assert.equal(eventChanges[0]?.mission_id, mission.id);
    assert.equal(eventChanges[0]?.objective_id, objectiveId);

    const objectiveChanges = await entityChangesFor(ctx, 'objective', objectiveId);
    const completeChange = objectiveChanges.find(
      change =>
        change.operation === 'update' &&
        changedFields(change).includes('state') &&
        changedFields(change).includes('completed_at')
    );
    assert.ok(completeChange);

    const sessionChanges = await entityChangesFor(ctx, 'agent_session', attached.session.id);
    const deliveredSessionChange = sessionChanges.find(
      change =>
        change.operation === 'update' &&
        changedFields(change).includes('delivery_state') &&
        changedFields(change).includes('phase') &&
        changedFields(change).includes('ended_at')
    );
    assert.ok(deliveredSessionChange);

    await db.close();
  });

  it('stores normalized delivery evidence with a deterministic fallback and filters Git and QA actions', async () => {
    const { db, ctx } = await setup();
    const { mission } = await submittedMission(ctx, 'Delivery Evidence');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Implemented the durable delivery evidence pipeline.',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            humanActions: [
              {
                action: 'Add the production Gemini credential before enabling composition.',
                reason: 'Phase 3 composition needs an operator-managed provider credential.',
                category: 'environment',
                blocking: false
              },
              { action: 'git push the feature branch', category: 'other' },
              { action: 'Review the code', category: 'other' },
              { action: 'Run the test suite', category: 'other' }
            ],
            tradeoffsMade: [
              {
                decision: 'Persist a deterministic fallback before AI composition.',
                alternativesConsidered: [
                  'Block delivery on Gemini',
                  'Require agents to compose display Markdown'
                ],
                rationale: 'Delivery must remain durable when a provider is unavailable.',
                impact: 'Phase 1 displays agent-authored summary text until composition ships.'
              }
            ],
            knownRisks: ['AI composition is intentionally deferred to Phase 3.'],
            deferredWork: [],
            assumptions: ['The existing payload_json field remains the delivery extension point.']
          }
        }
      }
    });

    const row = (await ctx.db.get(`SELECT payload_json FROM deliveries WHERE id = ?`, [
      delivered.deliveryId
    ])) as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as {
      deliveryReport: {
        schemaVersion: number;
        agentReport: { humanActions: Array<{ action: string; source: string }> };
        presentation: {
          status: string;
          markdown: string;
          humanActions: Array<{ action: string }>;
          tradeoffsMade: Array<{ decision: string; alternativesConsidered: string[] }>;
        };
      };
    };

    assert.equal(payload.deliveryReport.schemaVersion, 1);
    assert.deepEqual(payload.deliveryReport.agentReport.humanActions, [
      {
        id: 'human-action-1',
        action: 'Add the production Gemini credential before enabling composition.',
        reason: 'Phase 3 composition needs an operator-managed provider credential.',
        category: 'environment',
        blocking: false,
        source: 'agent'
      }
    ]);
    assert.equal(payload.deliveryReport.presentation.status, 'pending');
    assert.equal(
      payload.deliveryReport.presentation.markdown,
      'Implemented the durable delivery evidence pipeline.'
    );
    assert.deepEqual(payload.deliveryReport.presentation.humanActions, [
      payload.deliveryReport.agentReport.humanActions[0]
    ]);
    assert.deepEqual(payload.deliveryReport.presentation.tradeoffsMade[0]?.alternativesConsidered, [
      'Block delivery on Gemini',
      'Require agents to compose display Markdown'
    ]);

    const composeJob = (await ctx.db.get(
      `SELECT type, status, payload_json FROM worker_jobs
         WHERE type = 'overlord.delivery.compose.v1'
         ORDER BY created_at DESC LIMIT 1`
    )) as { type: string; status: string; payload_json: string } | undefined;
    assert.ok(composeJob);
    assert.equal(composeJob.status, 'queued');
    assert.equal(JSON.parse(composeJob.payload_json).deliveryId, delivered.deliveryId);

    await db.close();
  });

  it('omits ineligible deferred work from presentation while keeping the agent list', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Deferred Work Eligibility' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        {
          objective: 'Add form validation to the settings page including email and password fields.'
        },
        {
          objective:
            'Implement the CSV export API for the reports page so operators can download filtered rows.'
        }
      ]
    });
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]?.id
    });

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Shipped settings validation.',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            humanActions: [
              {
                action: 'Add GEMINI_API_KEY to the production backend service on Railway.',
                reason: 'Composition needs a provider credential.',
                category: 'environment'
              }
            ],
            deferredWork: [
              {
                title: 'Implement the CSV export API',
                change: 'Implement the CSV export API for the reports page.',
                location: 'backend/reports.ts',
                doneWhen: 'Operators can download filtered rows.'
              },
              {
                title: 'Add the Gemini key',
                change: 'Add GEMINI_API_KEY to the production backend service on Railway.',
                location: 'Railway backend service',
                doneWhen: 'The backend reads the key at startup.'
              },
              {
                title: 'Fix the payroll timezone bug',
                change: 'employee-lifecycle.ts computes the payroll timezone wrongly.',
                location: 'payroll/employee-lifecycle.ts',
                doneWhen: 'Payroll dates match the company timezone.'
              }
            ]
          }
        }
      }
    });

    const row = (await ctx.db.get(`SELECT payload_json FROM deliveries WHERE id = ?`, [
      delivered.deliveryId
    ])) as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as {
      deliveryReport: {
        agentReport: { deferredWork: Array<{ id: string; title: string }> };
        presentation: { deferredWork: Array<{ id: string; title: string }> };
      };
    };

    assert.equal(payload.deliveryReport.agentReport.deferredWork.length, 3);
    assert.deepEqual(payload.deliveryReport.presentation.deferredWork, [
      payload.deliveryReport.agentReport.deferredWork[2]
    ]);

    await db.close();
  });

  it('rejects string or malformed deferred work with invalid_input and persists nothing', async () => {
    const { db, ctx } = await setup();
    const { mission } = await submittedMission(ctx, 'Strict Deferred Work');
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    const deliverWith = (deferredWork: unknown) =>
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey: attached.sessionKey,
        summary: 'Delivery with deferred work.',
        payloadJson: { deliveryReport: { schemaVersion: 1, agentReport: { deferredWork } } }
      });
    const valid = {
      title: 'Advance the fake clock before the second retry',
      change: 'The test never advances the fake clock between attempts.',
      location: 'backend/sync-worker.test.ts',
      doneWhen: 'The test passes 20 consecutive runs.'
    };
    const invalidInput = (pattern: RegExp) => (error: unknown) =>
      error instanceof ServiceError &&
      error.code === 'invalid_input' &&
      pattern.test(error.message);

    await assert.rejects(
      deliverWith(['Investigate the payroll timezone bug.']),
      invalidInput(/deferredWork\[0\] must be an object.*string items are not accepted/)
    );
    await assert.rejects(
      deliverWith([valid, { ...valid, title: 'x'.repeat(81) }]),
      invalidInput(/deferredWork\[1\]\.title/)
    );
    await assert.rejects(deliverWith([{ ...valid, doneWhen: '  ' }]), invalidInput(/doneWhen/));
    await assert.rejects(
      deliverWith([{ ...valid, why: 'extra' }]),
      invalidInput(/deferredWork\[0\]/)
    );
    await assert.rejects(deliverWith('not a list'), invalidInput(/must be an array/));

    const count = (await ctx.db.get(`SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`, [
      mission.id
    ])) as { n: number };
    assert.equal(count.n, 0);

    await db.close();
  });

  it('salvages malformed or oversized delivery evidence without blocking completion', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Invalid Delivery Evidence');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'This delivers despite malformed advisory evidence.',
      payloadJson: {
        deliveryReport: {
          agentReport: { knownRisks: Array.from({ length: 13 }, (_, index) => `Risk ${index + 1}`) }
        }
      }
    });
    const payload = (await ctx.db.get(`SELECT payload_json FROM deliveries WHERE id = ?`, [
      delivered.deliveryId
    ])) as { payload_json: string };
    assert.ok(JSON.parse(payload.payload_json).deliveryReport.warnings.length > 0);

    const objective = (await ctx.db.get(`SELECT state FROM objectives WHERE id = ?`, [
      objectiveId
    ])) as {
      state: string;
    };
    assert.equal(objective.state, 'complete');
    await db.close();
  });

  it('records blocking question mission events in the durable change feed', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Ask Feed');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const asked = await askQuestion({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      question: 'Which path should I take?'
    });

    const eventChanges = await entityChangesFor(ctx, 'mission_event', asked.eventId);
    assert.equal(eventChanges.length, 1);
    assert.equal(eventChanges[0]?.operation, 'insert');
    assert.equal(eventChanges[0]?.project_id, mission.projectId);
    assert.equal(eventChanges[0]?.mission_id, mission.id);
    assert.equal(eventChanges[0]?.objective_id, objectiveId);

    await db.close();
  });

  it('creates and links an answerable choice when the attached session has a channel', async () => {
    const { db, ctx } = await setup();
    const { project, mission, objectiveId } = await submittedMission(ctx, 'Ask Request');
    const channel = await createSessionChannel({
      ctx,
      missionId: mission.id,
      objectiveId,
      projectId: project.id
    });
    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      sessionChannelId: channel.channel.id
    });

    const asked = await askQuestion({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      question: 'Choose a delivery path',
      allowsFreeText: false,
      options: [{ optionId: 'runner', label: 'Runner queue', kind: 'delivery_path' }]
    });
    const row = (await ctx.db.get(
      `SELECT id, kind, allows_free_text, details_json FROM agent_requests
         WHERE json_extract(details_json, '$.missionEventId') = ?`,
      [asked.eventId]
    )) as { id: string; kind: string; allows_free_text: number; details_json: string } | undefined;
    assert.ok(row);
    assert.equal(row.kind, 'choice');
    assert.equal(row.allows_free_text, 0);
    const event = (await ctx.db.get(`SELECT payload_json FROM mission_events WHERE id = ?`, [
      asked.eventId
    ])) as { payload_json: string };
    assert.equal(JSON.parse(event.payload_json).agentRequestId, row.id);

    await db.close();
  });

  it('records an answer and unblocks the session when a question resolves', async () => {
    const { db, ctx } = await setup();
    const { project, mission, objectiveId } = await submittedMission(ctx, 'Resolve Question');
    const channel = await createSessionChannel({
      ctx,
      missionId: mission.id,
      objectiveId,
      projectId: project.id
    });
    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      sessionChannelId: channel.channel.id
    });
    const asked = await askQuestion({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      question: 'Which database?'
    });
    const request = (await ctx.db.get(
      `SELECT id, revision FROM agent_requests
         WHERE json_extract(details_json, '$.missionEventId') = ?`,
      [asked.eventId]
    )) as { id: string; revision: number };

    const resolved = await resolveRequest({
      ctx,
      requestId: request.id,
      resolution: { text: 'SQLite' },
      expectedRevision: request.revision
    });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.request.application_state, 'emitted');
    const answer = (await ctx.db.get(
      `SELECT phase, summary FROM mission_events WHERE mission_id = ? AND type = 'answer'`,
      [mission.id]
    )) as { phase: string; summary: string } | undefined;
    assert.deepEqual(answer, { phase: 'execute', summary: 'SQLite' });
    const session = (await ctx.db.get(`SELECT phase FROM agent_sessions WHERE id = ?`, [
      attached.session.id
    ])) as { phase: string };
    assert.equal(session.phase, 'execute');

    await db.close();
  });

  it('does not raise an awaiting-approval event for a blank draft slot after delivery', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Deliver Blank Slot Approval' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Complete current objective' }]
    });
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered current objective.'
    });

    const approvalEvents = (await ctx.db.all(
      `SELECT id FROM mission_events WHERE mission_id = ? AND type = 'awaiting_approval'`,
      [mission.id]
    )) as Array<{ id: string }>;
    assert.deepEqual(approvalEvents, []);

    await db.close();
  });

  it('raises an awaiting-approval event for an authored next objective after delivery', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Deliver Authored Approval' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Complete current objective' },
        { objective: 'Next authored objective' }
      ]
    });
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered current objective.'
    });

    const approvalEvents = (await ctx.db.all(
      `SELECT summary FROM mission_events WHERE mission_id = ? AND type = 'awaiting_approval'`,
      [mission.id]
    )) as Array<{ summary: string }>;
    assert.equal(approvalEvents.length, 1);

    await db.close();
  });

  it('leaves future objectives untouched until Run Queue dispatch', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Deliver Future Before Placeholder' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Complete current objective' }]
    });
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    // Blank slots are no longer persisted; this stands in for a legacy row left
    // over from when the mission panel's empty field was written to the database.
    const placeholder = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: '',
      state: 'draft'
    });
    assert.equal(placeholder.state, 'draft');

    const future = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: 'Continue with real objective',
      state: 'draft'
    });
    assert.equal(future.state, 'future');

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered current objective.'
    });

    const rows = (await ctx.db.all(
      `SELECT id, instruction_text, state
         FROM objectives
         WHERE mission_id = ? AND deleted_at IS NULL
         ORDER BY position ASC`,
      [mission.id]
    )) as Array<{ id: string; instruction_text: string; state: string }>;
    assert.deepEqual(
      rows.map(row => row.state),
      ['complete', 'draft', 'future']
    );
    assert.equal(rows[2]?.id, future.id);
    assert.equal(rows[2]?.instruction_text, 'Continue with real objective');

    const placeholderRow = (await ctx.db.get(`SELECT deleted_at FROM objectives WHERE id = ?`, [
      placeholder.id
    ])) as { deleted_at: string | null };
    assert.equal(placeholderRow.deleted_at, null);

    await db.close();
  });

  it('queues durable Run Queue dispatch instead of launching auto-advance inline', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Auto Advance Launch Flags' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First objective' },
        { objective: 'Second objective', autoAdvance: true }
      ]
    });
    const secondObjectiveId = objectives[1]?.id as string;

    // createExecutionRequest resolves the working directory from the project's
    // primary resource, so the auto-advance path needs one linked.
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-auto-advance-'),
      isPrimary: true
    });

    // Workspace catalog launch default for the agent — the lowest-priority
    // launch-config source the shared resolver must still honor on the
    // auto-advance path (previously this path stamped an empty config).
    await ctx.db.run(`UPDATE workspaces SET settings_json = ? WHERE id = ?`, [
      JSON.stringify({
        agentCatalog: {
          agents: {
            claude: { launchDefaults: { preCommand: 'nvm use 20', flags: [{ name: '--verbose' }] } }
          }
        }
      }),
      ctx.workspace.id
    ]);

    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'claude'
    });

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered first objective; auto-advance the second.'
    });

    const request = (await ctx.db.get(
      `SELECT launch_flags_json, requested_agent, requested_source
         FROM execution_requests
        WHERE objective_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [secondObjectiveId]
    )) as
      | { launch_flags_json: string; requested_agent: string | null; requested_source: string }
      | undefined;
    assert.equal(request, undefined, 'delivery must not create an execution request inline');
    const job = await ctx.db.get<{ payload_json: string }>(
      `SELECT payload_json FROM worker_jobs WHERE type = 'overlord.run-queue.dispatch.v1' AND status = 'queued'`
    );
    assert.ok(job);
    assert.equal(JSON.parse(job.payload_json).projectId, project.id);

    await db.close();
  });

  it('retires a Run Queue once delivery completes its last entry', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Deliver Retires Queue' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Only queued objective' }]
    });
    const pristine = await createRunQueue(ctx.db, project.id, 'Pristine', null);
    await enqueueRunQueueEntry(ctx.db, project.id, objectives[0]?.id as string);
    assert.equal((await listProjectRunQueues(ctx.db, project.id)).queues.length, 2);

    const attached = await attachSession({ ctx, missionId: mission.displayId });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivered the only queued objective.'
    });

    // The completed queue is gone; the never-used manual queue stays.
    assert.deepEqual(
      (await listProjectRunQueues(ctx.db, project.id)).queues.map(queue => queue.id),
      [pristine.id]
    );

    await db.close();
  });

  it('delivers with synchronized changed files without any per-file annotation', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Deliver Capture');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/feature.ts',
          idempotencyKey: 'deliver-feature-1',
          source: 'declared_edit'
        }
      ]
    });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Deliver without annotations'
    });

    const files = await listObjectiveFileChanges({
      ctx,
      missionId: mission.displayId,
      objectiveId
    });
    assert.equal(files.items.length, 1);
    assert.equal(files.items[0]?.filePath, 'src/feature.ts');
    assert.equal(files.items[0]?.source, 'declared_edit');

    await db.close();
  });

  it('requires no no-file-change override when evidence exists', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'No File Changes');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/leftover.ts',
          idempotencyKey: 'leftover-1',
          source: 'declared_edit'
        }
      ]
    });

    const result = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Delivery remains independent from change metadata.'
    });
    assert.ok(result.deliveryId);

    const objective = (await ctx.db.get(`SELECT state FROM objectives WHERE id = ?`, [
      objectiveId
    ])) as { state: string };
    assert.equal(objective.state, 'complete');

    await db.close();
  });

  it('stores declared delivery paths and keeps unsafe paths non-blocking', async () => {
    const { db, ctx } = await setup();
    const { mission, objectiveId } = await submittedMission(ctx, 'Deliver Declared Paths');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Deliver with declared generator output.',
      declaredPaths: ['database/sqlite/migrations/20990101000000_x.sql', '/abs/host.ts']
    });

    const files = await listObjectiveFileChanges({
      ctx,
      missionId: mission.displayId,
      objectiveId
    });
    assert.deepEqual(
      files.items.map(item => [item.filePath, item.source]),
      [['database/sqlite/migrations/20990101000000_x.sql', 'agent_declared']]
    );
    const payload = (await ctx.db.get(`SELECT payload_json FROM deliveries WHERE id = ?`, [
      delivered.deliveryId
    ])) as { payload_json: string };
    const report = JSON.parse(payload.payload_json).deliveryReport;
    assert.match(JSON.stringify(report.warnings), /declaredPaths\[1\]/);

    await db.close();
  });

  it('delivers with objective-scoped no-session evidence', async () => {
    const { db, ctx } = await setup();
    const { project, mission, objectiveId } = await submittedMission(ctx, 'Objective Scope');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    // Sessionless record-work evidence remains visible on the objective and
    // cannot block a later attached delivery.
    const now = nowIso();
    await ctx.db.run(
      `INSERT INTO changed_files
           (id, workspace_id, project_id, mission_id, objective_id, session_id, file_path, source,
            first_observed_at, last_observed_at, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'agent_declared', ?, ?, ?, ?, 1)`,
      [
        'cf-scope-1',
        ctx.workspace.id,
        project.id,
        mission.id,
        objectiveId,
        'src/shared.ts',
        now,
        now,
        now,
        now
      ]
    );

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Deliver objective'
    });
    assert.ok(delivered.deliveryId);

    await db.close();
  });

  it('rejects an invalid artifact type with a clean validation error', async () => {
    const { db, ctx } = await setup();
    const { mission } = await submittedMission(ctx, 'Invalid Artifact Type');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await assert.rejects(
      () =>
        deliverSession({
          ctx,
          missionId: mission.displayId,
          sessionKey: attached.sessionKey,
          summary: 'Deliver with a bad artifact type.',
          artifacts: [{ type: 'not_a_real_type', label: 'Bad', content: 'nope' }]
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'validation_error' &&
        error.message.includes('Artifact type must be')
    );

    await db.close();
  });

  it('inserts a valid delivery artifact through the shared writer', async () => {
    const { db, ctx } = await setup();
    const { mission } = await submittedMission(ctx, 'Valid Artifact Type');
    const attached = await attachSession({ ctx, missionId: mission.displayId });

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Deliver with a note artifact.',
      artifacts: [{ type: 'note', label: 'Ship notes', content: 'Done.' }]
    });

    const row = (await db.get(
      `SELECT type, label, content_text, delivery_id FROM artifacts WHERE mission_id = ?`,
      [mission.id]
    )) as {
      type: string;
      label: string;
      content_text: string | null;
      delivery_id: string | null;
    };
    assert.equal(row.type, 'note');
    assert.equal(row.label, 'Ship notes');
    assert.equal(row.content_text, 'Done.');
    assert.ok(row.delivery_id);

    await db.close();
  });
});
