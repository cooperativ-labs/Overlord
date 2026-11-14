import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readGeminiConfigFromEnv } from '../title-summarizer/config.js';

import { createOpenRouterClient, type Request, requestBody } from './index.js';

const request: Request = {
  model: 'gemini-3.8-flash',
  contents: [{ role: 'user', parts: [{ text: 'Synthetic question' }] }],
  config: {
    systemInstruction: 'Synthetic system',
    tools: [
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'Synthetic tool',
            parametersJsonSchema: { type: 'object' }
          }
        ]
      }
    ],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    thinkingConfig: { thinkingLevel: 'low' }
  }
};
function scriptedFetch(response: Response, inspect?: (init: RequestInit) => void): typeof fetch {
  return (async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-key');
    inspect?.(init!);
    return response;
  }) as typeof fetch;
}
function sse(events: unknown[], complete = true) {
  const text =
    ': keepalive\r\n\r\n' +
    events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') +
    (complete ? 'data: [DONE]\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split every UTF-8 sequence, event and CRLF boundary.
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      }
    })
  );
}

test('credentials use OpenRouter only and preserve Google model defaults', () => {
  assert.equal(readGeminiConfigFromEnv({ GEMINI_API_KEY: 'old-key' }), null);
  assert.deepEqual(readGeminiConfigFromEnv({ OPENROUTER_API_KEY: ' synthetic-key ' }), {
    apiKey: 'synthetic-key',
    model: 'gemini-3.5-flash-lite'
  });
  assert.equal(requestBody(request).model, 'google/gemini-3.8-flash');
});

test('maps prompts, tools, JSON schemas, closing requests and usage', async () => {
  const schema = { type: 'object', properties: { answer: { type: 'string' } } };
  const client = createOpenRouterClient(
    'synthetic-key',
    scriptedFetch(
      Response.json({
        choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4 }
      }),
      init => {
        const body = JSON.parse(String(init.body));
        assert.equal(body.model, 'google/gemini-3.8-flash');
        assert.equal(body.messages[0].role, 'system');
        assert.equal(body.tools[0].function.name, 'lookup');
        assert.equal(body.tool_choice, 'none');
        assert.deepEqual(body.response_format.json_schema.schema, schema);
        assert.equal(body.reasoning.effort, 'low');
        assert.ok(init.signal);
      }
    )
  );
  const result = await client.models.generateContent({
    ...request,
    config: {
      ...request.config,
      toolConfig: { functionCallingConfig: { mode: 'NONE' } },
      responseJsonSchema: schema
    }
  });
  assert.equal(result.rawResponse.candidates[0]!.finishReason, 'STOP');
  assert.equal(result.rawResponse.usageMetadata?.promptTokenCount, 12);
});

test('assembles interleaved fragmented calls and replays ids and reasoning unchanged', async () => {
  const reasoning = [
    {
      type: 'reasoning.encrypted',
      data: 'synthetic-signature',
      index: 0,
      format: 'google-gemini-v1'
    }
  ];
  const client = createOpenRouterClient(
    'synthetic-key',
    scriptedFetch(
      sse([
        {
          choices: [
            {
              delta: {
                content: 'Café ',
                reasoning_details: reasoning,
                tool_calls: [
                  { index: 1, id: 'second', function: { name: 'lookup', arguments: '{"q":' } },
                  { index: 0, id: 'first', function: { name: 'lookup', arguments: '{"q":' } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '1}' } },
                  { index: 1, function: { arguments: '2}' } }
                ]
              }
            }
          ]
        },
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 9,
            prompt_tokens_details: { cached_tokens: 10 }
          }
        }
      ])
    )
  );
  const chunks = [];
  for await (const chunk of await client.stream(request)) chunks.push(chunk);
  const parts = chunks.flatMap(c => c.candidates?.[0]?.content?.parts ?? []);
  assert.equal(parts[0]!.text, 'Café ');
  assert.deepEqual(
    parts.filter(p => p.functionCall).map(p => p.functionCall),
    [
      { id: 'first', name: 'lookup', args: { q: 1 } },
      { id: 'second', name: 'lookup', args: { q: 2 } }
    ]
  );
  const body = requestBody({
    ...request,
    contents: [
      ...request.contents,
      { role: 'model', parts },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'lookup', id: 'first', response: { ok: 1 } } },
          { functionResponse: { name: 'lookup', id: 'second', response: { ok: 2 } } }
        ]
      }
    ]
  });
  const messages = body.messages as Record<string, unknown>[];
  assert.deepEqual(messages[2]!.reasoning_details, reasoning);
  assert.equal(messages[3]!.tool_call_id, 'first');
  assert.equal(messages[4]!.tool_call_id, 'second');
  assert.equal(chunks.find(c => c.usageMetadata)?.usageMetadata?.cachedContentTokenCount, 10);
});

test('incomplete and errored streams never yield assembled calls', async () => {
  for (const response of [
    sse(
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call', function: { name: 'lookup', arguments: '{}' } }
                ]
              }
            }
          ]
        }
      ],
      false
    ),
    sse([{ error: { code: 429, message: 'rate limited' } }])
  ]) {
    const client = createOpenRouterClient('synthetic-key', scriptedFetch(response));
    let calls = 0;
    await assert.rejects(async () => {
      for await (const chunk of await client.stream(request))
        calls += chunk.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).length ?? 0;
    });
    assert.equal(calls, 0);
  }
});

test('preserves status and classifies context errors without echoing upstream content', async () => {
  for (const status of [400, 401, 429, 503]) {
    const client = createOpenRouterClient(
      'synthetic-key',
      scriptedFetch(
        Response.json({ error: { message: 'private input exceeds context tokens' } }, { status })
      )
    );
    await assert.rejects(
      client.models.generateContent(request),
      (error: Error & { status?: number }) => {
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /private input/);
        if (status === 400) assert.match(error.message, /context/);
        return true;
      }
    );
  }
});

test('forwards cancellation to the upstream fetch', async () => {
  const abort = new AbortController();
  abort.abort();
  const client = createOpenRouterClient('synthetic-key', (async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw init?.signal?.reason;
  }) as typeof fetch);
  await assert.rejects(
    client.models.generateContent({ ...request, config: { abortSignal: abort.signal } })
  );
});

test('replays legacy signed checkpoint calls and assigns distinct ids when absent', () => {
  const body = requestBody({
    ...request,
    contents: [
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'lookup', args: { n: 1 } },
            thoughtSignature: 'legacy-signature'
          },
          { functionCall: { name: 'lookup', args: { n: 2 } } },
          { functionCall: { name: 'lookup', args: { n: 3 } } }
        ]
      },
      {
        role: 'user',
        parts: [1, 2, 3].map(n => ({ functionResponse: { name: 'lookup', response: { n } } }))
      }
    ]
  });
  const messages = body.messages as {
    tool_calls?: { id: string; extra_content?: unknown }[];
    tool_call_id?: string;
  }[];
  const calls = messages[1]!.tool_calls!;
  assert.equal(new Set(calls.map(c => c.id)).size, 3);
  assert.deepEqual(calls[0]!.extra_content, { google: { thought_signature: 'legacy-signature' } });
  assert.deepEqual(
    messages.slice(2).map(m => m.tool_call_id),
    calls.map(c => c.id)
  );
});
