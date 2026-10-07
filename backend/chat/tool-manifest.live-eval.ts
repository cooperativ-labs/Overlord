/** Static schema probe. Only Overlord-authored declarations and synthetic connection ids.
 * GEMINI_API_KEY=... node --import tsx backend/chat/tool-manifest.live-eval.ts <aggregate.json>
 * Provider prompt usage minus the identical tool-free control counts schema overhead.
 */
import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import { writeFileSync } from 'node:fs';

import { ChatToolGateway } from '../../packages/core/service/chat/tools.ts';
import { REVIEWED_KNOWLEDGEBASE_TOOLS } from '../connections/policy.ts';

import { type GeminiChunk, sdkGeminiClient } from './gemini-client.ts';
import { createToolManifest, TOOL_FAMILIES, type ToolFamily } from './tool-manifest.ts';

const key = process.env.GEMINI_API_KEY;
if (!key || !process.argv[2]) throw new Error('GEMINI_API_KEY and output path required.');
const client = sdkGeminiClient(key);
const raw = openInMemoryDatabase();
const db = createSqliteClient(raw);
const connectionId = 'abcdefabcdef4abc8abcabcdefabcdef';
const results: unknown[] = [];
const model = 'gemini-3.8-flash';
async function measure(declarations: ReturnType<typeof createToolManifest>['declarations']) {
  const tools = declarations.length
    ? [
        {
          functionDeclarations: declarations.map(d => ({
            name: d.name,
            description: d.description,
            parametersJsonSchema: d.parameters
          }))
        }
      ]
    : undefined;
  const response = await client.generate({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }],
    config: {
      tools,
      toolConfig: { functionCallingConfig: { mode: 'NONE' } },
      maxOutputTokens: 64,
      thinkingConfig: { thinkingLevel: 'low' },
      abortSignal: AbortSignal.timeout(120_000)
    }
  });
  const usage = (response.rawResponse as GeminiChunk).usageMetadata;
  return {
    promptTokens: Number(usage?.promptTokenCount),
    toolsBytes: Buffer.byteLength(JSON.stringify(tools ?? []))
  };
}
const control = await measure([]);
for (const scope of ['read', 'request', 'all_workspaces'] as const) {
  if (process.env.CHAT_SCHEMA_SCOPES && !process.env.CHAT_SCHEMA_SCOPES.split(',').includes(scope))
    continue;
  const gateway = new ChatToolGateway({
    db,
    readRepository: async () => {
      throw new Error('No repository call in a schema probe.');
    },
    knowledgebase: {
      tools: async () =>
        REVIEWED_KNOWLEDGEBASE_TOOLS.filter(t => scope !== 'read' || t.access === 'read').map(
          t => ({
            id: `kb_abcdefabcdef_${t.name}`,
            connectionId,
            description: t.description,
            inputSchema: t.inputSchema,
            access: t.access,
            ...(t.access === 'write'
              ? {
                  writeScope:
                    scope === 'request'
                      ? { kind: 'request' as const, workspace: 'main' }
                      : { kind: 'all_workspaces' as const, workspaces: ['main'] }
                }
              : {})
          })
        ),
      call: async () => {
        throw new Error('No upstream call in a schema probe.');
      }
    }
  });
  const catalog = await gateway.declarations({
    profileId: 'synthetic',
    organizationId: 'synthetic'
  });
  for (const families of [...TOOL_FAMILIES.map(f => [f]), [...TOOL_FAMILIES]] as ToolFamily[][]) {
    const manifest = createToolManifest(catalog, families);
    const measured = await measure(manifest.declarations);
    const row = {
      scope,
      families,
      declarations: manifest.declarations.length,
      ...measured,
      schemaTokens: measured.promptTokens - control.promptTokens
    };
    results.push(row);
    console.error(JSON.stringify(row));
  }
}
writeFileSync(
  process.argv[2]!,
  JSON.stringify(
    { model, method: 'provider prompt usage minus identical tool-free control', control, results },
    null,
    2
  ),
  { mode: 0o600 }
);
raw.close();
