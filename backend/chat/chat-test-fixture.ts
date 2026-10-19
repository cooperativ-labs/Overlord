import assert from 'node:assert/strict';

import type { ChatRuns } from '../../packages/core/service/chat/runs.ts';
import type { ChatToolGateway } from '../../packages/core/service/chat/tools.ts';

import { EvaluationGeminiRuntime } from './evaluation-runtime-test-fixture.ts';
import type { GeminiChunk, GeminiClient, GeminiPart, GeminiRequest } from './gemini-client.ts';
import type { GeminiRuntimeOptions } from './gemini-runtime.ts';

/** Scripted Gemini: each provider request gets the next scripted turn (parts or an error). */
export class ScriptedGemini implements GeminiClient {
  readonly requests: GeminiRequest[] = [];
  readonly generated: GeminiRequest[] = [];
  constructor(
    private readonly script: ((req: GeminiRequest) => GeminiPart[] | Error)[],
    private readonly summary: string | null | undefined = undefined,
    private readonly finishReason = 'STOP'
  ) {}
  async stream(request: GeminiRequest): Promise<AsyncIterable<GeminiChunk>> {
    this.requests.push(
      structuredClone({ ...request, config: { ...request.config, abortSignal: undefined } })
    );
    const step = this.script.shift();
    if (!step) throw new Error('script exhausted');
    const out = step(request);
    if (out instanceof Error) throw out;
    return (async function* () {
      // Two chunks, so text is coalesced across chunk boundaries.
      const half = Math.ceil(out.length / 2);
      yield { candidates: [{ content: { parts: out.slice(0, half) } }] };
      if (out.length > half) yield { candidates: [{ content: { parts: out.slice(half) } }] };
    })();
  }
  async generate(request: GeminiRequest) {
    this.generated.push(request);
    if (this.summary === undefined) return { text: 'summary' };
    if (!this.summary) throw new Error('no summary');
    return {
      text: this.summary,
      rawResponse: {
        text: this.summary,
        candidates: [{ finishReason: this.finishReason }],
        usageMetadata: { totalTokenCount: 777 }
      }
    };
  }
}
export const call = (
  name: string,
  args: Record<string, unknown>,
  id?: string,
  sig?: string
): GeminiPart => ({
  functionCall: { name, args, ...(id ? { id } : {}) },
  ...(sig ? { thoughtSignature: sig } : {})
});
export const text = (t: string): GeminiPart => ({ text: t });

export const declaredNames = (req: GeminiRequest) =>
  (req.config.tools?.[0]?.functionDeclarations ?? []).map(d => d.name);
/** Function responses across the provider request, in call order. */
export const responses = (req: GeminiRequest) =>
  req.contents
    .flatMap(c => c.parts)
    .filter(p => p.functionResponse)
    .map(p => p.functionResponse!.response as Record<string, unknown>);
export const promptText = (req: GeminiRequest) =>
  req.contents
    .flatMap(c => c.parts)
    .map(p => p.text ?? '')
    .join('\n');

export function scriptedRuntime(
  gateway: ChatToolGateway,
  client: GeminiClient,
  overrides: Partial<GeminiRuntimeOptions> = {}
) {
  return new EvaluationGeminiRuntime({
    client,
    gateway,
    coalesceMs: 0,
    summaryEveryMessages: 100,
    ...overrides
  });
}

export async function executeNext(runs: ChatRuns, rt: EvaluationGeminiRuntime) {
  const attempt = await runs.claim('worker', rt.identity);
  assert.ok(attempt, 'a run is claimable');
  await rt.execute(attempt, runs, new AbortController().signal);
  return attempt;
}
