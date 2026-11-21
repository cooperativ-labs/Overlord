import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * Hosted MCP task-augmented tool calls (MCP 2025-11-25 tasks, coo:1318.c8f4): capability and
 * tool-level negotiation, background deliver and record-work with tasks/get, tasks/result and
 * tasks/list, failure status, owner binding, ttl and concurrency limits, and unchanged
 * synchronous behavior for clients that send no task.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mcp-tasks-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { setActiveProfileId, withRequestContextAsync } = await import('./db.ts');
const { createMission, createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { dispatchMcpRequest, onHostedMcpTaskSettled } = await import('../mcp/server.ts');
const { HOSTED_TASK_TOOLS } = await import('../mcp/tool-catalog.ts');
const { McpTaskStore, RELATED_TASK_META_KEY, MODEL_IMMEDIATE_RESPONSE_META_KEY } =
  await import('../mcp/tasks.ts');

after(() => {
  onHostedMcpTaskSettled(null);
  rmSync(tempDir, { recursive: true, force: true });
});

type Rpc = Record<string, any>;
let nextId = 1;

async function rpc(method: string, params?: unknown): Promise<Rpc> {
  const response = await dispatchMcpRequest({ jsonrpc: '2.0', id: nextId++, method, params });
  assert.ok(response, `${method} answered`);
  return response;
}

async function ok(method: string, params?: unknown): Promise<Rpc> {
  const response = await rpc(method, params);
  assert.equal(response.error, undefined, `${method} failed: ${JSON.stringify(response.error)}`);
  return response.result;
}

async function attachedObjective(name: string) {
  const project = await createProject({ name: `${name} ${Date.now()}`, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  const objective = mission.objectives[0]!;
  const attached = (await runProtocolSubcommand('attach', {
    flags: { '--objective-id': objective.displayId }
  })) as { sessionKey: string };
  return { project, mission, objective, sessionKey: attached.sessionKey };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

test('initialize declares task-augmented tools/call with list and without cancel', async () => {
  const result = await ok('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' }
  });
  assert.equal(result.protocolVersion, '2025-11-25');
  assert.deepEqual(result.capabilities.tasks, { list: {}, requests: { tools: { call: {} } } });
});

test('only deliver and record-work advertise optional task support', async () => {
  const { tools } = await ok('tools/list');
  const taskTools = (tools as Rpc[])
    .filter(tool => tool.execution !== undefined)
    .map(tool => [tool.name, tool.execution.taskSupport]);
  assert.deepEqual(taskTools.sort(), [
    ['overlord_deliver_session', 'optional'],
    ['overlord_record_work', 'optional']
  ]);
  assert.deepEqual([...HOSTED_TASK_TOOLS].sort(), [
    'overlord_deliver_session',
    'overlord_record_work'
  ]);
});

test('a task request to a tool without task support is Method not found', async () => {
  const response = await rpc('tools/call', {
    name: 'overlord_list_project_statuses',
    arguments: { projectId: 'anything' },
    task: { ttl: 60_000 }
  });
  assert.equal(response.error.code, -32601);
  assert.match(response.error.message, /does not support task-augmented execution/);
});

test('a malformed task parameter is Invalid params and runs nothing', async () => {
  const project = await createProject({ name: `Bad ttl ${Date.now()}`, color: '#123456' });
  for (const task of [null, 'soon', { ttl: -1 }, { ttl: 'later' }]) {
    const response = await rpc('tools/call', {
      name: 'overlord_record_work',
      arguments: { projectId: project.id, objective: 'Never runs.', summary: 'Never runs.' },
      task
    });
    assert.equal(response.error.code, -32602, JSON.stringify(task));
  }
  const listed = await ok('tasks/list');
  assert.equal(
    listed.tasks.some((task: Rpc) => task.statusMessage?.includes('Never runs')),
    false
  );
});

test('record-work runs as a task and its result is read with tasks/result', async () => {
  const project = await createProject({ name: `Task record ${Date.now()}`, color: '#123456' });
  const settled: number[] = [];
  onHostedMcpTaskSettled(() => settled.push(Date.now()));

  const created = await ok('tools/call', {
    name: 'overlord_record_work',
    arguments: {
      projectId: project.id,
      objective: 'Wrote the task note.',
      summary: 'Wrote the task note.',
      operationId: 'task-record-op-001'
    },
    task: { ttl: 120_000 }
  });
  const task = created.task;
  assert.equal(task.status, 'working');
  assert.equal(task.ttl, 120_000);
  assert.equal(typeof task.taskId, 'string');
  assert.ok(task.createdAt && task.lastUpdatedAt && task.pollInterval > 0);
  assert.equal('content' in created, false, 'a CreateTaskResult carries no tool result');
  assert.match(created._meta[MODEL_IMMEDIATE_RESPONSE_META_KEY], /overlord_record_work/);

  const result = await ok('tasks/result', { taskId: task.taskId });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(result._meta[RELATED_TASK_META_KEY], { taskId: task.taskId });
  assert.equal(typeof result.structuredContent.deliveryId, 'string');
  assert.equal(result.structuredContent.operationId, 'task-record-op-001');

  const after = await ok('tasks/get', { taskId: task.taskId });
  assert.equal(after.status, 'completed');
  assert.equal(after.taskId, task.taskId);
  assert.equal(after.ttl, 120_000);
  assert.ok(settled.length >= 1, 'the settle listener ran');

  // The work committed exactly once and is recoverable through the receipt, as a lost task would be.
  const receipt = (await runProtocolSubcommand('delivery-receipt', {
    flags: { '--operation-id': 'task-record-op-001', '--operation-kind': 'record_work' }
  })) as { receipt: { deliveryId: string } };
  assert.equal(receipt.receipt.deliveryId, result.structuredContent.deliveryId);

  const listed = await ok('tasks/list');
  assert.ok(listed.tasks.some((entry: Rpc) => entry.taskId === task.taskId));
});

test('deliver runs as a task; the synchronous call is unchanged without a task', async () => {
  const first = await attachedObjective('Task deliver');
  const created = await ok('tools/call', {
    name: 'overlord_deliver_session',
    arguments: {
      objectiveId: first.objective.displayId,
      sessionKey: first.sessionKey,
      summary: 'Delivered as a task.',
      operationId: 'task-deliver-op-001'
    },
    task: {}
  });
  assert.equal(created.task.status, 'working');
  assert.equal(created.task.ttl, 15 * 60_000, 'a task without ttl gets the default');
  const result = await ok('tasks/result', { taskId: created.task.taskId });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.operationId, 'task-deliver-op-001');
  assert.equal((await ok('tasks/get', { taskId: created.task.taskId })).status, 'completed');

  const second = await attachedObjective('Sync deliver');
  const sync = await ok('tools/call', {
    name: 'overlord_deliver_session',
    arguments: {
      objectiveId: second.objective.displayId,
      sessionKey: second.sessionKey,
      summary: 'Delivered synchronously.'
    }
  });
  assert.equal('task' in sync, false);
  assert.equal(typeof sync.structuredContent.deliveryId, 'string');
  assert.equal(sync._meta, undefined);
});

test('a tool error fails the task and tasks/result returns the isError result', async () => {
  const { objective } = await attachedObjective('Task failure');
  const created = await ok('tools/call', {
    name: 'overlord_deliver_session',
    arguments: {
      objectiveId: objective.displayId,
      sessionKey: 'sess_not_a_real_session_key',
      summary: 'This delivery is refused.'
    },
    task: { ttl: 60_000 }
  });
  const result = await ok('tasks/result', { taskId: created.task.taskId });
  assert.equal(result.isError, true);
  assert.deepEqual(result._meta[RELATED_TASK_META_KEY], { taskId: created.task.taskId });
  const failed = await ok('tasks/get', { taskId: created.task.taskId });
  assert.equal(failed.status, 'failed');
  assert.match(failed.statusMessage, /^Tool execution failed: /);
});

test('tasks are bound to the caller and an unknown id is Invalid params', async () => {
  const project = await createProject({ name: `Task owner ${Date.now()}`, color: '#123456' });
  const created = await withRequestContextAsync(async () => {
    setActiveProfileId('profile-owner-a');
    return ok('tools/call', {
      name: 'overlord_record_work',
      arguments: {
        projectId: project.id,
        objective: 'Owner bound.',
        summary: 'Owner bound.',
        operationId: 'task-owner-op-001'
      },
      task: { ttl: 60_000 }
    });
  });
  const taskId = created.task.taskId as string;

  await withRequestContextAsync(async () => {
    setActiveProfileId('profile-owner-b');
    for (const method of ['tasks/get', 'tasks/result']) {
      const response = await rpc(method, { taskId });
      assert.equal(response.error.code, -32602, method);
      assert.match(response.error.message, /Task not found/);
    }
    const listed = await ok('tasks/list');
    assert.equal(
      listed.tasks.some((task: Rpc) => task.taskId === taskId),
      false
    );
  });

  await withRequestContextAsync(async () => {
    setActiveProfileId('profile-owner-a');
    const result = await ok('tasks/result', { taskId });
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
  });

  assert.equal((await rpc('tasks/get', { taskId: 'no-such-task' })).error.code, -32602);
  assert.equal((await rpc('tasks/get', {})).error.code, -32602);
  assert.equal((await rpc('tasks/list', { cursor: 'not-a-cursor' })).error.code, -32602);
  assert.equal((await rpc('tasks/cancel', { taskId })).error.code, -32601, 'cancel is not offered');
});

test('the store caps ttl and unfinished tasks per owner, pages, and purges expired tasks', async () => {
  let now = Date.parse('2026-11-20T12:00:00Z');
  let counter = 0;
  const store = new McpTaskStore({
    now: () => now,
    newId: () => `task-${++counter}`,
    limits: { maxActivePerOwner: 2, maxTtlMs: 10_000, listPageSize: 1, resultGraceMs: 1_000 }
  });
  assert.equal(store.grantedTtl(undefined), undefined);
  assert.equal(store.grantedTtl({ ttl: 999_999 }), 10_000);

  const gate = deferred<{ content: Array<{ type: 'text'; text: string }> }>();
  const a = store.create('owner', 5_000, () => gate.promise);
  store.create('owner', 5_000, () => gate.promise);
  assert.throws(
    () => store.create('owner', 5_000, () => gate.promise),
    (error: unknown) => (error as { code?: number }).code === -32000
  );
  store.create('other-owner', 5_000, () => gate.promise);

  const page1 = store.list('owner', undefined);
  assert.equal(page1.tasks.length, 1);
  assert.equal(page1.nextCursor, '1');
  const page2 = store.list('owner', page1.nextCursor);
  assert.equal(page2.tasks.length, 1);
  assert.equal(page2.nextCursor, undefined);
  assert.notEqual(page1.tasks[0]!.taskId, page2.tasks[0]!.taskId);

  // An unfinished task outlives its ttl; once it settles it stays readable for the grace only.
  now += 60_000;
  assert.equal(store.get('owner', a.taskId).status, 'working');
  gate.resolve({ content: [{ type: 'text', text: 'done' }] });
  const result = await store.result('owner', a.taskId);
  assert.equal(result.content[0]!.text, 'done');
  assert.equal(store.get('owner', a.taskId).status, 'completed');
  now += 999;
  assert.equal(store.get('owner', a.taskId).status, 'completed');
  now += 1;
  assert.throws(() => store.get('owner', a.taskId), /Task not found/);

  // A throwing runner fails the task instead of escaping.
  const thrown = store.create('third', 5_000, async () => {
    throw new Error('boom');
  });
  const failed = await store.result('third', thrown.taskId);
  assert.equal(failed.isError, true);
  assert.equal(store.get('third', thrown.taskId).statusMessage, 'Tool execution failed: boom');
});
