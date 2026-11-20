import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Objective summaries across the REST, protocol (CLI) and hosted MCP
 * surfaces (coo:1275.m0jd, ADR 0059): authored summaries on every create and
 * edit route, the human/agent permission split, removal suppression that only
 * a person's Summarize clears, advisory style warnings, stable failure codes,
 * presentation-only writes, and instruction-only agent contexts.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-objective-summary-surfaces-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const {
  createMission,
  createObjective,
  createProject,
  getMissionDetail,
  requestObjectiveSummary,
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
  summary?: string | null;
  summarySource?: string | null;
  summaryStatus?: string | null;
  summarySuppressed?: boolean;
  summaryRevision?: number;
  summaryEligible?: boolean;
  summaryAuthorWorkspaceUserId?: string | null;
  summaryAuthorAgent?: string | null;
  summaryStale?: boolean;
  summaryFailureCode?: string | null;
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
  const project = await createProject({ name: `Summaries ${Date.now()} ${Math.random()}` });
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

test('REST create stores a person-authored summary and never requests a summary', async () => {
  const project = await createProject({ name: `REST summaries ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ instructions: LONG, summary: 'A short summary written by a person.' }]
  });
  const [first] = mission.objectives as unknown as Objective[];
  assert.ok(first);
  assert.equal(first.summary, 'A short summary written by a person.');
  assert.equal(first.summarySource, 'user');
  assert.equal(first.summaryStatus, null);
  assert.equal(first.summaryEligible, true);
  assert.equal(first.summaryStale, false);
  assert.ok(first.summaryAuthorWorkspaceUserId, 'the editor is attributed');

  // A person's own long instructions get no automatic summary (plan §4.1).
  const plain = (await createObjective({
    missionId: mission.id,
    instructionText: LONG
  })) as unknown as Objective;
  assert.equal(plain.summary, null);
  assert.equal(plain.summaryStatus, null);
  assert.equal(plain.summarySuppressed, false);
});

test('REST summary edits are presentation-only and allowed after completion', async () => {
  const project = await createProject({ name: `REST after completion ${Date.now()}` });
  const mission = await createMission({ projectId: project.id, firstObjective: LONG });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'complete' });
  const before = await restObjective(objective.id);

  const edited = (await updateObjective(objective.id, {
    summary: 'The summary after the work is complete.',
    expectedSummaryRevision: before.summaryRevision
  })) as unknown as Objective;
  assert.equal(edited.state, 'complete');
  assert.equal(edited.instructionText, LONG);
  assert.equal(edited.summary, 'The summary after the work is complete.');
  assert.equal(edited.summarySource, 'user');
  assert.equal(edited.updatedAt, before.updatedAt, 'updatedAt orders the feed; it must not move');
  assert.equal(edited.revision, (before.revision ?? 0) + 1);
  assert.equal(edited.summaryRevision, (before.summaryRevision ?? 0) + 1);

  // Instruction edits stay locked after execution: the summary route does
  // not unlock them.
  await assert.rejects(
    updateObjective(objective.id, { instructionText: 'New text', summary: 'x' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  // A stale editor gets a stable conflict and writes nothing.
  await assert.rejects(
    updateObjective(objective.id, {
      summary: 'Stale edit',
      expectedSummaryRevision: before.summaryRevision
    }),
    isCode(409, 'summary_conflict')
  );
  assert.equal(
    (await restObjective(objective.id)).summary,
    'The summary after the work is complete.'
  );

  // Omitting summary (an older client) leaves it unchanged.
  const titled = (await updateObjective(objective.id, {
    title: 'Retitled'
  })) as unknown as Objective;
  assert.equal(titled.summary, 'The summary after the work is complete.');

  // Over-long text is rejected with a stable code.
  await assert.rejects(
    updateObjective(objective.id, { summary: 'x'.repeat(4001) }),
    isCode(400, 'summary_too_long')
  );
});

test('REST Remove persists until a person selects Summarize; Retry and eligibility codes', async () => {
  const project = await createProject({ name: `REST remove ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ instructions: LONG, summary: 'Remove me.' }]
  });
  const id = mission.objectives[0]!.id;

  const removed = (await updateObjective(id, { summary: null })) as unknown as Objective;
  assert.equal(removed.summary, null);
  assert.equal(removed.summarySuppressed, true);
  assert.equal(removed.summaryStatus, null);

  await assert.rejects(
    requestObjectiveSummary(id, { mode: 'retry' }),
    isCode(409, 'summary_not_failed')
  );
  await assert.rejects(
    requestObjectiveSummary(id, { mode: 'later' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  const summarized = (await requestObjectiveSummary(id, {
    mode: 'summarize'
  })) as unknown as Objective;
  assert.equal(summarized.summarySuppressed, false);
  assert.equal(summarized.summaryStatus, 'pending');
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
      `UPDATE objectives SET summary_status = 'failed', summary_failure_code = 'provider_error' WHERE id = ?`
    )
    .run(id);
  const failed = await restObjective(id);
  assert.equal(failed.summaryStatus, 'failed');
  assert.equal(failed.summaryFailureCode, 'provider_error');
  const retried = (await requestObjectiveSummary(id, {
    mode: 'retry'
  })) as unknown as Objective;
  assert.equal(retried.summaryStatus, 'pending');
  assert.equal(retried.summaryFailureCode, null);

  const short = await createObjective({ missionId: mission.id, instructionText: 'Short task' });
  await assert.rejects(
    requestObjectiveSummary(short.id, { mode: 'summarize' }),
    isCode(409, 'summary_not_eligible')
  );
  assert.equal((short as unknown as Objective).summaryEligible, false);
});

// ---- Protocol / CLI / hosted MCP (agents) --------------------------------------

test('unattached agent creates qualify for automatic summaries; authored text gets warnings', async () => {
  const created = await protocolMission([
    { instructions: LONG },
    { instructions: LONG_2, summary: AGENT_SUMMARY },
    { instructions: LONG_2, summary: 'This should probably work.\n\n- a bullet' }
  ]);
  const [automatic, authored, styled] = created.objectives;
  assert.ok(automatic && authored && styled);

  const automaticRow = await restObjective(automatic.id);
  assert.equal(automaticRow.summaryStatus, 'pending', 'no session is needed to qualify');
  assert.equal(automaticRow.summary, null);

  const authoredRow = await restObjective(authored.id);
  assert.equal(authoredRow.summary, AGENT_SUMMARY);
  assert.equal(authoredRow.summarySource, 'agent');
  assert.equal(authoredRow.summaryStatus, null);
  assert.equal(authored.warnings, undefined, 'clean text carries no warnings');

  const rules = (styled.warnings ?? []).map(warning => warning.rule);
  assert.ok(rules.includes('ambiguous_modal'), rules.join(','));
  assert.ok(rules.includes('not_prose'), rules.join(','));
  assert.ok(styled.warnings!.every(warning => warning.code === 'summary_style'));
  assert.equal((await restObjective(styled.id)).summarySource, 'agent', 'stored as written');

  // The created-objective summaries stay the agent context shape.
  for (const objective of created.objectives) {
    assert.equal('summary' in objective, false);
  }
});

test('create --objective-summary sets the single objective; JSON items use their own field', async () => {
  const project = await createProject({ name: `Single summary ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': LONG,
      '--objective-summary': AGENT_SUMMARY
    }
  })) as CreatedMission;
  assert.equal((await restObjective(created.objectives[0]!.id)).summary, AGENT_SUMMARY);

  const fromFile = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': LONG,
      '--objective-summary-file': '-'
    },
    fileInputs: { '--objective-summary-file': AGENT_SUMMARY }
  })) as CreatedMission;
  assert.equal((await restObjective(fromFile.objectives[0]!.id)).summary, AGENT_SUMMARY);

  await assert.rejects(
    runProtocolSubcommand('create', {
      flags: {
        '--project-id': project.id,
        '--objectives-json': JSON.stringify([{ instructions: LONG }]),
        '--objective-summary': AGENT_SUMMARY
      }
    }),
    isCode(400, 'invalid_input')
  );
  await assert.rejects(
    protocolMission([{ instructions: LONG, summary: 42 }]),
    isCode(400, 'invalid_input')
  );
});

test('add-objectives carries per-item summaries and warnings', async () => {
  const created = await protocolMission([{ instructions: 'First' }]);
  const added = (await runProtocolSubcommand('add-objectives', {
    flags: {
      '--mission-id': created.mission.id,
      '--objectives-json': JSON.stringify([
        { instructions: LONG, summary: AGENT_SUMMARY },
        { instructions: LONG_2, summary: "It won't break anything." }
      ])
    }
  })) as Objective[];
  assert.equal(added.length, 2);
  assert.equal((await restObjective(added[0]!.id)).summary, AGENT_SUMMARY);
  assert.ok(added[1]!.warnings?.some(warning => warning.rule === 'contraction'));
});

test('agent summary edits stay in draft; Remove suppresses until a person summarizes', async () => {
  const created = await protocolMission([{ instructions: LONG }]);
  const objective = created.objectives[0]!;

  const set = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objective.displayId,
      '--summary-file': '-',
      '--agent': 'claude-code'
    },
    fileInputs: { '--summary-file': AGENT_SUMMARY }
  })) as Objective;
  assert.equal(set.summary, AGENT_SUMMARY);
  assert.equal(set.summarySource, 'agent');
  assert.equal(set.summaryAuthorAgent, 'claude-code');
  assert.deepEqual(set.warnings, []);

  // Empty text is Remove, from an agent as well.
  const removed = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--summary': '' }
  })) as Objective;
  assert.equal(removed.summary, null);
  assert.equal(removed.summarySuppressed, true);

  // An agent cannot silently restore a summary a person removed.
  const refused = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--summary': AGENT_SUMMARY }
  })) as Objective;
  assert.equal(refused.summary, null);
  assert.deepEqual(
    refused.warnings?.map(warning => warning.code),
    ['summary_suppressed']
  );
  for (const mode of ['summarize', 'regenerate']) {
    await assert.rejects(
      runProtocolSubcommand('update-objective', {
        flags: { '--objective-id': objective.id, '--summary-request': mode }
      }),
      isCode(409, 'summary_suppressed')
    );
  }
  // Instruction edits by an agent do not clear suppression either.
  await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--instruction-text': LONG_2 }
  });
  const afterEdit = await restObjective(objective.id);
  assert.equal(afterEdit.summarySuppressed, true);
  assert.equal(afterEdit.summaryStatus, null);

  // A person's Summarize is the only way back.
  const summarized = (await requestObjectiveSummary(objective.id, {
    mode: 'summarize'
  })) as unknown as Objective;
  assert.equal(summarized.summarySuppressed, false);
  assert.equal(summarized.summaryStatus, 'pending');

  // Request validation.
  await assert.rejects(
    runProtocolSubcommand('update-objective', {
      flags: { '--objective-id': objective.id, '--summary-request': 'later' }
    }),
    isCode(400, 'invalid_input')
  );
  await assert.rejects(
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': objective.id,
        '--summary-request': 'regenerate',
        '--summary': 'x'
      }
    }),
    isCode(400, 'invalid_input')
  );

  // Outside draft, an agent can neither edit the summary nor request one;
  // a person still can.
  await updateObjective(objective.id, { state: 'submitted' });
  const draftOnlyFlags: Array<Record<string, string>> = [
    { '--summary': AGENT_SUMMARY },
    { '--summary-request': 'regenerate' }
  ];
  for (const flags of draftOnlyFlags) {
    await assert.rejects(
      runProtocolSubcommand('update-objective', {
        flags: { '--objective-id': objective.id, ...flags }
      }),
      isCode(400, 'summary_not_editable')
    );
  }
  const human = (await updateObjective(objective.id, {
    summary: 'A person edits a submitted objective.'
  })) as unknown as Objective;
  assert.equal(human.summarySource, 'user');
  // Title edits by agents keep their any-state behavior.
  const retitled = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--title': 'Agent title in any state' }
  })) as Objective & { title: string };
  assert.equal(retitled.title, 'Agent title in any state');
});

test('agent Retry never clears removal suppression', async () => {
  const created = await protocolMission([{ instructions: LONG }]);
  const id = created.objectives[0]!.id;
  await db
    .prepare(
      `UPDATE objectives SET summary_status = 'failed', summary_failure_code = 'provider_error' WHERE id = ?`
    )
    .run(id);
  const retried = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': id, '--summary-request': 'retry' }
  })) as Objective;
  assert.equal(retried.summaryStatus, 'pending');
  assert.equal(retried.summarySuppressed, false);
});

// ---- Instruction-only execution contexts ----------------------------------------

test('attach, load-context and the launch prompt never carry the summary', async () => {
  const MARKER = 'Summary marker that must never reach the executing agent.';
  const created = await protocolMission([
    { instructions: LONG, summary: MARKER },
    { instructions: LONG_2, summary: MARKER }
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
  assert.equal((await restObjective(first.id)).summary, MARKER);
});

test('the activity feed carries a presentation-only summary preview', async () => {
  const project = await createProject({ name: `Feed summaries ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    objectives: [{ instructions: LONG, summary: 'Feed summary.' }]
  });
  await updateObjective(mission.objectives[0]!.id, { state: 'executing' });
  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);
  assert.ok(item && item.kind === 'mission_run');
  assert.equal(item.summaryPreview, 'Feed summary.');
  assert.ok(item.instructionPreview.startsWith('Rebuild the objective'));
});

test('a summary edit raises no notification and moves no activity ordering', async () => {
  const created = await protocolMission([{ instructions: LONG }]);
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
  await updateObjective(id, { summary: 'A person edits the summary.' });
  await requestObjectiveSummary(id, { mode: 'regenerate' });
  assert.equal(await count(), before);
  assert.equal((await restObjective(id)).updatedAt, original.updatedAt);
});

test('hosted MCP exposes the same summary operations as the protocol', async () => {
  const tools = overlordMcpToolDefinitions({ defaultAgent: 'claude-code' });
  const props = (name: string) =>
    (tools.find(tool => tool.name === name)!.inputSchema as { properties: Record<string, any> })
      .properties;
  assert.ok(props('overlord_create_mission').objectiveSummary);
  assert.ok(props('overlord_create_mission').objectiveInstructions);
  assert.ok(props('overlord_add_objectives').objectives.items.properties.instructions);
  assert.ok(props('overlord_add_objectives').objectives.items.properties.summary);
  assert.deepEqual(props('overlord_update_objective').summaryRequest.enum, [
    'summarize',
    'regenerate',
    'retry'
  ]);

  const created = await protocolMission([{ instructions: LONG }]);
  const objective = created.objectives[0]!;
  const viaMcp = (await runProtocolSubcommand(
    'update-objective',
    updateObjectiveProtocolBody({ objectiveId: objective.displayId, summary: AGENT_SUMMARY })
  )) as Objective;
  assert.equal(viaMcp.summary, AGENT_SUMMARY);
  assert.equal(viaMcp.summarySource, 'agent');

  // An empty string is Remove over MCP too.
  const removed = (await runProtocolSubcommand(
    'update-objective',
    updateObjectiveProtocolBody({ objectiveId: objective.id, summary: '' })
  )) as Objective;
  assert.equal(removed.summarySuppressed, true);
  await assert.rejects(
    runProtocolSubcommand(
      'update-objective',
      updateObjectiveProtocolBody({ objectiveId: objective.id, summaryRequest: 'summarize' })
    ),
    isCode(409, 'summary_suppressed')
  );
  assert.throws(() => updateObjectiveProtocolBody({ objectiveId: objective.id }));
});

// ---- Instructions/summary swap guard (coo:1321, ADR 0083) ---------------------

const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
/** The exact inputs of the coo:1320 create, whose instructions and summary were swapped. */
const COO_1320 = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../packages/core/service/fixtures/coo-1320-create-submission.json', import.meta.url)
    ),
    'utf8'
  )
) as { title: string; objective: string; objectiveDescription: string };

type Warning = { code: string; message: string };

/** The likely-swap warning: names both fields and says which one the agent receives. */
function likelySwapWarning(warnings: Warning[] | undefined): Warning {
  const warning = (warnings ?? []).find(w => w.code === 'objective_fields_swapped');
  assert.ok(warning, 'an objective_fields_swapped warning is returned');
  assert.match(warning.message, /look swapped/);
  assert.match(warning.message, /--objective-instructions/);
  assert.match(warning.message, /--objective-summary/);
  assert.match(warning.message, /executing agent receives/);
  return warning;
}

test('re-submitting the coo:1320 create stores both texts and warns, naming both fields', async () => {
  const project = await createProject({ name: `Swap guard ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--title': COO_1320.title,
      '--objective-instructions': COO_1320.objective,
      '--objective-summary-file': '-'
    },
    fileInputs: { '--objective-summary-file': COO_1320.objectiveDescription }
  })) as CreatedMission;
  likelySwapWarning(created.objectives[0]!.warnings);
  const stored = await restObjective(created.objectives[0]!.id);
  assert.equal(stored.instructionText, COO_1320.objective);
  assert.equal(stored.summary, COO_1320.objectiveDescription.trim());

  // The same texts through --objectives-json and prompt warn too; REST stores them.
  const fromJson = await protocolMission([
    { instructions: COO_1320.objective, summary: COO_1320.objectiveDescription }
  ]);
  likelySwapWarning(fromJson.objectives[0]!.warnings);
  const prompted = (await runProtocolSubcommand('prompt', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': COO_1320.objective,
      '--objective-summary': COO_1320.objectiveDescription
    }
  })) as { warnings?: Warning[] };
  likelySwapWarning(prompted.warnings);
  const rest = await createMission({
    projectId: project.id,
    objectives: [{ instructions: COO_1320.objective, summary: COO_1320.objectiveDescription }]
  });
  assert.equal(
    (rest.objectives[0] as unknown as Objective).summary,
    COO_1320.objectiveDescription.trim()
  );

  // The right way round, the same texts create with no swap warning.
  const fixed = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': COO_1320.objectiveDescription,
      '--objective-summary': COO_1320.objective
    }
  })) as CreatedMission;
  const objective = fixed.objectives[0]!;
  assert.ok(
    !(objective.warnings ?? []).some(warning => warning.code === 'objective_fields_swapped')
  );
  assert.equal(
    (await restObjective(objective.id)).instructionText,
    COO_1320.objectiveDescription.trim()
  );
});

test('a possible swap is stored with a warning; normal creates carry none', async () => {
  const normal = await protocolMission([{ instructions: LONG, summary: AGENT_SUMMARY }]);
  assert.ok(
    !(normal.objectives[0]!.warnings ?? []).some(w => w.code === 'objective_fields_swapped')
  );

  const instructions = 'Fix the flaky run-queue retry test in backend/run-queue-retry.test.ts.';
  const summary =
    'Fix the flaky test.\n\n1. Find the timing assumption.\n2. Replace the sleep with an event.';
  const created = await protocolMission([{ instructions, summary }]);
  const warning = (created.objectives[0]!.warnings ?? []).find(
    w => w.code === 'objective_fields_swapped'
  );
  assert.ok(warning, 'the swap warning is attached to the created objective');
  assert.match(warning.message, /numbered steps/);
  assert.equal((await restObjective(created.objectives[0]!.id)).summary, summary);

  const project = await createProject({ name: `Prompt swap warning ${Date.now()}` });
  const attached = (await runProtocolSubcommand('prompt', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': instructions,
      '--objective-summary': summary
    }
  })) as { warnings?: Array<{ code: string }> };
  assert.deepEqual(
    attached.warnings?.map(w => w.code),
    ['objective_fields_swapped']
  );
});

test('update-objective stores a swapped summary with a warning', async () => {
  const created = await protocolMission([{ instructions: COO_1320.objective }]);
  const objective = created.objectives[0]!;
  const swapped = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.id, '--summary': COO_1320.objectiveDescription }
  })) as Objective & { warnings: Warning[] };
  likelySwapWarning(swapped.warnings);
  assert.equal(swapped.summary, COO_1320.objectiveDescription.trim());
  // Moving the brief into the instructions in the same write clears the warning.
  const fixed = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objective.id,
      '--instruction-text': COO_1320.objectiveDescription,
      '--summary': COO_1320.objective
    }
  })) as Objective;
  assert.equal(fixed.summary, COO_1320.objective);
  assert.ok(!(fixed.warnings ?? []).some(w => w.code === 'objective_fields_swapped'));
  // A person editing over REST gets no warning (people may summarize terse instructions).
  const terse = await protocolMission([{ instructions: 'Fix it' }]);
  const edited = (await updateObjective(terse.objectives[0]!.id, {
    summary: 'A person wrote a longer explanation. '.repeat(20)
  })) as unknown as Objective;
  assert.match(edited.summary ?? '', /longer explanation/);
});

test('retired flag and field names are refused with their replacement', async () => {
  const project = await createProject({ name: `Retired names ${Date.now()}` });
  await assert.rejects(
    runProtocolSubcommand('create', {
      flags: { '--project-id': project.id, '--objective': LONG }
    }),
    (error: unknown) =>
      isCode(400, 'invalid_input')(error) &&
      /--objective is now --objective-instructions/.test((error as Error).message)
  );
  await assert.rejects(
    runProtocolSubcommand('create', {
      flags: {
        '--project-id': project.id,
        '--objective-instructions': LONG,
        '--objective-description': AGENT_SUMMARY
      }
    }),
    (error: unknown) => /--objective-description is now --objective-summary/.test(String(error))
  );
  await assert.rejects(
    protocolMission([{ objective: LONG, description: AGENT_SUMMARY }]),
    (error: unknown) =>
      isCode(400, 'invalid_input')(error) &&
      /"objective" is now "instructions"; "description" is now "summary"/.test(
        (error as Error).message
      )
  );
  const created = await protocolMission([{ instructions: LONG }]);
  await assert.rejects(
    runProtocolSubcommand('update-objective', {
      flags: { '--objective-id': created.objectives[0]!.id, '--description': AGENT_SUMMARY }
    }),
    (error: unknown) => /--description is now --summary/.test(String(error))
  );
});
