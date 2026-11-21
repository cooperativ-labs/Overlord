import { overlordMcpToolDefinitions } from '@overlord/contract/mcp-tools';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compactRunQueueResponse } from '../mcp/run-queue-detail.ts';
import { compactSearchResponse } from '../mcp/search-detail.ts';
import {
  deliverSessionProtocolBody,
  recordWorkProtocolBody,
  referenceSearchProtocolBody,
  runQueueMcpProtocolCall,
  toolErrorText
} from '../mcp/server.ts';
import { hostedMcpToolDefinitions } from '../mcp/tool-catalog.ts';
import { hostedMcpWidgetResources, readHostedMcpWidget } from '../mcp/widgets.ts';
import { ServiceError } from '../packages/core/service/errors.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

type ToolContract = {
  name: string;
  required: string[];
  properties: string[];
};

function normalizeTools(tools: Array<Record<string, any>>): ToolContract[] {
  return tools
    .map(tool => {
      const inputSchema = tool.inputSchema ?? {};
      return {
        name: String(tool.name),
        required: [...(inputSchema.required ?? [])].sort(),
        properties: Object.keys(inputSchema.properties ?? {}).sort()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hostedToolContracts(): ToolContract[] {
  return normalizeTools(hostedMcpToolDefinitions);
}

function encodeMcpMessage(message: Record<string, unknown>): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function parseMcpMessages(buffer: Buffer): Array<Record<string, any>> {
  const messages: Array<Record<string, any>> = [];
  let remaining = buffer;
  while (remaining.length > 0) {
    const headerEnd = remaining.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = remaining.subarray(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    assert.ok(match, `missing Content-Length in ${header}`);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (remaining.length < bodyEnd) break;
    messages.push(JSON.parse(remaining.subarray(bodyStart, bodyEnd).toString('utf8')));
    remaining = remaining.subarray(bodyEnd);
  }
  return messages;
}

async function localToolDefinitions(scriptPath: string): Promise<Array<Record<string, any>>> {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));

  child.stdin.write(encodeMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  child.stdin.end();

  const exitCode = await new Promise<number | null>(resolve => {
    child.on('exit', resolve);
  });

  assert.equal(
    exitCode,
    0,
    `${scriptPath} failed: ${Buffer.concat(stderrChunks).toString('utf8')}`
  );
  const messages = parseMcpMessages(Buffer.concat(stdoutChunks));
  const response = messages.find(message => message.id === 1);
  assert.ok(response, `${scriptPath} did not return a tools/list response`);
  assert.ifError(response.error);
  return response.result.tools;
}

async function localToolContracts(scriptPath: string): Promise<ToolContract[]> {
  return normalizeTools(await localToolDefinitions(scriptPath));
}

function assertChangeTrackingSchema(tools: Array<Record<string, any>>): void {
  for (const name of [
    'overlord_update_session',
    'overlord_deliver_session',
    'overlord_record_work'
  ]) {
    const tool = tools.find(definition => definition.name === name);
    assert.ok(tool, `${name} is published`);
    const properties = tool.inputSchema.properties as Record<string, any>;
    assert.equal(properties.changeRationales, undefined, `${name} retires changeRationales`);
    assert.equal(properties.changedFiles, undefined, `${name} retires changedFiles`);
    assert.equal(properties.declaredPaths?.type, 'array', `${name} publishes declaredPaths`);
    assert.equal(properties.declaredPaths.items.type, 'string');
  }

  const changes = tools.find(definition => definition.name === 'overlord_changes');
  assert.ok(changes, 'overlord_changes is published');
  assert.equal(changes.annotations?.readOnlyHint, true);
  assert.deepEqual(Object.keys(changes.inputSchema.properties).sort(), [
    'missionId',
    'objectiveId'
  ]);
  assert.match(changes.description, /server_objective/);
}

/**
 * Calls one tool on the local shim with a fake `ovld` binary. The fake prints
 * its argv as JSON, or, with `conflict`, prints a conflict body on stdout and
 * exits 1 as the CLI does for mission_summary_conflict.
 */
async function callLocalShimTool(
  name: string,
  args: Record<string, unknown>,
  {
    conflict = false,
    response: stubResponse
  }: { conflict?: boolean; response?: Record<string, unknown> } = {}
): Promise<Record<string, any>> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ovld-shim-'));
  try {
    const fakeBin = path.join(dir, 'ovld');
    await writeFile(
      fakeBin,
      stubResponse
        ? `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(stubResponse))});\n`
        : conflict
          ? `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ code: 'mission_summary_conflict', missionSummary: { contentRevision: 9 } }));\nprocess.exit(1);\n`
          : `#!/usr/bin/env node\nconst argv = process.argv.slice(2); if (argv.includes('--close-items-file')) { let stdin = ''; process.stdin.on('data', d => stdin += d); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ argv, stdin }))); } else process.stdout.write(JSON.stringify({ argv }));\n`
    );
    await chmod(fakeBin, 0o755);
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'connectors/core/scripts/overlord-mcp.mjs')],
      { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OVLD_BIN: fakeBin } }
    );
    const stdoutChunks: Buffer[] = [];
    child.stdout.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)));
    child.stdin.write(
      encodeMcpMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args }
      })
    );
    child.stdin.end();
    await new Promise(resolve => child.on('exit', resolve));
    const response = parseMcpMessages(Buffer.concat(stdoutChunks)).find(
      message => message.id === 1
    );
    assert.ok(response, `${name} returned no response`);
    return response.result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

const MISSION_SUMMARY_ARG = {
  baseContentRevision: 3,
  headline: 'Retries survive provider outages.',
  summary: 'Implemented and tested, not deployed.',
  closeItems: [{ id: 'item-1', status: 'done', reason: 'Fixed in this objective.' }]
};

test('local MCP forwards compact attach context unchanged and both catalogs describe directives', async () => {
  const response = {
    agentInstructions: 'Use directives and objectives.',
    mission: { displayId: 'coo:1' },
    objective: { displayId: 'coo:1.abcd' },
    objectives: [{ displayId: 'coo:1.efgh', state: 'complete', objective: 'Earlier work' }],
    directives: [{ type: 'user_follow_up', summary: 'Continue with my change' }],
    session: { sessionKey: 'test-session' },
    artifacts: [],
    attachments: [],
    sharedState: [],
    missionSummary: { contentRevision: 1, headline: 'Mission outcome', openItems: [] }
  };
  const result = await callLocalShimTool(
    'overlord_attach_session',
    { objectiveId: 'coo:1.abcd' },
    { response }
  );
  assert.deepEqual(result.structuredContent, response);
  assert.deepEqual(JSON.parse(result.content[0].text), response);
  for (const tools of [
    await localToolDefinitions(path.join(repoRoot, 'connectors/core/scripts/overlord-mcp.mjs')),
    hostedMcpToolDefinitions
  ]) {
    const attach = tools.find(tool => tool.name === 'overlord_attach_session');
    assert.match(String(attach?.description), /current-objective directives/);
  }
});

test('local MCP shim attaches with --connection-method mcp', async () => {
  const result = await callLocalShimTool('overlord_attach_session', { objectiveId: 'coo:1.abcd' });
  const argv = result.structuredContent.argv as string[];
  assert.equal(argv[1], 'attach');
  assert.equal(flagValue(argv, '--connection-method'), 'mcp');
});

test('local MCP shim reads objective changes with --connection-method mcp', async () => {
  const result = await callLocalShimTool('overlord_changes', { objectiveId: 'coo:1.abcd' });
  const argv = result.structuredContent.argv as string[];
  assert.equal(argv[1], 'objective-changes');
  assert.equal(flagValue(argv, '--connection-method'), 'mcp');
});

test('local MCP shim forwards missionSummary on deliver with the delivery report', async () => {
  const result = await callLocalShimTool('overlord_deliver_session', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Done.',
    knownRisks: ['Risk'],
    missionSummary: MISSION_SUMMARY_ARG
  });
  const argv = result.structuredContent.argv as string[];
  assert.equal(argv[1], 'deliver');
  const payload = JSON.parse(flagValue(argv, '--payload-json') ?? '{}');
  assert.deepEqual(payload.missionSummary, MISSION_SUMMARY_ARG);
  assert.deepEqual(payload.deliveryReport.agentReport, { knownRisks: ['Risk'] });
});

test('local MCP shim sends no payload on a summary-only deliver', async () => {
  const result = await callLocalShimTool('overlord_deliver_session', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Done.'
  });
  assert.equal(flagValue(result.structuredContent.argv, '--payload-json'), undefined);
});

test('local MCP shim forwards missionSummary on record-work', async () => {
  const recordSummary = {
    headline: MISSION_SUMMARY_ARG.headline,
    summary: MISSION_SUMMARY_ARG.summary
  };
  const result = await callLocalShimTool('overlord_record_work', {
    projectId: 'p1',
    objective: 'Did it.',
    summary: 'Done.',
    missionSummary: recordSummary
  });
  const payload = JSON.parse(flagValue(result.structuredContent.argv, '--payload-json') ?? '{}');
  assert.deepEqual(payload.missionSummary, recordSummary);
});

test('local MCP shim returns the conflict baseline the CLI prints on stdout', async () => {
  const result = await callLocalShimTool(
    'overlord_deliver_session',
    { objectiveId: 'coo:1.abcd', sessionKey: 'sess_x', summary: 'Done.' },
    { conflict: true }
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /mission_summary_conflict/);
  assert.match(result.content[0].text, /"contentRevision":9/);
});

test('local MCP bridge tools stay in sync with hosted MCP registry', async () => {
  const expected = hostedToolContracts();
  // The Codex, Cursor, and Antigravity shims are rendered from this one core
  // script; per-adapter rendering is covered by cli connector-core-render tests.
  const scripts = ['connectors/core/scripts/overlord-mcp.mjs'];

  for (const relativePath of scripts) {
    assert.deepEqual(await localToolContracts(path.join(repoRoot, relativePath)), expected);
  }
});

test('local MCP shim publishes the shared contract catalog verbatim, minus outputSchema', async () => {
  const local = await localToolDefinitions(
    path.join(repoRoot, 'connectors/core/scripts/overlord-mcp.mjs')
  );
  const expected = overlordMcpToolDefinitions({ defaultAgent: '__OVERLORD_ADAPTER_KEY__' }).map(
    ({ outputSchema: _outputSchema, ...tool }) => tool
  );
  assert.deepEqual(local, expected);
});

test('hosted MCP tools are the shared contract catalog plus widget and task metadata', () => {
  const shared = overlordMcpToolDefinitions({ defaultAgent: 'hosted-mcp' });
  assert.deepEqual(
    hostedMcpToolDefinitions.map(({ _meta: _widget, execution: _execution, ...tool }) => tool),
    shared
  );
  const attach = hostedMcpToolDefinitions.find(tool => tool.name === 'overlord_attach_session');
  assert.match(
    String((attach?.inputSchema.properties as Record<string, any>).agent.description),
    /Defaults to hosted-mcp\./
  );
});

test('hosted and local lifecycle tools expose declared paths and no rationale inputs', async () => {
  assertChangeTrackingSchema(hostedMcpToolDefinitions);
  const local = await localToolDefinitions(
    path.join(repoRoot, 'connectors/core/scripts/overlord-mcp.mjs')
  );
  assertChangeTrackingSchema(local);
});

test('hosted MCP tool metadata is publication-ready', () => {
  for (const tool of hostedMcpToolDefinitions) {
    assert.match(tool.description, /^Use this /, `${tool.name} has a scoped tool description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} has an input object schema`);
    assert.equal(tool.outputSchema.type, 'object', `${tool.name} has an output object schema`);
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} labels reads`);
    assert.equal(
      typeof tool.annotations?.destructiveHint,
      'boolean',
      `${tool.name} labels destructive behavior`
    );
    assert.equal(
      typeof tool.annotations?.openWorldHint,
      'boolean',
      `${tool.name} labels external publication behavior`
    );
  }
});

test('MCP mission creation requires explicit project or unassigned-project intent', () => {
  const create = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_create_mission'
  );
  assert.ok(create);
  const properties = create.inputSchema.properties as Record<string, { description: string }>;
  assert.ok(properties.projectId);
  assert.ok(properties.unassignedToProject);
  assert.match(properties.projectId.description, /Required unless unassignedToProject/);
  assert.match(properties.unassignedToProject.description, /intentionally create/);
  assert.match(create.description, /omission of both is rejected/);
});

test('MCP search compact and full detail modes preserve navigation semantics', () => {
  const full = {
    version: 3,
    entityCounts: { mission: 1, objective: 3, delivery: 0, event: 0 },
    results: [
      {
        id: 'mission-1',
        matches: [
          ...Array.from({ length: 3 }, (_, index) => ({
            id: `objective-${index}`,
            displayId: `coo:789.${index}`,
            entityType: 'objective',
            snippet: 'needle',
            matchedTerms: ['needle'],
            createdAt: '2026-08-19T00:00:00.000Z',
            updatedAt: '2026-08-19T00:00:00.000Z'
          }))
        ]
      }
    ]
  };
  const compact = compactSearchResponse(full) as typeof full;
  assert.equal(compact.version, 3);
  assert.equal(full.version, 3);
  assert.equal(compact.entityCounts.objective, 3);
  for (const result of compact.results) {
    assert.ok(result.matches.length <= 2);
    for (const match of result.matches) {
      assert.ok('id' in match);
      assert.ok('displayId' in match);
      assert.equal('snippet' in match, false);
      assert.equal('matchedTerms' in match, false);
      assert.equal('createdAt' in match, false);
      assert.equal('updatedAt' in match, false);
    }
  }
  for (const result of full.results)
    for (const match of result.matches) assert.ok('snippet' in match);
});

test('hosted MCP widget resources are self-contained and readable', () => {
  assert.deepEqual(hostedMcpWidgetResources.map(resource => resource.uri).sort(), [
    'ui://overlord/file-changes.html',
    'ui://overlord/mission-list.html',
    'ui://overlord/objective-viewer.html',
    'ui://overlord/project-selector.html'
  ]);
  for (const resource of hostedMcpWidgetResources) {
    const loaded = readHostedMcpWidget(resource.uri);
    assert.ok(loaded);
    assert.equal(loaded.mimeType, 'text/html;profile=mcp-app');
    assert.match(loaded.text, /ui\/notifications\/tool-result/);
    assert.doesNotMatch(loaded.text, /<iframe/i);
  }
});

test('overlord_list_project_statuses is a read-only project-scoped discovery tool', () => {
  const tool = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_list_project_statuses'
  );
  assert.ok(tool, 'the hosted catalog exposes project status discovery');
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema.required, ['projectId']);
  // `workspaceId` is optional and only ever narrows an ambiguous project name.
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ['projectId', 'workspaceId']);

  // Board column names vary per project; the type vocabulary does not. Both
  // facts have to be in the description or a model will filter on a name.
  assert.match(tool.description, /per project/);
  assert.match(tool.description, /draft, next, execute, review, complete, blocked, cancelled/);

  const search = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_search_missions'
  );
  assert.ok(search);
  const properties = search.inputSchema.properties as Record<string, { description: string }>;
  const status = properties.status;
  assert.match(status.description, /status TYPES/);
  assert.match(status.description, /not accepted here/);
  assert.deepEqual(Object.keys(properties).sort(), [
    'cursor',
    'dateField',
    'detail',
    'entityTypes',
    'from',
    'limit',
    'matchesPerResult',
    'objectiveStates',
    'projectId',
    'query',
    'reference',
    'resourceKey',
    'status',
    'to',
    'workspaceId'
  ]);
  // Exact-reference mode (v155) is the only search that can prove absence.
  assert.match(properties.reference.description, /Requires projectId/);
  assert.match(properties.reference.description, /complete: true/);
  assert.match(search.description, /never prove that no mission/);
  // The project filter takes the reference the user actually said (coo:781);
  // an ambiguous name is a question for the user, not a rejected argument.
  assert.match(properties.projectId.description, /slug, or the project name/);
  assert.match(properties.projectId.description, /project_selection_required/);
  assert.match(properties.workspaceId.description, /narrows an ambiguous projectId/);
  assert.match(properties.dateField.description, /dueDatetime/);
  assert.match(search.description, /authorized workspaces/);
  assert.match(search.description, /Artifacts are not indexed/);
  assert.match(search.description, /matching objectives and deliveries/);
  assert.deepEqual((properties.detail as unknown as { enum: string[] }).enum, ['compact', 'full']);
});

test('PM-management MCP tools preserve the protocol contracts', () => {
  const addObjectives = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_add_objectives'
  );
  assert.ok(addObjectives);
  const objectiveItems = (addObjectives.inputSchema.properties as Record<string, any>).objectives
    .items.properties;
  assert.deepEqual(Object.keys(objectiveItems).sort(), [
    'agent',
    'autoAdvance',
    'instructions',
    'model',
    'resourceKey',
    'summary',
    'title'
  ]);
  assert.match(objectiveItems.model.description, /Requires agent/);
  // The summary is presentation for people, never part of the agent context (ADR 0059, 0083).
  assert.match(objectiveItems.summary.description, /never sent to the executing agent/);
  assert.match(
    objectiveItems.instructions.description,
    /complete brief the executing agent receives/
  );

  const deliveries = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_list_deliveries'
  );
  assert.ok(deliveries);
  assert.equal(deliveries.annotations?.readOnlyHint, true);
  assert.deepEqual(Object.keys(deliveries.inputSchema.properties ?? {}).sort(), [
    'missionId',
    'objectiveId'
  ]);
  assert.match(deliveries.description, /human-action/);
  assert.match(deliveries.description, /raw delivery payloads/);

  const launch = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_launch_objective'
  );
  assert.ok(launch);
  assert.equal(launch.annotations?.readOnlyHint, false);
  assert.deepEqual(launch.inputSchema.required, ['objectiveId', 'agent']);
  assert.deepEqual(Object.keys(launch.inputSchema.properties ?? {}).sort(), [
    'agent',
    'executionTargetId',
    'model',
    'objectiveId',
    'reasoningEffort'
  ]);
  assert.match(launch.description, /does not attach this MCP agent/);

  const reorder = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_reorder_objectives'
  );
  assert.ok(reorder);
  assert.equal(reorder.annotations?.readOnlyHint, false);
  assert.deepEqual(reorder.inputSchema.required, ['missionId', 'orderedObjectiveIds']);
  assert.match(reorder.description, /every draft and submitted objective UUID/);

  for (const [name, listProperty] of [
    ['overlord_delete_missions', 'missionIds'],
    ['overlord_delete_objectives', 'objectiveIds']
  ] as const) {
    const tool = hostedMcpToolDefinitions.find(definition => definition.name === name);
    assert.ok(tool, `${name} is published`);
    assert.equal(tool.annotations?.destructiveHint, true);
    assert.deepEqual(tool.inputSchema.required, [listProperty, 'confirm']);
    assert.equal((tool.inputSchema.properties as Record<string, any>).confirm.type, 'boolean');
    assert.match(tool.description, /affirmative response/);
  }
});

test('Run Queue MCP tools map arguments to Protocol flags and retain the compact read shape', () => {
  const list = runQueueMcpProtocolCall('overlord_list_run_queues', {
    projectId: 'project-ref',
    objectiveId: 'coo:802.rjay',
    missionId: 'coo:802',
    queue: 'Priority'
  });
  assert.equal(list.subcommand, 'run-queue');
  assert.deepEqual(list.body, {
    flags: {
      '--project-id': 'project-ref',
      '--objective-id': 'coo:802.rjay',
      '--mission-id': 'coo:802',
      '--queue': 'Priority'
    }
  });

  const reorder = runQueueMcpProtocolCall('overlord_reorder_run_queue', {
    queue: 'Priority',
    orderedObjectives: ['entry-id', 'objective-id', 'coo:802.rjay'],
    projectId: 'project-ref'
  });
  assert.equal(reorder.subcommand, 'reorder-run-queue');
  assert.deepEqual(reorder.body, {
    flags: {
      '--queue': 'Priority',
      '--ordered-entries-json': JSON.stringify(['entry-id', 'objective-id', 'coo:802.rjay']),
      '--project-id': 'project-ref'
    }
  });

  const front = runQueueMcpProtocolCall('overlord_queue_objective', {
    objectiveId: 'coo:802.rjay',
    queue: 'Priority',
    front: true
  });
  assert.equal(front.subcommand, 'queue-objective');
  assert.deepEqual(front.body, {
    flags: {
      '--objective-id': 'coo:802.rjay',
      '--queue': 'Priority',
      '--front': true
    }
  });

  const positioned = runQueueMcpProtocolCall('overlord_queue_objective', {
    objectiveId: 'coo:802.rjay',
    position: 2
  });
  assert.deepEqual(positioned.body, {
    flags: { '--objective-id': 'coo:802.rjay', '--position': '2' }
  });

  assert.throws(
    () =>
      runQueueMcpProtocolCall('overlord_queue_objective', {
        objectiveId: 'coo:802.rjay',
        after: 'coo:802.qe54',
        front: true
      }),
    /Choose only one placement option/
  );

  const compact = compactRunQueueResponse({
    projectId: 'project-id',
    queues: [
      {
        id: 'queue-id',
        name: 'Run Queue',
        isDefault: true,
        paused: false,
        position: 1,
        running: null,
        entries: [
          {
            id: 'entry-id',
            position: 1,
            state: 'waiting',
            objectiveId: 'objective-id',
            objectiveDisplayId: 'coo:802.rjay',
            objectiveTitle: 'Queue support',
            missionId: 'mission-id',
            missionDisplayId: 'coo:802',
            missionTitle: 'Manage queues',
            blockedReason: null,
            waitingReason: 'mission_busy',
            waitingOnObjectiveId: 'sibling-id',
            waitingOnObjectiveDisplayId: 'coo:802.qe54',
            attemptCount: 0,
            assignedAgent: null,
            resourceKey: null,
            enqueuedAt: '2026-08-21T00:00:00.000Z',
            executionRequestId: null,
            executionRequest: null,
            diagnosticCode: null
          }
        ]
      }
    ]
  }) as Record<string, unknown>;
  assert.deepEqual(compact, {
    projectId: 'project-id',
    queues: [
      {
        id: 'queue-id',
        name: 'Run Queue',
        isDefault: true,
        paused: false,
        entries: [
          {
            position: 1,
            state: 'waiting',
            objectiveDisplayId: 'coo:802.rjay',
            objectiveTitle: 'Queue support',
            missionTitle: 'Manage queues',
            blockedReason: null,
            waitingReason: 'mission_busy',
            waitingOnObjectiveDisplayId: 'coo:802.qe54'
          }
        ]
      }
    ]
  });
});

test('Run Queue MCP catalog entries are readable and use the expected arguments', () => {
  const list = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_list_run_queues'
  );
  assert.ok(list);
  assert.equal(list.annotations?.readOnlyHint, true);
  assert.deepEqual(Object.keys(list.inputSchema.properties ?? {}).sort(), [
    'detail',
    'missionId',
    'objectiveId',
    'projectId',
    'queue'
  ]);

  const reorder = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_reorder_run_queue'
  );
  assert.ok(reorder);
  assert.deepEqual(reorder.inputSchema.required, ['queue', 'orderedObjectives']);
  assert.match(reorder.description, /every live entry exactly once/);
  assert.match(reorder.description, /Running and dispatched entries cannot move/);
});

test('overlord_manage_run_queue dispatches each action to its Protocol subcommand', () => {
  const created = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'create',
    projectId: 'project-ref',
    name: 'Priority'
  });
  assert.equal(created.subcommand, 'create-run-queue');
  assert.deepEqual(created.body, {
    flags: { '--project-id': 'project-ref', '--name': 'Priority' }
  });

  const renamed = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'update',
    queue: 'Priority',
    projectId: 'project-ref',
    name: 'Hot path'
  });
  assert.equal(renamed.subcommand, 'update-run-queue');
  assert.deepEqual(renamed.body, {
    flags: { '--queue': 'Priority', '--project-id': 'project-ref', '--name': 'Hot path' }
  });

  const paused = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'update',
    queue: 'Priority',
    paused: true
  });
  assert.deepEqual(paused.body, { flags: { '--queue': 'Priority', '--pause': true } });

  const resumed = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'update',
    queue: 'Priority',
    paused: false
  });
  assert.deepEqual(resumed.body, { flags: { '--queue': 'Priority', '--resume': true } });

  const deleted = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'delete',
    queue: 'Priority',
    moveEntriesTo: 'Run Queue'
  });
  assert.equal(deleted.subcommand, 'delete-run-queue');
  assert.deepEqual(deleted.body, {
    flags: { '--queue': 'Priority', '--move-entries-to': 'Run Queue' }
  });

  const reordered = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'reorder_queues',
    projectId: 'project-ref',
    orderedQueues: ['Run Queue', 'Priority']
  });
  assert.equal(reordered.subcommand, 'reorder-project-run-queues');
  assert.deepEqual(reordered.body, {
    flags: {
      '--project-id': 'project-ref',
      '--ordered-queues-json': JSON.stringify(['Run Queue', 'Priority'])
    }
  });
});

test('overlord_manage_run_queue rejects missing arguments before calling Protocol', () => {
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', {}),
    /action is required/
  );
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'create' }),
    /action 'create' requires projectId/
  );
  assert.throws(
    () =>
      runQueueMcpProtocolCall('overlord_manage_run_queue', {
        action: 'create',
        projectId: 'project-ref'
      }),
    /action 'create' requires name/
  );
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'update' }),
    /action 'update' requires queue/
  );
  assert.throws(
    () =>
      runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'update', queue: 'Priority' }),
    /action 'update' requires name or paused/
  );
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'delete' }),
    /action 'delete' requires queue/
  );
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'reorder_queues' }),
    /action 'reorder_queues' requires projectId/
  );
  assert.throws(
    () =>
      runQueueMcpProtocolCall('overlord_manage_run_queue', {
        action: 'reorder_queues',
        projectId: 'project-ref'
      }),
    /action 'reorder_queues' requires orderedQueues as an array of strings/
  );
  // retry_entry is an entry-level recovery action on the same tool: it needs an
  // address, and either an entry ref or an objective ref is enough.
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'retry_entry' }),
    /action 'retry_entry' requires entry or objectiveId/
  );
  const retried = runQueueMcpProtocolCall('overlord_manage_run_queue', {
    action: 'retry_entry',
    objectiveId: 'coo:854.ycde'
  });
  assert.equal(retried.subcommand, 'retry-queue-entry');
  assert.equal(retried.body.flags?.['--objective-id'], 'coo:854.ycde');
  assert.throws(
    () => runQueueMcpProtocolCall('overlord_manage_run_queue', { action: 'archive' }),
    /Unsupported Run Queue action: archive/
  );
});

test('overlord_manage_run_queue is catalogued as an administrative write tool', () => {
  const manage = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_manage_run_queue'
  );
  assert.ok(manage);
  assert.equal(manage.annotations?.readOnlyHint, false);
  assert.deepEqual(manage.inputSchema.required, ['action']);
  assert.deepEqual(Object.keys(manage.inputSchema.properties ?? {}).sort(), [
    'action',
    'entry',
    'moveEntriesTo',
    'name',
    'objectiveId',
    'orderedQueues',
    'paused',
    'projectId',
    'queue'
  ]);
  assert.match(manage.description, /full-scope token/);
});

test('overlord_search_missions maps exact-reference mode to Protocol search --reference', () => {
  assert.equal(referenceSearchProtocolBody({ query: 'offline sync' }), null);
  assert.deepEqual(
    referenceSearchProtocolBody({
      reference: 'kb-feature:https://kb.test/main/0b9e7c1e-8f2a-4c4b-9a7e-2f1d3c4b5a69',
      projectId: 'Clear Comply',
      workspaceId: 'acme',
      cursor: 'abc',
      limit: 20.7,
      detail: 'full'
    })?.flags,
    {
      '--reference': 'kb-feature:https://kb.test/main/0b9e7c1e-8f2a-4c4b-9a7e-2f1d3c4b5a69',
      '--project-id': 'Clear Comply',
      '--workspace-id': 'acme',
      '--cursor': 'abc',
      '--limit': '20'
    }
  );
  // Ranked filters are forwarded so Protocol rejects the combination, never dropped.
  assert.deepEqual(
    referenceSearchProtocolBody({
      reference: 'kb-feature:x',
      projectId: 'p',
      query: 'q',
      status: 'draft',
      matchesPerResult: 2
    })?.flags,
    {
      '--reference': 'kb-feature:x',
      '--project-id': 'p',
      '--query': 'q',
      '--status': 'draft',
      '--matches-per-result': '2'
    }
  );
});

test('MCP deliver and record-work pass missionSummary through to Protocol', () => {
  const missionSummary = {
    baseContentRevision: 3,
    headline: 'The export works.',
    summary: 'Tested, not deployed.',
    closeItems: [{ id: 'item-1', status: 'done', reason: 'Fixed here.' }]
  };
  const deliver = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Delivered.',
    missionSummary
  });
  assert.equal(deliver.flags?.['--mission-summary-file'], true);
  assert.deepEqual(JSON.parse(deliver.fileInputs!['--mission-summary-file']!), missionSummary);

  const without = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Delivered.'
  });
  assert.equal('--mission-summary-file' in (without.flags ?? {}), false);
  assert.equal(without.fileInputs, undefined);

  const recorded = recordWorkProtocolBody({
    projectId: 'project',
    objective: 'Fixed it.',
    summary: 'Fixed it.',
    missionSummary: { headline: 'Fixed.', summary: 'Tested.' }
  });
  assert.deepEqual(JSON.parse(recorded.fileInputs!['--payload-file']!).missionSummary, {
    headline: 'Fixed.',
    summary: 'Tested.'
  });

  for (const [name, keys] of [
    [
      'overlord_deliver_session',
      ['baseContentRevision', 'baseEvidenceRevision', 'closeItems', 'headline', 'summary']
    ],
    ['overlord_record_work', ['baseContentRevision', 'closeItems', 'headline', 'summary']]
  ] as const) {
    const tool = hostedMcpToolDefinitions.find(definition => definition.name === name)!;
    const schema = (tool.inputSchema as { properties: Record<string, any> }).properties
      .missionSummary;
    assert.ok(schema, `${name} accepts missionSummary`);
    assert.deepEqual(Object.keys(schema.properties).sort(), keys);
    assert.deepEqual(schema.properties.closeItems.items.required, ['id', 'status', 'reason']);
  }
});

test('an MCP tool error keeps the conflict code and fresh baseline', () => {
  const baseline = { contentRevision: 2, headline: 'A landed.', summary: 'Tested.', openItems: [] };
  const result = toolErrorText(
    new ServiceError('The mission summary changed.', 'mission_summary_conflict', 409, {
      baseContentRevision: 1,
      missionSummary: baseline
    })
  );
  assert.equal(result.isError, true);
  const text = result.content[0]!.text;
  assert.ok(text.startsWith('The mission summary changed.'));
  const parsed = JSON.parse(text.slice(text.indexOf('\n') + 1));
  assert.equal(parsed.code, 'mission_summary_conflict');
  assert.deepEqual(parsed.details.missionSummary, baseline);
  assert.equal(toolErrorText(new Error('plain')).content[0]!.text, 'plain');
});

test('local MCP item tools forward paging and closure payloads', async () => {
  const scope = { objectiveId: 'coo:1.abcd', sessionKey: 'session-key' };
  const read = await callLocalShimTool('overlord_mission_items', {
    ...scope,
    limit: 25,
    offset: 60
  });
  const argv = read.structuredContent.argv as string[];
  assert.equal(argv[1], 'mission-items');
  assert.equal(flagValue(argv, '--limit'), '25');
  assert.equal(flagValue(argv, '--offset'), '60');
  assert.equal(flagValue(argv, '--session-key'), scope.sessionKey);
  const closeItems = [{ id: 'item', status: 'done', reason: 'Verified' }];
  const close = await callLocalShimTool('overlord_close_items', { ...scope, closeItems });
  const closeArgv = close.structuredContent.argv as string[];
  assert.equal(closeArgv[1], 'close-items');
  assert.equal(flagValue(closeArgv, '--close-items-file'), '-');
  assert.deepEqual(JSON.parse(close.structuredContent.stdin), closeItems);
  for (const name of ['overlord_mission_items', 'overlord_close_items']) {
    const tool = hostedMcpToolDefinitions.find(tool => tool.name === name)!;
    assert.ok(tool);
    assert.ok((tool.inputSchema.required as string[]).includes('sessionKey'));
  }
});

test('MCP finalization tools carry only a caller-retained operationId (ADR 0075)', async () => {
  // Hosted: the caller's id travels unchanged; without one the handler invents none.
  const deliver = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Delivered.',
    operationId: 'caller-op-0001'
  });
  assert.equal(deliver.flags?.['--operation-id'], 'caller-op-0001');
  const deliverAgain = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Delivered.',
    operationId: 'caller-op-0001'
  });
  assert.deepEqual(deliverAgain, deliver, 'a repeated invocation sends the same retry identity');
  const anonymous = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'sess_x',
    summary: 'Delivered.'
  });
  assert.equal('--operation-id' in (anonymous.flags ?? {}), false);

  const recorded = recordWorkProtocolBody({
    projectId: 'project',
    objective: 'Fixed it.',
    summary: 'Fixed it.',
    operationId: 'caller-op-0002'
  });
  assert.equal(JSON.parse(recorded.fileInputs!['--payload-file']!).operationId, 'caller-op-0002');
  const recordedAnonymous = recordWorkProtocolBody({
    projectId: 'project',
    objective: 'Fixed it.',
    summary: 'Fixed it.'
  });
  assert.equal(
    'operationId' in JSON.parse(recordedAnonymous.fileInputs!['--payload-file']!),
    false
  );

  for (const name of ['overlord_deliver_session', 'overlord_record_work']) {
    const tool = hostedMcpToolDefinitions.find(definition => definition.name === name)!;
    const properties = (tool.inputSchema as { properties: Record<string, any> }).properties;
    assert.equal(properties.operationId.type, 'string', `${name} exposes operationId`);
    assert.match(properties.operationId.description, /same value on every retry/);
    assert.equal((tool.inputSchema.required as string[]).includes('operationId'), false);
  }
  const receiptTool = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_delivery_receipt'
  );
  assert.ok(receiptTool);
  assert.equal(receiptTool.annotations?.readOnlyHint, true);

  // Local shim: forwards the caller's id; record-work without one is explicitly new work.
  const localDeliver = await callLocalShimTool('overlord_deliver_session', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'session-key',
    summary: 'Delivered.',
    operationId: 'caller-op-0003'
  });
  assert.equal(
    flagValue(localDeliver.structuredContent.argv as string[], '--operation-id'),
    'caller-op-0003'
  );
  const localRecord = await callLocalShimTool('overlord_record_work', {
    projectId: 'project',
    objective: 'Fixed it.',
    summary: 'Fixed it.'
  });
  const recordArgv = localRecord.structuredContent.argv as string[];
  assert.ok(recordArgv.includes('--new-operation'));
  assert.equal(recordArgv.includes('--operation-id'), false);
  const localReceipt = await callLocalShimTool('overlord_delivery_receipt', {
    operationId: 'caller-op-0003'
  });
  const receiptArgv = localReceipt.structuredContent.argv as string[];
  assert.equal(receiptArgv[1], 'delivery-receipt');
  assert.equal(flagValue(receiptArgv, '--operation-id'), 'caller-op-0003');
});

test('MCP narrow narrative tools address one delivery and carry a caller-retained operationId (ADR 0076)', async () => {
  const context = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_delivery_summary_context'
  )!;
  assert.equal(context.annotations?.readOnlyHint, true);
  const publish = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_publish_delivery_summary'
  )!;
  assert.equal(publish.annotations?.readOnlyHint, false);
  const required = publish.inputSchema.required as string[];
  for (const field of ['operationId', 'baseContentRevision', 'baseEvidenceRevision']) {
    assert.ok(required.includes(field), `${field} is required`);
  }
  assert.equal(
    'closeItems' in (publish.inputSchema as { properties: Record<string, unknown> }).properties,
    false,
    'publication writes only narrative'
  );

  const local = await callLocalShimTool('overlord_publish_delivery_summary', {
    missionId: 'coo:1',
    deliveryId: 'delivery-1',
    sessionKey: 'session-key',
    operationId: 'caller-pub-0001',
    baseContentRevision: 2,
    baseEvidenceRevision: 5,
    headline: 'Done.',
    summary: 'Tested.'
  });
  const argv = local.structuredContent.argv as string[];
  assert.equal(argv[1], 'publish-delivery-summary');
  assert.equal(flagValue(argv, '--operation-id'), 'caller-pub-0001');
  assert.equal(flagValue(argv, '--delivery-id'), 'delivery-1');
  assert.equal(flagValue(argv, '--connection-method'), 'mcp');
  assert.deepEqual(JSON.parse(flagValue(argv, '--payload-json')!), {
    baseContentRevision: 2,
    baseEvidenceRevision: 5,
    headline: 'Done.',
    summary: 'Tested.'
  });
  const read = await callLocalShimTool('overlord_delivery_summary_context', {
    missionId: 'coo:1',
    publicationId: 'publication-1'
  });
  const readArgv = read.structuredContent.argv as string[];
  assert.equal(readArgv[1], 'delivery-summary-context');
  assert.equal(flagValue(readArgv, '--publication-id'), 'publication-1');
  assert.equal(readArgv.includes('--session-key'), false);
});

test('MCP draft evidence tools carry a caller-retained batch id and never mint one (ADR 0078)', async () => {
  const update = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_update_session'
  )!;
  const updateProps = (update.inputSchema as { properties: Record<string, any> }).properties;
  assert.deepEqual(updateProps.reportDraft.required, [
    'operationId',
    'expectedRevision',
    'operations'
  ]);
  assert.match(
    updateProps.reportDraft.properties.operationId.description,
    /same value on every retry/
  );
  assert.equal((update.inputSchema.required as string[]).includes('summary'), false);
  const deliver = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_deliver_session'
  )!;
  const deliverDraft = (deliver.inputSchema as { properties: Record<string, any> }).properties
    .reportDraft;
  assert.deepEqual(deliverDraft.required, ['expectedRevision']);
  assert.equal('operationId' in deliverDraft.properties, false);
  const read = hostedMcpToolDefinitions.find(
    definition => definition.name === 'overlord_report_draft'
  );
  assert.ok(read);
  assert.equal(read.annotations?.readOnlyHint, true);

  const hosted = deliverSessionProtocolBody({
    objectiveId: 'coo:1.abcd',
    sessionKey: 'session-key',
    summary: 'Delivered.',
    reportDraft: { expectedRevision: 3 }
  });
  assert.deepEqual(JSON.parse(String(hosted.flags?.['--report-draft-json'])), {
    expectedRevision: 3
  });

  const batch = {
    operationId: 'caller-batch-0001',
    expectedRevision: 0,
    operations: [{ op: 'upsert', entryId: 'r1', kind: 'known_risk', content: { text: 'x' } }]
  };
  const localUpdate = await callLocalShimTool('overlord_update_session', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'session-key',
    reportDraft: batch
  });
  const updateArgv = localUpdate.structuredContent.argv as string[];
  assert.equal(updateArgv[1], 'update');
  assert.deepEqual(JSON.parse(flagValue(updateArgv, '--report-draft-json')!), batch);
  assert.equal(updateArgv.includes('--summary'), false);
  const localRead = await callLocalShimTool('overlord_report_draft', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'session-key',
    includeWithdrawn: true
  });
  const readArgv = localRead.structuredContent.argv as string[];
  assert.equal(readArgv[1], 'report-draft');
  assert.ok(readArgv.includes('--include-withdrawn'));
});

test('project item MCP catalog and local flags preserve discovery filters', async () => {
  const tool = hostedMcpToolDefinitions.find(tool => tool.name === 'overlord_project_items')!;
  assert.ok(tool);
  assert.equal(tool.annotations?.readOnlyHint, true);
  const props = tool.inputSchema.properties as Record<string, any>;
  assert.equal(props.limit.default, 20);
  assert.equal(props.limit.maximum, 100);
  assert.equal(props.query.maxLength, 200);
  const result = await callLocalShimTool('overlord_project_items', {
    objectiveId: 'coo:1.abcd',
    sessionKey: 'key',
    kinds: ['risk', 'suggestion'],
    query: 'retry',
    paths: ['backend/services/retry.ts', 'cli/src/retry.ts'],
    includeOwnMission: true,
    limit: 9,
    offset: 20
  });
  const argv = result.structuredContent.argv as string[];
  assert.equal(argv[1], 'project-items');
  assert.equal(flagValue(argv, '--kind'), 'risk,suggestion');
  assert.equal(flagValue(argv, '--query'), 'retry');
  assert.equal(flagValue(argv, '--limit'), '9');
  assert.equal(flagValue(argv, '--offset'), '20');
  assert.ok(argv.includes('--include-own-mission'));
  assert.equal(flagValue(argv, '--path'), 'backend/services/retry.ts,cli/src/retry.ts');
});
