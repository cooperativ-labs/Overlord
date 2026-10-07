/** Explicit-cache feasibility probe. Sends only the Overlord-authored system prompt, reviewed
 * declarations built for synthetic connection ids, and synthetic conversation text.
 * GEMINI_API_KEY=... node --import tsx backend/chat/explicit-cache.live-eval.ts <aggregate.json>
 * Every created cache is deleted before exit; the aggregate holds numbers and error codes only.
 */
import { GoogleGenAI } from '@google/genai';
import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { ChatToolGateway } from '../../packages/core/service/chat/tools.ts';
import { REVIEWED_KNOWLEDGEBASE_TOOLS } from '../connections/policy.ts';

import { geminiRuntimeInternals } from './gemini-runtime.ts';
import { createToolManifest, type ToolFamily } from './tool-manifest.ts';

const key = process.env.GEMINI_API_KEY;
const out = process.argv[2];
if (!key || !out) throw new Error('GEMINI_API_KEY and output path required.');
const ai = new GoogleGenAI({ apiKey: key });
const model = process.env.CHAT_CACHE_MODEL ?? 'gemini-3.8-flash';
const repeats = Number(process.env.CHAT_CACHE_REPEATS ?? 3);
const rounds = Number(process.env.CHAT_CACHE_ROUNDS ?? 6);
const SYSTEM = geminiRuntimeInternals.SYSTEM_PROMPT;
const created = new Set<string>();
const report: Record<string, unknown> = { model, repeats, rounds, startedAt: new Date() };
type Tools = {
  functionDeclarations: { name: string; description: string; parametersJsonSchema: unknown }[];
}[];

const errorCode = (error: unknown) => ({
  status: Number((error as { status?: unknown })?.status) || null,
  // Provider error class only; messages may echo request content, so they stay out.
  kind: /expired|not.?found|does not exist/i.test(String((error as Error)?.message))
    ? 'cache_missing_or_expired'
    : /minimum|too small|at least|min_total_token/i.test(String((error as Error)?.message))
      ? 'below_minimum'
      : /cached.?content|system.?instruction|tool_?config|tools/i.test(
            String((error as Error)?.message)
          )
        ? 'cached_content_conflict'
        : 'other'
});

async function catalogFor(scope: 'read' | 'request') {
  const raw = openInMemoryDatabase();
  const gateway = new ChatToolGateway({
    db: createSqliteClient(raw),
    readRepository: async () => {
      throw new Error('No repository call in a cache probe.');
    },
    knowledgebase: {
      tools: async () =>
        REVIEWED_KNOWLEDGEBASE_TOOLS.filter(t => scope !== 'read' || t.access === 'read').map(
          t => ({
            id: `kb_abcdefabcdef_${t.name}`,
            connectionId: 'abcdefabcdef4abc8abcabcdefabcdef',
            description: t.description,
            inputSchema: t.inputSchema,
            access: t.access,
            ...(t.access === 'write'
              ? { writeScope: { kind: 'request' as const, workspace: 'main' } }
              : {})
          })
        ),
      call: async () => {
        throw new Error('No upstream call in a cache probe.');
      }
    }
  });
  const catalog = await gateway.declarations({
    profileId: 'synthetic',
    organizationId: 'synthetic'
  });
  raw.close();
  return catalog;
}

function toolsOf(families: ToolFamily[], catalog: Awaited<ReturnType<typeof catalogFor>>): Tools {
  return [
    {
      functionDeclarations: createToolManifest(catalog, families).declarations.map(d => ({
        name: d.name,
        description: d.description,
        parametersJsonSchema: d.parameters
      }))
    }
  ];
}

const usageOf = (r: unknown) =>
  ((r as { usageMetadata?: Record<string, number> })?.usageMetadata ?? {}) as Record<
    string,
    number | undefined
  >;

async function promptTokens(config: Record<string, unknown>) {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }],
    config: {
      ...config,
      maxOutputTokens: 64,
      thinkingConfig: { thinkingLevel: 'low' as never },
      toolConfig: { functionCallingConfig: { mode: 'NONE' as never } }
    }
  });
  return usageOf(response).promptTokenCount ?? NaN;
}

async function createCache(tools: Tools, ttl = '600s', toolMode?: 'AUTO' | 'NONE') {
  const started = performance.now();
  const cache = await ai.caches.create({
    model,
    config: {
      displayName: `overlord-probe-${randomUUID().slice(0, 8)}`,
      systemInstruction: SYSTEM,
      tools: tools as never,
      ...(toolMode ? { toolConfig: { functionCallingConfig: { mode: toolMode as never } } } : {}),
      ttl
    }
  });
  created.add(cache.name!);
  return {
    name: cache.name!,
    createMs: performance.now() - started,
    tokens: (cache.usageMetadata as { totalTokenCount?: number } | undefined)?.totalTokenCount
  };
}

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (error) {
    return { ok: false as const, error: errorCode(error) };
  }
}

const filler = (nonce: string, round: number) =>
  Array.from(
    { length: 60 },
    (_, i) =>
      `Observation ${nonce}-${round}-${i}: module svc-${(i * 7 + round) % 23} retries ${(i % 4) + 1} times with ${(i % 5) * 125} ms backoff and logs a structured warning on the third failure.`
  ).join('\n');

async function streamed(contents: unknown[], config: Record<string, unknown>) {
  const started = performance.now();
  let first: number | null = null;
  let usage: Record<string, number | undefined> = {};
  let calls = 0;
  const stream = await ai.models.generateContentStream({
    model,
    contents: contents as never,
    config: { maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'low' as never }, ...config }
  });
  for await (const chunk of stream) {
    first ??= performance.now() - started;
    if (chunk.usageMetadata) usage = usageOf(chunk);
    calls += chunk.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).length ?? 0;
  }
  return {
    firstChunkMs: first,
    totalMs: performance.now() - started,
    prompt: usage.promptTokenCount ?? null,
    cached: usage.cachedContentTokenCount ?? null,
    output: usage.candidatesTokenCount ?? null,
    thoughts: usage.thoughtsTokenCount ?? null,
    calls
  };
}

/** A synthetic multi-round run: static prefix plus growing text-only history. */
type Arm = 'implicit' | 'explicit' | 'hybrid';
const ARMS = (process.env.CHAT_CACHE_ARMS ?? 'implicit,explicit').split(',') as Arm[];
/** Hybrid: cached while the previous reported prompt stayed below the switch, then inline. */
const SWITCH_TOKENS = Number(process.env.CHAT_CACHE_SWITCH_TOKENS ?? 16_000);
async function syntheticRun(arm: Arm, tools: Tools, cacheName?: string) {
  const nonce = randomUUID().slice(0, 8);
  const contents: unknown[] = [];
  const results: (Awaited<ReturnType<typeof streamed>> & { round: number; usedCache: boolean })[] =
    [];
  for (let round = 0; round < rounds; round++) {
    const useCache =
      arm === 'explicit' || (arm === 'hybrid' && (results.at(-1)?.prompt ?? 0) < SWITCH_TOKENS);
    contents.push({
      role: 'user',
      parts: [
        {
          text: `${filler(nonce, round)}\nUsing only the observations above, in one sentence, which module retries most? Do not call tools.`
        }
      ]
    });
    const config = useCache
      ? { cachedContent: cacheName }
      : {
          systemInstruction: SYSTEM,
          tools,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
        };
    const r = await streamed(contents, config);
    results.push({ round, usedCache: useCache, ...r });
    contents.push({ role: 'model', parts: [{ text: `Noted round ${round}.` }] });
  }
  return results;
}

try {
  const read = await catalogFor('read');
  const write = await catalogFor('request');
  const manifests = {
    status: toolsOf(['status'], read),
    repository: toolsOf(['repository'], read),
    knowledgebase_read: toolsOf(['knowledgebase'], read),
    knowledgebase_write: toolsOf(['knowledgebase'], write),
    full_read: toolsOf(['status', 'repository', 'knowledgebase', 'feature'], read),
    full_write: toolsOf(['status', 'repository', 'knowledgebase', 'feature'], write)
  };

  const probes = process.env.CHAT_CACHE_SKIP_PROBES !== '1';
  // 1. Static token counts (provider usage, control subtracted) and cache eligibility.
  if (probes) {
    const control = await promptTokens({});
    const systemOnly = (await promptTokens({ systemInstruction: SYSTEM })) - control;
    const eligibility: Record<string, unknown> = {};
    for (const [name, tools] of Object.entries(manifests)) {
      const staticTokens = (await promptTokens({ systemInstruction: SYSTEM, tools })) - control;
      const made = await attempt(() => createCache(tools, '120s'));
      eligibility[name] = {
        staticTokens,
        toolsBytes: Buffer.byteLength(JSON.stringify(tools)),
        cacheCreated: made.ok,
        ...(made.ok
          ? { cacheTokens: made.value.tokens, createMs: Math.round(made.value.createMs) }
          : { error: made.error })
      };
      if (made.ok) {
        await ai.caches.delete({ name: made.value.name });
        created.delete(made.value.name);
      }
      console.error(name, JSON.stringify(eligibility[name]));
    }
    report.static = { controlPromptTokens: control, systemInstructionTokens: systemOnly };
    report.eligibility = eligibility;
  }

  // 2. Request-shape compatibility against a cache holding system + tools.
  const tools = manifests.full_write;
  const cache = await createCache(tools, '600s');
  const ask = [{ role: 'user', parts: [{ text: 'List my Knowledgebase workspaces.' }] }];
  const compat: Record<string, unknown> = {};
  if (probes) {
    const probe = async (label: string, config: Record<string, unknown>) => {
      const r = await attempt(() => streamed(ask, config));
      compat[label] = r.ok ? { ok: true, calls: r.value.calls, cached: r.value.cached } : r;
      console.error(label, JSON.stringify(compat[label]));
    };
    await probe('cachedOnly', { cachedContent: cache.name });
    await probe('cachedPlusAutoToolConfig', {
      cachedContent: cache.name,
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
    });
    await probe('cachedPlusNoneToolConfig', {
      cachedContent: cache.name,
      toolConfig: { functionCallingConfig: { mode: 'NONE' } }
    });
    await probe('cachedPlusSystemInstruction', {
      cachedContent: cache.name,
      systemInstruction: SYSTEM
    });
    await probe('cachedPlusTools', { cachedContent: cache.name, tools });
    const noneCache = await attempt(() => createCache(tools, '120s', 'NONE'));
    if (noneCache.ok) await probe('noneModeCache', { cachedContent: noneCache.value.name });
    else compat.noneModeCache = noneCache;
    report.compatibility = compat;

    // 3. Expiry and deletion behaviour (the fallback must classify these before any turn).
    const shortLived = await attempt(() => createCache(tools, '5s'));
    if (shortLived.ok) {
      await new Promise(r => setTimeout(r, 20_000));
      const used = await attempt(() => streamed(ask, { cachedContent: shortLived.value.name }));
      report.expired = used.ok ? { ok: true, note: 'served after TTL' } : used;
    } else report.expired = { createError: shortLived.error };
    const doomed = await createCache(tools, '120s');
    await ai.caches.delete({ name: doomed.name });
    created.delete(doomed.name);
    const afterDelete = await attempt(() => streamed(ask, { cachedContent: doomed.name }));
    report.deleted = afterDelete.ok ? { ok: true, note: 'served after delete' } : afterDelete;
    console.error('expiry', JSON.stringify({ expired: report.expired, deleted: report.deleted }));
  }

  // 4. Implicit vs explicit over repeated synthetic runs, alternating arm order.
  const runs: unknown[] = [];
  for (let i = 0; i < repeats; i++) {
    // Rotate arm order between repetitions.
    for (const arm of ARMS.map((_, j) => ARMS[(i + j) % ARMS.length]!)) {
      const rows = await syntheticRun(arm, tools, cache.name);
      runs.push({ repeat: i, arm, rows });
      console.error(
        arm,
        i,
        JSON.stringify(rows.map(r => [r.prompt, r.cached, Math.round(r.firstChunkMs ?? -1)]))
      );
    }
  }
  report.runs = runs;
  report.explicitCache = { tokens: cache.tokens, createMs: Math.round(cache.createMs) };
} finally {
  for (const name of created) await attempt(() => ai.caches.delete({ name }));
  report.finishedAt = new Date();
  writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
}
