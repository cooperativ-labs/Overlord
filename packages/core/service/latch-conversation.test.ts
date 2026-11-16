/**
 * Latch v2 Conversation Hub client (coo:833 Phase C).
 *
 * The fake gateway below is a real loopback HTTP server that serves
 * `/v2/capabilities` and performs the RFC 6455 upgrade for
 * `/v2/sessions/{id}/conversation`, so these tests exercise the production
 * `WebSocket` client — subprotocol token, server-first snapshot, and all —
 * rather than a stubbed transport.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  latchConversationSocketUrl,
  LatchGatewayError,
  parseLatchGatewayCapabilities,
  resolveLatchGatewayCandidates,
  resolveLatchGatewayConfig
} from './latch-gateway.ts';
import { LatchSessionCommandError, sendLatchMessage } from './latch-session.ts';
import { SESSION_ID, snapshot, stateChanged, TOKEN, withGateway } from './test-latch-gateway.ts';

test('an idle session accepts the answer', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted',
          itemId: 'item-1',
          reason: null
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-1',
        text: 'ship it',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(outcome.reason, null);
      assert.equal(outcome.operationId, 'req-1');
      assert.deepEqual(gateway.received, [
        {
          type: 'send_message',
          operationEpoch: 'epoch-1',
          operationId: 'req-1',
          text: 'ship it'
        }
      ]);
    }
  );
});

test('a working session is waited out until send becomes enabled', async () => {
  await withGateway(
    {
      onOpen: session => {
        session.send(snapshot({ phase: 'working', enabled: false, reason: 'agent is busy' }));
        setTimeout(() => session.send(stateChanged({ phase: 'idle', enabled: true })), 20);
      },
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted'
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-2',
        text: 'yes',
        waitForIdleMs: 2_000,
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(gateway.received.length, 1);
    }
  );
});

test('an exited session refuses without sending anything', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send(
          snapshot({ phase: 'exited', enabled: false, reason: 'the session has exited' })
        )
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-3',
        text: 'too late',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'refused');
      assert.equal(outcome.reason, 'the session has exited');
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('a busy session that never frees up refuses with the gateway reason', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send(snapshot({ phase: 'working', enabled: false, reason: 'agent is busy' }))
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-4',
        text: 'hello',
        waitForIdleMs: 60,
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'refused');
      assert.equal(outcome.reason, 'agent is busy');
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('an ambiguous result is reported verbatim and never resent', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'ambiguous',
          reason: 'the connector did not confirm'
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-5',
        text: 'maybe',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'ambiguous');
      assert.equal(outcome.reason, 'the connector did not confirm');
      assert.equal(gateway.received.length, 1);
    }
  );
});

test('event-driven observer frames may interleave before the correlated result', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) => {
        session.send({
          type: 'items_upserted',
          generation: 'gen-1',
          revision: 5,
          items: [
            {
              id: 'message-1',
              ordinal: 1,
              createdAt: '2026-08-30T00:00:00Z',
              kind: { type: 'message', role: 'assistant', text: 'done', status: 'complete' }
            }
          ]
        });
        session.send(stateChanged({ phase: 'working', enabled: false }));
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted'
        });
      }
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-event-driven',
        text: 'continue',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(gateway.received.length, 1);
    }
  );
});

test('a conversation that drops after the send is ambiguous, not refused', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (_message, session) => session.close()
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-6',
        text: 'dropped',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'ambiguous');
    }
  );
});

test('a gateway error before the send is a command failure', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send({ type: 'error', code: 'unavailable', message: 'conversation is unavailable' })
    },
    async gateway => {
      await assert.rejects(
        sendLatchMessage({
          providerSessionId: SESSION_ID,
          operationId: 'req-7',
          text: 'hello',
          gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
        }),
        (error: unknown) =>
          error instanceof LatchSessionCommandError &&
          error.message === 'conversation is unavailable'
      );
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('a gateway without the conversation endpoint fails before any upgrade', async () => {
  await withGateway({ conversation: false }, async gateway => {
    await assert.rejects(
      sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-8',
        text: 'hello',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      }),
      /does not serve the conversation endpoint/
    );
  });
});

test('a gateway on an unsupported protocol major is refused', async () => {
  await withGateway({ protocolVersion: 3 }, async gateway => {
    await assert.rejects(
      sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-9',
        text: 'hello',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      }),
      /protocolVersion 3 is not supported/
    );
  });
});

test('empty text and a missing operation id are rejected before dialing', async () => {
  await assert.rejects(
    sendLatchMessage({ providerSessionId: SESSION_ID, operationId: 'req-10', text: '   ' }),
    /answer message is required/
  );
  await assert.rejects(
    sendLatchMessage({ providerSessionId: SESSION_ID, operationId: ' ', text: 'hello' }),
    /operation id is required/
  );
});

test('a queued receipt is a delivered answer, not an unconfirmed one', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'working', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'queued',
          itemId: null,
          reason: null
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-queued',
        text: 'after this turn',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.match(outcome.reason ?? '', /queued/);
    }
  );
});

test('a delivery past its deadline is refused without contacting Latch', async () => {
  await withGateway({}, async gateway => {
    const outcome = await sendLatchMessage({
      providerSessionId: SESSION_ID,
      operationId: 'req-late',
      text: 'stale answer',
      notAfter: new Date(Date.now() - 1_000).toISOString(),
      gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
    });
    assert.equal(outcome.status, 'refused');
    assert.match(outcome.reason ?? '', /deadline/);
    assert.deepEqual(gateway.received, []);
  });
});

function receiptGateway(receipt: string) {
  return {
    onOpen: (session: { send(message: unknown): void }) =>
      session.send(snapshot({ phase: 'idle', enabled: true })),
    onMessage: (message: Record<string, unknown>, session: { send(message: unknown): void }) =>
      session.send({
        type: 'operation_result',
        operationId: message.operationId,
        status: message.type === 'operation_status' ? receipt : 'accepted',
        itemId: null,
        reason: null
      })
  };
}

test('an earlier attempt Latch already delivered is reconciled and nothing is sent', async () => {
  await withGateway(receiptGateway('accepted'), async gateway => {
    const outcome = await sendLatchMessage({
      providerSessionId: SESSION_ID,
      operationId: 'req-1.2',
      previousOperationId: 'req-1',
      text: 'ship it',
      gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(outcome.reconciled, true);
    assert.deepEqual(gateway.received, [{ type: 'operation_status', operationId: 'req-1' }]);
  });
});

test('an earlier attempt still in flight sends nothing and stays ambiguous', async () => {
  await withGateway(receiptGateway('ambiguous'), async gateway => {
    const outcome = await sendLatchMessage({
      providerSessionId: SESSION_ID,
      operationId: 'req-1.2',
      previousOperationId: 'req-1',
      text: 'ship it',
      gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
    });
    assert.equal(outcome.status, 'ambiguous');
    assert.deepEqual(
      gateway.received.map(message => message.type),
      ['operation_status']
    );
  });
});

for (const receipt of ['refused', 'unknown']) {
  test(`an earlier attempt with a ${receipt} receipt lets the new attempt send once`, async () => {
    await withGateway(receiptGateway(receipt), async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-1.2',
        previousOperationId: 'req-1',
        text: 'ship it',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(outcome.reconciled, undefined);
      assert.deepEqual(gateway.received, [
        { type: 'operation_status', operationId: 'req-1' },
        { type: 'send_message', operationEpoch: 'epoch-1', operationId: 'req-1.2', text: 'ship it' }
      ]);
    });
  });
}

test('discovery offers the Remote Link gateway and uses the one that answers', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted',
          itemId: null,
          reason: null
        })
    },
    async gateway => {
      const home = mkdtempSync(path.join(tmpdir(), 'ovld-latch-home-'));
      try {
        const runtime = path.join(home, 'remote-access', 'runtime');
        mkdirSync(runtime, { recursive: true });
        writeFileSync(
          path.join(runtime, 'remote-link-gateway-ready.json'),
          JSON.stringify({ formatVersion: 2, url: gateway.baseUrl, protocolVersion: 2 })
        );
        writeFileSync(path.join(runtime, 'remote-link-gateway.token'), `${gateway.token}\n`);
        const env = { LATCH_HOME: home } as NodeJS.ProcessEnv;
        assert.deepEqual(resolveLatchGatewayCandidates({ env }), [
          { baseUrl: gateway.baseUrl, token: gateway.token }
        ]);
        const outcome = await sendLatchMessage({
          providerSessionId: SESSION_ID,
          operationId: 'req-remote-link',
          text: 'through the supervised gateway',
          env
        });
        assert.equal(outcome.status, 'accepted');

        // A stale standalone token must not mask the gateway that is running.
        writeFileSync(path.join(home, 'serve.token'), 'stale-token\n');
        assert.equal(resolveLatchGatewayCandidates({ env }).length, 2);
        const second = await sendLatchMessage({
          providerSessionId: SESSION_ID,
          operationId: 'req-remote-link-2',
          text: 'still through the supervised gateway',
          env
        });
        assert.equal(second.status, 'accepted');
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  );
});

test('a Remote Link readiness document off loopback is never used', () => {
  const files: Record<string, string> = {
    '/h/remote-access/runtime/remote-link-gateway-ready.json': JSON.stringify({
      url: 'http://192.168.1.20:4610'
    }),
    '/h/remote-access/runtime/remote-link-gateway.token': TOKEN
  };
  assert.throws(
    () =>
      resolveLatchGatewayCandidates({
        env: { LATCH_HOME: '/h' } as NodeJS.ProcessEnv,
        fileExists: file => file in files,
        readFile: file => files[file]!
      }),
    /latch serve/
  );
});

test('gateway config defaults to the loopback bind and refuses anything else', () => {
  const config = resolveLatchGatewayConfig({
    env: { LATCH_GATEWAY_TOKEN: TOKEN } as NodeJS.ProcessEnv
  });
  assert.equal(config.baseUrl, 'http://127.0.0.1:4610');
  assert.equal(config.token, TOKEN);

  assert.throws(
    () =>
      resolveLatchGatewayConfig({
        env: {
          LATCH_GATEWAY_URL: 'http://192.168.1.20:4610',
          LATCH_GATEWAY_TOKEN: TOKEN
        } as NodeJS.ProcessEnv
      }),
    (error: unknown) =>
      error instanceof LatchGatewayError && /non-loopback host/.test(error.message)
  );
});

test('a missing gateway token names the file to create', () => {
  assert.throws(
    () =>
      resolveLatchGatewayConfig({
        env: { LATCH_HOME: '/nowhere/.latch' } as NodeJS.ProcessEnv,
        fileExists: () => false
      }),
    /latch serve/
  );
});

test('the conversation socket url is the ws form of the loopback origin', () => {
  assert.equal(
    latchConversationSocketUrl({
      gateway: { baseUrl: 'http://127.0.0.1:4610', token: TOKEN },
      providerSessionId: 'ses_1'
    }),
    'ws://127.0.0.1:4610/v2/sessions/ses_1/conversation'
  );
});

test('a capabilities document missing required fields is not accepted', () => {
  assert.equal(parseLatchGatewayCapabilities({ protocolVersion: 2 }), null);
  assert.equal(
    parseLatchGatewayCapabilities({
      protocolVersion: 2,
      productVersion: '1.0.0',
      endpoints: { sessions: true, terminal: true, conversation: true },
      gatewayInstanceId: 'gw-a-b'
    })?.endpoints.preview,
    null
  );
});

/**
 * Source guard, in the spirit of `connectors/adapters/opencode/fixtures/
 * sidecar-loopback-only.json`: the Latch gateway speaks plaintext HTTP and its
 * bearer token grants `control`, so this client must only ever dial loopback.
 * A runtime test cannot pin this — the dangerous version works too.
 */
test('the Latch conversation client dials loopback only', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sources = ['latch-gateway.ts', 'latch-session.ts'].map(name =>
    readFileSync(path.join(here, name), 'utf8')
  );
  const gatewaySource = sources[0];
  assert.match(gatewaySource, /127\.0\.0\.1/);
  assert.match(gatewaySource, /isLoopbackHostname/);
  for (const source of sources) {
    for (const forbidden of ['0.0.0.0', "'::'", '"::"', 'allow-remote', 'allowRemote']) {
      assert.ok(
        !source.includes(forbidden),
        `a wildcard/remote marker leaked into the Latch conversation client: ${forbidden}`
      );
    }
  }
});
