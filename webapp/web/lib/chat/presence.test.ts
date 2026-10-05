import type { UpdateChatPresenceBody } from '@overlord/contract';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { ChatPresence } from './presence.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await tick();
};

function harness(options: { failAck?: number } = {}) {
  const log: string[] = [];
  let ackFailures = options.failAck ?? 0;
  const presence = new ChatPresence(
    'thread-1',
    {
      updatePresence: async (_id, body: UpdateChatPresenceBody) => {
        log.push(`presence:${body.state}`);
        return { clientId: body.clientId, expiresAt: null };
      },
      ack: async (_id, body) => {
        if (ackFailures > 0) {
          ackFailures -= 1;
          log.push(`ack-failed:${body.seq}`);
          throw new Error('offline');
        }
        log.push(`ack:${body.seq}`);
        return { clientId: body.clientId, ackedSeq: body.seq, suppressedNotificationIds: [] };
      }
    },
    { clientId: 'web-test', platform: 'web', ttlMs: 60_000 }
  );
  return { presence, log };
}

let active: ChatPresence | null = null;
afterEach(() => active?.stop());

describe('chat presence and acknowledgement', () => {
  it('never acknowledges while the tab is not foreground', async () => {
    const { presence, log } = harness();
    active = presence;
    presence.rendered(5);
    await settle();
    assert.deepEqual(log, []);
  });

  it('acknowledges rendered events only after presence is renewed', async () => {
    const { presence, log } = harness();
    active = presence;
    presence.rendered(3);
    presence.setForeground(true);
    await settle();
    assert.deepEqual(log, ['presence:foreground', 'ack:3']);
  });

  it('coalesces renders and keeps acknowledgements monotonic', async () => {
    const { presence, log } = harness();
    active = presence;
    presence.setForeground(true);
    await settle();
    presence.rendered(4);
    presence.rendered(6);
    presence.rendered(5);
    await settle();
    presence.rendered(6);
    await settle();
    const acks = log.filter(entry => entry.startsWith('ack:'));
    assert.deepEqual(acks.at(-1), 'ack:6');
    assert.ok(!acks.includes('ack:5'));
    assert.equal(acks.filter(entry => entry === 'ack:6').length, 1);
  });

  it('releases presence when the tab goes to the background and stops acknowledging', async () => {
    const { presence, log } = harness();
    active = presence;
    presence.setForeground(true);
    presence.rendered(1);
    await settle();
    presence.setForeground(false);
    presence.rendered(2);
    await settle();
    assert.deepEqual(log, ['presence:foreground', 'ack:1', 'presence:released']);
    presence.setForeground(true);
    await settle();
    assert.deepEqual(log.slice(-2), ['presence:foreground', 'ack:2']);
  });

  it('retries a failed acknowledgement on the next render', async () => {
    const { presence, log } = harness({ failAck: 1 });
    active = presence;
    presence.setForeground(true);
    presence.rendered(2);
    await settle();
    presence.rendered(2);
    await settle();
    assert.deepEqual(
      log.filter(entry => entry.includes('ack')),
      ['ack-failed:2', 'ack:2']
    );
  });
});
