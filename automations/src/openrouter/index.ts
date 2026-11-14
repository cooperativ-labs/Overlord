/** Server-only OpenRouter transport. Google model names keep their existing identity. */
export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  [key: string]: unknown;
}
export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  reasoning_details?: unknown[];
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  [key: string]: unknown;
}
export interface Request {
  model: string;
  contents: { role: 'user' | 'model'; parts: Part[] }[];
  config: {
    systemInstruction?: string;
    tools?: {
      functionDeclarations: { name: string; description: string; parametersJsonSchema: unknown }[];
    }[];
    toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'NONE' } };
    responseMimeType?: string;
    responseSchema?: unknown;
    responseJsonSchema?: unknown;
    maxOutputTokens?: number;
    temperature?: number;
    thinkingConfig?: { thinkingLevel?: string };
    abortSignal?: AbortSignal;
  };
}
export interface Chunk {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: Record<string, unknown>;
}
export const openRouterModel = (model: string): string =>
  model.includes('/') ? model : `google/${model}`;

export function requestBody(request: Request, stream = false): Record<string, unknown> {
  const { config } = request;
  const messages: Record<string, unknown>[] = [];
  if (config.systemInstruction)
    messages.push({ role: 'system', content: config.systemInstruction });
  const calls = new Map<string, string[]>();
  for (const turn of request.contents) {
    const toolCalls = turn.parts
      .filter(p => p.functionCall)
      .map((p, index) => {
        const call = p.functionCall!;
        const id = call.id || `call_${messages.length}_${index}`;
        calls.set(call.name!, [...(calls.get(call.name!) ?? []), id]);
        return {
          id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          ...(p.thoughtSignature
            ? { extra_content: { google: { thought_signature: p.thoughtSignature } } }
            : {})
        };
      });
    const text = turn.parts
      .filter(p => !p.thought && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
    const details = turn.parts.flatMap(p => p.reasoning_details ?? []);
    if (turn.role === 'model' || text)
      messages.push({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        ...(details.length ? { reasoning_details: details } : {})
      });
    for (const part of turn.parts)
      if (part.functionResponse) {
        const result = part.functionResponse;
        const ids = calls.get(result.name) ?? [];
        const id = result.id || ids[0];
        if (!id) throw new Error('Tool result has no matching call.');
        calls.set(
          result.name,
          ids.filter(value => value !== id)
        );
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result.response) });
      }
  }
  const tools = config.tools
    ?.flatMap(t => t.functionDeclarations)
    .map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parametersJsonSchema }
    }));
  const schema = config.responseJsonSchema ?? config.responseSchema;
  return {
    model: openRouterModel(request.model),
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(tools?.length
      ? {
          tools,
          tool_choice: config.toolConfig?.functionCallingConfig.mode === 'NONE' ? 'none' : 'auto'
        }
      : {}),
    ...(schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', schema, strict: false }
          }
        }
      : config.responseMimeType === 'application/json'
        ? { response_format: { type: 'json_object' } }
        : {}),
    ...(config.maxOutputTokens ? { max_tokens: config.maxOutputTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.thinkingConfig?.thinkingLevel
      ? { reasoning: { effort: config.thinkingConfig.thinkingLevel } }
      : {})
  };
}

type WireCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } };
type WireMessage = { content?: string; reasoning_details?: unknown[]; tool_calls?: WireCall[] };
type WireResponse = {
  error?: { code?: number; message?: string };
  choices?: { delta?: WireMessage; message?: WireMessage; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};
function providerError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
function checkError(value: WireResponse): void {
  if (value.error)
    throw providerError(
      value.error.code || 502,
      value.error.message || 'OpenRouter request failed.'
    );
}
function usage(value: WireResponse): Chunk {
  return value.usage
    ? {
        usageMetadata: {
          promptTokenCount: value.usage.prompt_tokens ?? 0,
          candidatesTokenCount: value.usage.completion_tokens ?? 0,
          totalTokenCount: value.usage.total_tokens ?? 0,
          cachedContentTokenCount: value.usage.prompt_tokens_details?.cached_tokens ?? 0,
          thoughtsTokenCount: value.usage.completion_tokens_details?.reasoning_tokens ?? 0
        }
      }
    : {};
}
export function createOpenRouterClient(apiKey: string, fetcher: typeof fetch = fetch) {
  async function send(request: Request, stream: boolean) {
    const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(request, stream)),
      signal: request.config.abortSignal
        ? AbortSignal.any([request.config.abortSignal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000)
    });
    if (!response.ok) {
      // Keep credentials and upstream response bodies out of automation logs.
      const body = (await response.json().catch(() => null)) as WireResponse | null;
      const context =
        response.status === 413 ||
        (response.status === 400 &&
          /token|context|too long|exceeds the maximum|input size/i.test(
            body?.error?.message ?? ''
          ));
      throw providerError(
        context ? 400 : response.status,
        `OpenRouter HTTP ${response.status}${context ? ' context limit' : ''}`
      );
    }
    return response;
  }
  return {
    models: {
      async generateContent(request: Request) {
        const raw = (await (await send(request, false)).json()) as WireResponse;
        checkError(raw);
        return {
          text: raw.choices?.[0]?.message?.content ?? '',
          ...usage(raw),
          rawResponse: {
            ...raw,
            ...usage(raw),
            candidates: [
              {
                finishReason:
                  raw.choices?.[0]?.finish_reason === 'stop'
                    ? 'STOP'
                    : raw.choices?.[0]?.finish_reason
              }
            ]
          }
        };
      }
    },
    async stream(request: Request): Promise<AsyncIterable<Chunk>> {
      const response = await send(request, true);
      if (!response.body) throw providerError(502, 'OpenRouter response body missing.');
      return (async function* () {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneMarker = false;
        const calls = new Map<number, { id: string; name: string; args: string }>();
        const details: unknown[] = [];
        try {
          while (!doneMarker) {
            const next = await reader.read();
            buffer += decoder.decode(next.value, { stream: !next.done });
            let boundary: RegExpExecArray | null;
            while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary[0].length);
              const data = event
                .split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
              if (!data) continue;
              if (data === '[DONE]') {
                doneMarker = true;
                break;
              }
              const raw = JSON.parse(data) as WireResponse;
              checkError(raw);
              const choice = raw.choices?.[0];
              const delta = choice?.delta;
              if (delta?.content)
                yield { candidates: [{ content: { parts: [{ text: delta.content }] } }] };
              if (delta?.reasoning_details) details.push(...delta.reasoning_details);
              for (const call of delta?.tool_calls ?? []) {
                const index = call.index ?? 0;
                const previous = calls.get(index) ?? { id: '', name: '', args: '' };
                if (call.id) previous.id = call.id;
                if (call.function?.name) previous.name += call.function.name;
                previous.args += call.function?.arguments ?? '';
                calls.set(index, previous);
              }
              if (choice?.finish_reason && !['stop', 'tool_calls'].includes(choice.finish_reason))
                throw providerError(502, 'OpenRouter stream incomplete or refused.');
              if (choice?.finish_reason)
                yield {
                  candidates: [
                    {
                      finishReason: choice.finish_reason === 'stop' ? 'STOP' : choice.finish_reason
                    }
                  ]
                };
              if (raw.usage) yield usage(raw);
            }
            if (next.done) break;
          }
          if (!doneMarker) throw providerError(502, 'OpenRouter stream ended before completion.');
          const parts: Part[] = [];
          if (details.length) parts.push({ reasoning_details: details });
          for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
            const args = JSON.parse(call.args || '{}') as Record<string, unknown>;
            if (!call.id || !call.name || !args || Array.isArray(args) || typeof args !== 'object')
              throw providerError(502, 'Invalid OpenRouter tool call.');
            parts.push({ functionCall: { id: call.id, name: call.name, args } });
          }
          if (parts.length) yield { candidates: [{ content: { parts } }] };
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      })();
    }
  };
}
