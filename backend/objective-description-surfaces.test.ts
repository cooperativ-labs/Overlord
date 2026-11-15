import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Objective descriptions across the REST, protocol (CLI) and hosted MCP
 * surfaces (coo:1275.m0jd, ADR 0059): authored descriptions on every create and
 * edit route, the human/agent permission split, removal suppression that only
 * a person's Summarize clears, advisory style warnings, stable failure codes,
 * presentation-only writes, and instruction-only agent contexts.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-objective-description-surfaces-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const {
  createMission,
  createObjective,
  createProject,
  getMissionDetail,
  requestObjectiveDescription,
  updateObjective
} = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { getObjectivePrompt } = await import('./execution/launch.ts');
const { listActivityFeed } = await import('./activity-feed.ts');
const { ApiError } = await import('./errors.ts');
const { ServiceError } = await import('../packages/core/service/errors.ts');
const { updateObjectiveProtocolBody } = await import('../mcp/server.ts');
const { overlordMcpToolDefinitions } = await import('@overlord/contract/mcp-tools');

const LONG =
  `Rebuild the objective summary surfaces. ${'Keep every prohibition and file path exact. '.repeat(9)}`.trim();
const LONG_2 =
  `Rewrite the delivery card. ${'Do not change the launch payload or the run queue. '.repeat(8)}`.trim();
const AGENT_SUMMARY =
  'Add summary fields to the objective API. People see a short summary before they launch. The work is complete when the API returns the summary.';

type Objective = {
  id: string;
  displayId: string;
  state: string;
  instructionText?: string;
  objective?: string;
  updatedAt?: string;
  revision?: number;
  description?: string | null;
  descriptionSource?: string | null;
  descriptionStatus?: string | null;
  descriptionSuppressed?: boolean;
  descriptionRevision?: number;
  descriptionEligible?: boolean;
  descriptionAuthorWorkspaceUserId?: string | null;
  descriptionAuthorAgent?: string | null;
  descriptionStale?: boolean;
  descriptionFailureCode?: string | null;
  titleSource?: string | null;
  warnings?: Array<{ code: string; rule?: string; message: string }>;
};
type CreatedMission = { mission: { id: string; displayId: string }; objectives: Objective[] };

function isCode(status: number, code: string) {
  return (error: unknown) =>
    (error instanceof ApiError || error instanceof ServiceError) &&
    error.status === status &&
    error.code === code;
}

async function protocolMission(objectives: unknown[]): Promise<CreatedMission> {
  const project = await createProject({ name: `Descriptions ${Date.now()} ${Math.random()}` });
  return (await runProtocolSubcommand('create', {
    flags: { '--project-id': project.id, '--objectives-json': JSON.stringify(objectives) }
  })) as CreatedMission;
}

async function restObjective(id: string): Promise<Objective> {
  const row = await db.prepare(`SELECT mission_id FROM objectives WHERE id = ?`).get(id);
  const detail = await getMissionDetail((row as { mission_id: string }).mission_id);
  const found = detail.objectives.find(objective => objective.id === id);
  assert.ok(found, `objective ${id} is in its mission detail`);
  return found as unknown as Objective;
}

// ---- REST (people) -----------------------------------------------------------

test('REST create stores a person-authored description and never requests a summary', async () => {
  const project = await createProject({ name: `REST descriptions ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ objective: LONG, description: 'A short summary written by a person.' }]
  });
  const [first] = mission.objectives as unknown as Objective[];
  assert.ok(first);
  assert.equal(first.description, 'A short summary written by a person.');
  assert.equal(first.descriptionSource, 'user');
  assert.equal(first.descriptionStatus, null);
  assert.equal(first.descriptionEligible, true);
  assert.equal(first.descriptionStale, false);
  assert.ok(first.descriptionAuthorWorkspaceUserId, 'the editor is attributed');

  // A person's own long instructions get no automatic summary (plan §4.1).
  const plain = (await createObjective({
    missionId: mission.id,
    instructionText: LONG
  })) as unknown as Objective;
  assert.equal(plain.description, null);
  assert.equal(plain.descriptionStatus, null);
  assert.equal(plain.descriptionSuppressed, false);
});

test('REST description edits are presentation-only and allowed after completion', async () => {
  const project = await createProject({ name: `REST after completion ${Date.now()}` });
  const mission = await createMission({ projectId: project.id, firstObjective: LONG });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'complete' });
  const before = await restObjective(objective.id);

  const edited = (await updateObjective(objective.id, {
    description: 'The summary after the work is complete.',
    expectedDescriptionRevision: before.descriptionRevision
  })) as unknown as Objective;
  assert.equal(edited.state, 'complete');
  assert.equal(edited.instructionText, LONG);
  assert.equal(edited.description, 'The summary after the work is complete.');
  assert.equal(edited.descriptionSource, 'user');
  assert.equal(edited.updatedAt, before.updatedAt, 'updatedAt orders the feed; it must not move');
  assert.equal(edited.revision, (before.revision ?? 0) + 1);
  assert.equal(edited.descriptionRevision, (before.descriptionRevision ?? 0) + 1);

  // Instruction edits stay locked after execution: the description route does
  // not unlock them.
  await assert.rejects(
    updateObjective(objective.id, { instructionText: 'New text', description: 'x' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  // A stale editor gets a stable conflict and writes nothing.
  await assert.rejects(
    updateObjective(objective.id, {
      description: 'Stale edit',
      expectedDescriptionRevision: before.descriptionRevision
    }),
    isCode(409, 'description_conflict')
  );
  assert.equal(
    (await restObjective(objective.id)).description,
    'The summary after the work is complete.'
  );

  // Omitting description (an older client) leaves it unchanged.
  const titled = (await updateObjective(objective.id, {
    title: 'Retitled'
  })) as unknown as Objective;
  assert.equal(titled.description, 'The summary after the work is complete.');

  // Over-long text is rejected with a stable code.
  await assert.rejects(
    updateObjective(objective.id, { description: 'x'.repeat(4001) }),
    isCode(400, 'description_too_long')
  );
});

test('REST Remove persists until a person selects Summarize; Retry and eligibility codes', async () => {
  const project = await createProject({ name: `REST remove ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ objective: LONG, description: 'Remove me.' }]
  });
  const id = mission.objectives[0]!.id;

  const removed = (await updateObjective(id, { description: null })) as unknown as Objective;
  assert.equal(removed.description, null);
  assert.equal(removed.descriptionSuppressed, true);
  assert.equal(removed.descriptionStatus, null);

  await assert.rejects(
    requestObjectiveDescription(id, { mode: 'retry' }),
    isCode(409, 'description_not_failed')
  );
  await assert.rejects(
    requestObjectiveDescription(id, { mode: 'later' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  const summarized = (await requestObjectiveDescription(id, {
    mode: 'summarize'
  })) as unknown as Objective;
  assert.equal(summarized.descriptionSuppressed, false);
  assert.equal(summarized.descriptionStatus, 'pending');
  const jobs = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM worker_jobs
        WHERE type = 'overlord.objective.brief.compose.v1' AND payload_json LIKE ?`
    )
    .get(`%${id}%`);
  assert.ok(Number((jobs as { n: number }).n) >= 1, 'Summarize enqueues the brief job');

  // A failed generation exposes a stable code and Retry re-requests it.
  await db
    .prepare(
      `UPDATE objectives SET description_status = 'failed', description_failure_code = 'provider_error' WHERE id = ?`
    )
    .run(id);
  const failed = await restObjective(id);
  assert.equal(failed.descriptionStatus, 'failed');
  assert.equal(failed.descriptionFailureCode, 'provider_error');
  const retried = (await requestObjectiveDescription(id, {
    mode: 'retry'
  })) as unknown as Objective;
  assert.equal(retried.descriptionStatus, 'pending');
  assert.equal(retried.descriptionFailureCode, null);

  const short = await createObjective({ missionId: mission.id, instructionText: 'Short task' });
  await assert.rejects(
    requestObjectiveDescription(short.id, { mode: 'summarize' }),
    isCode(409, 'description_not_eligible')
  );
  assert.equal((short as unknown as Objective).descriptionEligible, false);
});

// ---- Protocol / CLI / hosted MCP (agents) --------------------------------------

test('unattached agent creates qualify for automatic summaries; authored text gets warnings', async () => {
  const created = await protocolMission([
    { objective: LONG },
    { objective: LONG_2, description: AGENT_SUMMARY },
    { objective: LONG_2, description: 'This should probably work.\n\n- a bullet' }
  ]);
  const [automatic, authored, styled] = created.objectives;
  assert.ok(automatic && authored && styled);

  const automaticRow = await restObjective(automatic.id);
  assert.equal(automaticRow.descriptionStatus, 'pending', 'no session is needed to qualify');
  assert.equal(automaticRow.description, null);

  const authoredRow = await restObjective(authored.id);
  assert.equal(authoredRow.description, AGENT_SUMMARY);
  assert.equal(authoredRow.descriptionSource, 'agent');
  assert.equal(authoredRow.descriptionStatus, null);
  assert.equal(authored.warnings, undefined, 'clean text carries no warnings');

  const rules = (styled.warnings ?? []).map(warning => warning.rule);
  assert.ok(rules.includes('ambiguous_modal'), rules.join(','));
  assert.ok(rules.includes('not_prose'), rules.join(','));
  assert.ok(styled.warnings!.every(warning => warning.code === 'description_style'));
  assert.equal((await restObjective(styled.id)).descriptionSource, 'agent', 'stored as written');

  // The created-objective summaries stay the agent context shape.
  for (const objective of created.objectives) {
    assert.equal('description' in objective, false);
  }
});

test('create --objective-description sets the single objective; JSON items use their own field', async () => {
  const project = await createProject({ name: `Single description ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': LONG,
      '--objective-description': AGENT_SUMMARY
    }
  })) as CreatedMission;
  assert.equal((await restObjective(created.objectives[0]!.id)).description, AGENT_SUMMARY);

  const fromFile = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': LONG,
      '--objective-description-file': '-'
    },
    fileInputs: { '--objective-description-file': AGENT_SUMMARY }
  })) as CreatedMission;
  assert.equal((await restObjective(fromFile.objectives[0]!.id)).description, AGENT_SUMMARY);

  await assert.rejects(
    runProtocolSubcommand('create', {
      flags: {
        '--project-id': project.id,
        '--objectives-json': JSON.stringify([{ objective: LONG }]),
        '--objective-description': AGENT_SUMMARY
      }
    }),
    isCode(400, 'invalid_input')
  );
  await assert.rejects(
    protocolMission([{ objective: LONG, description: 42 }]),
    isCode(400, 'invalid_input')
  );
});

test('add-objectives carries per-item descriptions and warnings', async () => {
  const created = await protocolMission([{ objective: 'First' }]);
  const added = (await runProtocolSubcommand('add-objectives', {
    flags: {
      '--mission-id': created.mission.id,
      '--objectives-json': JSON.stringify([
        { objective: LONG, description: AGENT_SUMMARY },
        { objective: LONG_2, description: "It won't break anything." }
      ])
    }
  })) as Objective[];
  assert.equal(added.length, 2);
  assert.equal((await restObjective(added[0]!.id)).description, AGENT_SUMMARY);
  assert.ok(added[1]!.warnings?.some(warning => warning.rule === 'contraction'));
});

test('agent description edits stay in draft; Remove suppresses until a person summarizes', async () => {
  const created = await protocolMission([{ objective: LONG }]);
  const objective = created.objectives[0]!;

  const set = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objective.displayId,
      '--description-file': '-',
      '--agent': 'claude-code'
    },
    fileInputs: { '--description-file': AGENT_SUMMARY }
  })) as Objective;
  assert.equal(set.description, AGENT_SUMMARY);
  assert.equal(set.descriptionSource, 'agent');
  assert.equal(set.descriptionAuthorAgent, 'claude-code');
  assert.deepEqual(set.warnings, []);

  // Empty text is Remove, from an agent as well.
  const removed = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--description': '' }
  })) as Objective;
  assert.equal(removed.description, null);
  assert.equal(removed.descriptionSuppressed, true);

  // An agent cannot silently restore a summary a person removed.
  const refused = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--description': AGENT_SUMMARY }
  })) as Objective;
  assert.equal(refused.description, null);
  assert.deepEqual(
    refused.warnings?.map(warning => warning.code),
    ['description_suppressed']
  );
  for (const mode of ['summarize', 'regenerate']) {
    await assert.rejects(
      runProtocolSubcommand('update-objective', {
        flags: { '--objective-id': objective.id, '--description-request': mode }
      }),
      isCode(409, 'description_suppressed')
    );
  }
  // Instruction edits by an agent do not clear suppression either.
  await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--instruction-text': LONG_2 }
  });
  const afterEdit = await restObjective(objective.id);
  assert.equal(afterEdit.descriptionSuppressed, true);
  assert.equal(afterEdit.descriptionStatus, null);

  // A person's Summarize is the only way back.
  const summarized = (await requestObjectiveDescription(objective.id, {
    mode: 'summarize'
  })) as unknown as Objective;
  assert.equal(summarized.descriptionSuppressed, false);
  assert.equal(summarized.descriptionStatus, 'pending');

  // Request validation.
  await assert.rejects(
    runProtocolSubcommand('update-objective', {
      flags: { '--objective-id': objective.id, '--description-request': 'later' }
    }),
    isCode(400, 'invalid_input')
  );
  await assert.rejects(
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': objective.id,
        '--description-request': 'regenerate',
        '--description': 'x'
      }
    }),
    isCode(400, 'invalid_input')
  );

  // Outside draft, an agent can neither edit the description nor request one;
  // a person still can.
  await updateObjective(objective.id, { state: 'submitted' });
  const draftOnlyFlags: Array<Record<string, string>> = [
    { '--description': AGENT_SUMMARY },
    { '--description-request': 'regenerate' }
  ];
  for (const flags of draftOnlyFlags) {
    await assert.rejects(
      runProtocolSubcommand('update-objective', {
        flags: { '--objective-id': objective.id, ...flags }
      }),
      isCode(400, 'description_not_editable')
    );
  }
  const human = (await updateObjective(objective.id, {
    description: 'A person edits a submitted objective.'
  })) as unknown as Objective;
  assert.equal(human.descriptionSource, 'user');
  // Title edits by agents keep their any-state behavior.
  const retitled = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--title': 'Agent title in any state' }
  })) as Objective & { title: string };
  assert.equal(retitled.title, 'Agent title in any state');
});

test('agent Retry never clears removal suppression', async () => {
  const created = await protocolMission([{ objective: LONG }]);
  const id = created.objectives[0]!.id;
  await db
    .prepare(
      `UPDATE objectives SET description_status = 'failed', description_failure_code = 'provider_error' WHERE id = ?`
    )
    .run(id);
  const retried = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': id, '--description-request': 'retry' }
  })) as Objective;
  assert.equal(retried.descriptionStatus, 'pending');
  assert.equal(retried.descriptionSuppressed, false);
});

// ---- Instruction-only execution contexts ----------------------------------------

test('attach, load-context and the launch prompt never carry the description', async () => {
  const MARKER = 'Summary marker that must never reach the executing agent.';
  const created = await protocolMission([
    { objective: LONG, description: MARKER },
    { objective: LONG_2, description: MARKER }
  ]);
  const [first] = created.objectives;
  assert.ok(first);

  const context = await runProtocolSubcommand('load-context', {
    flags: { '--objective-id': first.displayId }
  });
  assert.equal(JSON.stringify(context).includes(MARKER), false, 'load-context');

  const attached = await runProtocolSubcommand('attach', {
    flags: { '--objective-id': first.displayId, '--agent': 'codex' }
  });
  const attachedJson = JSON.stringify(attached);
  assert.equal(attachedJson.includes(MARKER), false, 'attach');
  assert.ok(attachedJson.includes('Keep every prohibition'), 'the instructions are present');

  const prompt = await getObjectivePrompt(first.id);
  assert.equal(JSON.stringify(prompt).includes(MARKER), false, 'launch prompt');

  // The mission detail (a presentation read) does carry it.
  assert.equal((await restObjective(first.id)).description, MARKER);
});

test('the activity feed carries a presentation-only summary preview', async () => {
  const project = await createProject({ name: `Feed descriptions ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ objective: LONG, description: 'Feed summary.' }]
  });
  await updateObjective(mission.objectives[0]!.id, { state: 'executing' });
  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);
  assert.ok(item && item.kind === 'mission_run');
  assert.equal(item.descriptionPreview, 'Feed summary.');
  assert.ok(item.instructionPreview.startsWith('Rebuild the objective'));
});

test('a description edit raises no notification and moves no activity ordering', async () => {
  const created = await protocolMission([{ objective: LONG }]);
  const id = created.objectives[0]!.id;
  const count = async () =>
    Number(
      (
        (await db
          .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE objective_id = ?`)
          .get(id)) as { n: number } | undefined
      )?.n ?? 0
    );
  const before = await count();
  const original = await restObjective(id);
  await updateObjective(id, { description: 'A person edits the summary.' });
  await requestObjectiveDescription(id, { mode: 'regenerate' });
  assert.equal(await count(), before);
  assert.equal((await restObjective(id)).updatedAt, original.updatedAt);
});

test('hosted MCP exposes the same description operations as the protocol', async () => {
  const tools = overlordMcpToolDefinitions({ defaultAgent: 'claude-code' });
  const props = (name: string) =>
    (tools.find(tool => tool.name === name)!.inputSchema as { properties: Record<string, any> })
      .properties;
  assert.ok(props('overlord_create_mission').description);
  assert.ok(props('overlord_add_objectives').objectives.items.properties.description);
  assert.deepEqual(props('overlord_update_objective').descriptionRequest.enum, [
    'summarize',
    'regenerate',
    'retry'
  ]);

  const created = await protocolMission([{ objective: LONG }]);
  const objective = created.objectives[0]!;
  const viaMcp = (await runProtocolSubcommand(
    'update-objective',
    updateObjectiveProtocolBody({ objectiveId: objective.displayId, description: AGENT_SUMMARY })
  )) as Objective;
  assert.equal(viaMcp.description, AGENT_SUMMARY);
  assert.equal(viaMcp.descriptionSource, 'agent');

  // An empty string is Remove over MCP too.
  const removed = (await runProtocolSubcommand(
    'update-objective',
    updateObjectiveProtocolBody({ objectiveId: objective.id, description: '' })
  )) as Objective;
  assert.equal(removed.descriptionSuppressed, true);
  await assert.rejects(
    runProtocolSubcommand(
      'update-objective',
      updateObjectiveProtocolBody({ objectiveId: objective.id, descriptionRequest: 'summarize' })
    ),
    isCode(409, 'description_suppressed')
  );
  assert.throws(() => updateObjectiveProtocolBody({ objectiveId: objective.id }));
});
