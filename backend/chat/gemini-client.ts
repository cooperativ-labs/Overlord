import { GoogleGenAI } from '@google/genai';
import type { ChatRunFailureCode } from '@overlord/contract';

/**
 * Narrow seam over `@google/genai` 2.8.0 (`models.generateContentStream` /
 * `models.generateContent`, Generate Content API family, locally persisted history).
 * Tests script it; production wraps the SDK. Parts are passed through verbatim so
 * thought signatures stay attached to the part they were issued on.
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
    systemInstruction?: string;
    tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
    toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'NONE' } };
    responseMimeType?: string;
    responseJsonSchema?: unknown;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  };
}
export interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
}
export interface GeminiClient {
  stream(request: GeminiRequest): Promise<AsyncIterable<GeminiChunk>>;
  generate(request: GeminiRequest): Promise<{ text: string }>;
}

export function sdkGeminiClient(apiKey: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async stream(request) {
      return (await ai.models.generateContentStream(
        request as unknown as Parameters<typeof ai.models.generateContentStream>[0]
      )) as AsyncIterable<GeminiChunk>;
    },
    async generate(request) {
      const response = await ai.models.generateContent(
        request as unknown as Parameters<typeof ai.models.generateContent>[0]
      );
      return { text: response.text ?? '' };
    }
  };
}

const NETWORK = /fetch failed|network|econn|enotfound|etimedout|socket|timed out/;

/** True for SDK API errors (numeric status) and transport failures; other errors are bugs. */
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
  if (status === 400 && /token|context|too long|exceeds the maximum|input size/.test(message))
    return 'context_limit';
  if (status === 400) return 'provider_error';
  if ([401, 403, 404, 500, 502, 503, 504].includes(status)) return 'provider_unavailable';
  if (NETWORK.test(message)) return 'provider_unavailable';
  return 'provider_error';
}
