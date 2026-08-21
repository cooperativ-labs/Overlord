import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import { compactRunQueueResponse } from '../mcp/run-queue-detail.ts';
import { compactSearchResponse } from '../mcp/search-detail.ts';
import { runQueueMcpProtocolCall } from '../mcp/server.ts';
import { hostedMcpToolDefinitions } from '../mcp/tool-catalog.ts';
import { hostedMcpWidgetResources, readHostedMcpWidget } from '../mcp/widgets.ts';

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

async function localToolContracts(scriptPath: string): Promise<ToolContract[]> {
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
  return normalizeTools(response.result.tools);
}

test('local MCP bridge tools stay in sync with hosted MCP registry', async () => {
  const expected = hostedToolContracts();
  // The Codex, Cursor, and Antigravity shims are rendered from this one core
  // script; per-adapter rendering is covered by cli connector-core-render tests.
  const scripts = ['connectors/core/scripts/overlord-mcp.mjs'];

  for (const relativePath of scripts) {
    assert.deepEqual(await localToolContracts(path.join(repoRoot, relativePath)), expected);
  }
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
    'dateField',
    'detail',
    'entityTypes',
    'from',
    'limit',
    'matchesPerResult',
    'objectiveStates',
    'projectId',
    'query',
    'resourceKey',
    'status',
    'to',
    'workspaceId'
  ]);
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
    definition => definition.name === 'overlord_reorder_future_objectives'
  );
  assert.ok(reorder);
  assert.equal(reorder.annotations?.readOnlyHint, false);
  assert.deepEqual(reorder.inputSchema.required, ['missionId', 'orderedObjectiveIds']);
  assert.match(reorder.description, /every future objective UUID/);
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
            blockedReason: null
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
    'moveEntriesTo',
    'name',
    'orderedQueues',
    'paused',
    'projectId',
    'queue'
  ]);
  assert.match(manage.description, /full-scope token/);
});
