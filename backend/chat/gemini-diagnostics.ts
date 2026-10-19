import { randomUUID } from 'node:crypto';

import {
  ChatPerformance,
  withChatPerformance
} from '../../packages/core/service/chat/performance.ts';
import type { ChatAttempt, ChatRuns } from '../../packages/core/service/chat/runs.ts';

import type { GeminiChunk, GeminiClient, GeminiRequest } from './gemini-client.ts';
import type { StaticPrefix } from './static-cache.ts';

/** Per-attempt aggregates. Missing provider usage remains missing. */
export class RunMetrics extends ChatPerformance {
  providerRounds = 0;
  providerRequests = 0;
  completedRounds = 0;
  summaryRounds = 0;
  usageExchanges = 0;
  tokenTotals: Record<string, number> = {};
  tokenReportedExchanges: Record<string, number> = {};
  schemaBytes = { systemMax: 0, toolsMax: 0, requestMax: 0, requestTotal: 0 };
  staticCacheRequests = 0;
  staticCacheFallbacks = 0;

  usage(raw: unknown) {
    const usage = (raw as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
    if (!usage) return;
    this.usageExchanges++;
    for (const key of [
      'promptTokenCount',
      'cachedContentTokenCount',
      'candidatesTokenCount',
      'thoughtsTokenCount'
    ]) {
      const value = usage[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        this.tokenTotals[key] = (this.tokenTotals[key] ?? 0) + value;
        this.tokenReportedExchanges[key] = (this.tokenReportedExchanges[key] ?? 0) + 1;
      }
    }
  }

  requestMetrics(request: GeminiRequest, effective = request.config) {
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? 'null');
    const sizes = {
      system: Buffer.byteLength(effective.systemInstruction ?? ''),
      tools: bytes(effective.tools ?? []),
      request: bytes(request)
    };
    this.schemaBytes.systemMax = Math.max(this.schemaBytes.systemMax, sizes.system);
    this.schemaBytes.toolsMax = Math.max(this.schemaBytes.toolsMax, sizes.tools);
    this.schemaBytes.requestMax = Math.max(this.schemaBytes.requestMax, sizes.request);
    this.schemaBytes.requestTotal += sizes.request;
    return { elapsedMs: this.elapsed(), sizes };
  }

  async measure(run: () => Promise<void>, report: (failed: boolean) => Promise<unknown>) {
    let failed = false;
    let failure: unknown;
    try {
      await withChatPerformance(this, run);
    } catch (error) {
      failed = true;
      failure = error;
    }
    // Reporting stays outside the scope and never replaces the original failure.
    try {
      await report(failed);
    } catch (error) {
      if (!failed) throw error;
    }
    if (failed) throw failure;
  }

  attemptPayload(
    run: Awaited<ReturnType<ChatRuns['run']>>,
    attempt: ChatAttempt,
    signal: AbortSignal,
    failed: boolean
  ) {
    return {
      version: 1,
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      runWallMs: run.completed_at
        ? Date.parse(run.completed_at) - Date.parse(run.created_at)
        : null,
      recoveryMode: attempt.recoveryMode,
      state: run.state,
      failed,
      aborted: signal.aborted,
      first: this.first,
      spans: this.spans,
      providerRounds: this.providerRounds,
      providerRequests: this.providerRequests,
      completedRounds: this.completedRounds,
      summaryRounds: this.summaryRounds,
      usageExchanges: this.usageExchanges,
      tokens: this.tokenTotals,
      tokenReportedExchanges: this.tokenReportedExchanges,
      schemaBytes: this.schemaBytes,
      staticCache: {
        requests: this.staticCacheRequests,
        fallbacks: this.staticCacheFallbacks
      }
    };
  }
}

export function instrumentGeminiClient(
  client: GeminiClient,
  hooks: {
    record: (kind: string, payload: unknown) => Promise<unknown>;
    metrics?: RunMetrics;
    contentBytes: (request: GeminiRequest) => number;
    staticUseFor: (
      request: GeminiRequest
    ) => { name: string; key: string; prefix: StaticPrefix } | undefined;
    onExchange: (exchange: { promptTokens: number; contentBytes: number }) => void;
  }
): GeminiClient {
  const { record, metrics } = hooks;
  return {
    async stream(request) {
      const exchangeId = randomUUID();
      if (metrics) metrics.providerRequests++;
      const started = metrics ? performance.now() : 0;
      const contentBytes = hooks.contentBytes(request);
      const cached = hooks.staticUseFor(request);
      await record('provider.request', {
        exchangeId,
        method: 'stream',
        request,
        // The effective input stays inspectable when a cache reference replaces the prefix.
        ...(cached
          ? { staticCache: { name: cached.name, key: cached.key, ...cached.prefix } }
          : {}),
        performance: metrics?.requestMetrics(
          request,
          cached ? { ...request.config, ...cached.prefix } : request.config
        )
      });
      try {
        const stream = await client.stream(request);
        if (metrics) metrics.providerRounds++;
        return (async function* () {
          let latestUsage: unknown;
          let completed = false;
          try {
            for await (const chunk of stream) {
              if ((chunk as { usageMetadata?: unknown }).usageMetadata) latestUsage = chunk;
              if (!metrics) {
                await record('provider.chunk', { exchangeId, chunk });
                yield chunk;
                continue;
              }
              const receivedAt = new Date().toISOString();
              const elapsedMs = metrics.elapsed();
              const exchangeElapsedMs = performance.now() - started;
              metrics.mark('sdkChunk');
              if (chunk.candidates?.[0]?.content?.parts?.some(p => p.text && !p.thought))
                metrics.mark('nonThoughtText');
              await record('provider.chunk', {
                exchangeId,
                chunk,
                performance: { receivedAt, elapsedMs, exchangeElapsedMs }
              });
              yield chunk;
            }
            if (metrics) metrics.completedRounds++;
            completed = true;
            await record('provider.completed', { exchangeId });
          } catch (error) {
            await record('provider.error', { exchangeId, error });
            throw error;
          } finally {
            // Streaming usage is cumulative within an exchange: count the last report once.
            metrics?.usage(latestUsage);
            const prompt = (latestUsage as GeminiChunk | undefined)?.usageMetadata
              ?.promptTokenCount;
            if (completed && typeof prompt === 'number' && Number.isFinite(prompt))
              hooks.onExchange({ promptTokens: prompt, contentBytes });
            await record('provider.stream_closed', { exchangeId });
          }
        })();
      } catch (error) {
        await record('provider.error', { exchangeId, error });
        throw error;
      }
    },
    async generate(request) {
      const exchangeId = randomUUID();
      if (metrics) metrics.summaryRounds++;
      const cached = hooks.staticUseFor(request);
      await record('provider.request', {
        exchangeId,
        method: 'generate',
        request,
        performance: metrics?.requestMetrics(
          request,
          cached ? { ...request.config, ...cached.prefix } : request.config
        )
      });
      try {
        const result = await client.generate(request);
        metrics?.usage(result.rawResponse);
        await record('provider.response', { exchangeId, response: result.rawResponse ?? result });
        return result;
      } catch (error) {
        await record('provider.error', { exchangeId, error });
        throw error;
      }
    }
  };
}
