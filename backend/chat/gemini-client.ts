import { createOpenRouterClient } from '@overlord/automations/openrouter';
import type { ChatRunFailureCode } from '@overlord/contract';

/** Legacy part names preserve checkpoint compatibility. Production translates these
 * parts to OpenRouter chat completions; no Google SDK or explicit cache API is used.
 */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    partialArgs?: unknown;
    willContinue?: boolean;
  };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  [key: string]: unknown;
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: unknown;
}
export interface GeminiRequest {
  model: string;
  contents: GeminiContent[];
  config: {
    /** Explicit cache holding the system instruction, tools and tool config (never with them). */
    cachedContent?: string;
    systemInstruction?: string;
    tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
    toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'NONE' } };
    responseMimeType?: string;
    responseJsonSchema?: unknown;
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' };
    abortSignal?: AbortSignal;
  };
}
export interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  /** Provider reports cumulative usage for this exchange, usually in its final chunk. */
  usageMetadata?: Record<string, unknown>;
}
/** A static prefix to cache: exactly what a cached request then omits. */
export interface GeminiCacheCreate {
  model: string;
  config: {
    systemInstruction: string;
    tools: { functionDeclarations: GeminiFunctionDeclaration[] }[];
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } };
    ttl: string;
    displayName?: string;
    abortSignal?: AbortSignal;
  };
}
export interface GeminiCreatedCache {
  name: string;
  expireTime?: string;
  usageMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface GeminiClient {
  stream(request: GeminiRequest): Promise<AsyncIterable<GeminiChunk>>;
  generate(request: GeminiRequest): Promise<{ text: string; rawResponse?: unknown }>;
  /** Optional: clients without explicit caching always send requests inline. */
  createCache?(request: GeminiCacheCreate): Promise<GeminiCreatedCache>;
  deleteCache?(name: string): Promise<void>;
}

export function sdkGeminiClient(apiKey: string): GeminiClient {
  const client = createOpenRouterClient(apiKey);
  return {
    stream: request => client.stream(request),
    generate: request => client.models.generateContent(request)
  };
}

const NETWORK = /fetch failed|network|econn|enotfound|etimedout|socket|timed out|timeout/;

/** True for provider API errors (numeric status) and transport failures; other errors are bugs. */
export function isProviderError(error: unknown): boolean {
  return (
    typeof (error as { status?: unknown })?.status === 'number' ||
    NETWORK.test(String((error as { message?: unknown })?.message ?? '').toLowerCase())
  );
}

/** Maps a provider failure to the closed run failure vocabulary without logging content. */
export function classifyGeminiError(error: unknown): ChatRunFailureCode {
  const status = Number((error as { status?: unknown })?.status);
  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
  if (status === 429 || message.includes('resource_exhausted')) return 'rate_limited';
  if (
    [400, 413].includes(status) &&
    /token|context|too long|exceeds the maximum|input size/.test(message)
  )
    return 'context_limit';
  if (status === 400) return 'provider_error';
  if ([401, 403, 404, 500, 502, 503, 504].includes(status)) return 'provider_unavailable';
  if (NETWORK.test(message)) return 'provider_unavailable';
  return 'provider_error';
}
