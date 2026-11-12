import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Webhook endpoints are held to the dispatcher's private-network rule on every
 * outbound request, including a test delivery, and literal private addresses
 * are refused when a subscription is saved.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webhook-target-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webhook-target.sqlite')
});
const { parseWebhookEndpointUrl, assertPublicWebhookTarget } =
  await import('./webhook-security.ts');
const { createWebhookSubscription, testWebhookSubscription, updateWebhookSubscription } =
  await import('./webhooks.ts');

const PRIVATE_LITERALS = [
  'https://10.1.2.3/hook',
  'https://169.254.169.254/latest',
  'https://0.0.0.0/hook',
  'https://[fd00::1]/hook',
  'https://[::ffff:169.254.169.254]/hook',
  'https://[::ffff:a9fe:a9fe]/hook',
  'https://[::]/hook'
];

function isBadRequest(error: unknown): boolean {
  return (error as { status?: number }).status === 400;
}

describe('webhook endpoint targets', () => {
  it('refuses literal private addresses at save time and before sending', async () => {
    for (const endpoint of PRIVATE_LITERALS) {
      assert.throws(() => parseWebhookEndpointUrl(endpoint), isBadRequest, endpoint);
      await assert.rejects(assertPublicWebhookTarget(new URL(endpoint)), isBadRequest, endpoint);
    }
    assert.equal(parseWebhookEndpointUrl('https://203.0.113.10/hook').hostname, '203.0.113.10');
    // Local edition trusts loopback, bracketed or not.
    await assertPublicWebhookTarget(new URL('http://[::1]:9/hook'));
  });

  it('refuses private targets on create, update and test delivery', async () => {
    await assert.rejects(
      createWebhookSubscription({
        name: 'private',
        endpointUrl: 'https://10.1.2.3/hook',
        eventTypes: ['mission.delivered'],
        workspaceId: harness.WORKSPACE.id
      }),
      isBadRequest
    );
    const created = await createWebhookSubscription({
      name: 'public',
      endpointUrl: 'https://203.0.113.10/hook',
      eventTypes: ['mission.delivered'],
      workspaceId: harness.WORKSPACE.id
    });
    const id = created.subscription.id;
    await assert.rejects(
      updateWebhookSubscription(id, { endpointUrl: 'https://169.254.169.254/latest' }),
      isBadRequest
    );

    // A row stored before save-time checks existed must still not be sent to.
    harness.db
      .prepare(`UPDATE webhook_subscriptions SET endpoint_url = ? WHERE id = ?`)
      .run('https://169.254.169.254/latest', id);
    await assert.rejects(testWebhookSubscription(id), isBadRequest);
    const attempts = harness.db
      .prepare(`SELECT COUNT(*) AS n FROM webhook_delivery_attempts WHERE subscription_id = ?`)
      .get(id) as { n: number };
    assert.equal(attempts.n, 0);
  });
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
