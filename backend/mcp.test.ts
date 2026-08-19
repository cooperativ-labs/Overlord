import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import { compactSearchResponse } from '../mcp/search-detail.ts';
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
