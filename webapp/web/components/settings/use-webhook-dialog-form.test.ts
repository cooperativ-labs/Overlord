import assert from 'node:assert/strict';
import test from 'node:test';

import type { WebhookSubscriptionDto } from '../../../shared/contract.ts';

import type { WebhookFormFields } from './use-webhook-dialog-form.ts';
import {
  buildCreateWebhookBody,
  buildUpdateWebhookBody,
  initialWebhookFormFields,
  secretFromSaveResult,
  toggleWebhookEventType,
  validateWebhookFormFields,
  webhookDialogSubscription
} from './use-webhook-dialog-form.ts';

function subscription(overrides: Partial<WebhookSubscriptionDto> = {}): WebhookSubscriptionDto {
  return {
    id: 'wh_1',
    projectId: null,
    name: 'Feed post generator',
    endpointUrl: 'https://example.com/webhooks/overlord',
    isInternal: false,
    eventTypes: ['mission.delivered'],
    payloadMode: 'thin',
    enabled: true,
    disabledReason: null,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdByWorkspaceUserId: 'wu_1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    revision: 1,
    ...overrides
  };
}

test('resolves the subscription behind each dialog target', () => {
  const existing = subscription();
  assert.equal(webhookDialogSubscription(null), null);
  assert.equal(webhookDialogSubscription('create'), null);
  assert.equal(webhookDialogSubscription(existing), existing);
});

test('seeds a create form blank and an edit form from the subscription', () => {
  assert.deepEqual(initialWebhookFormFields('create'), {
    name: '',
    endpointUrl: '',
    projectId: 'all',
    eventTypes: [],
    payloadMode: 'auto'
  });

  assert.deepEqual(initialWebhookFormFields(subscription({ projectId: 'proj_9' })), {
    name: 'Feed post generator',
    endpointUrl: 'https://example.com/webhooks/overlord',
    projectId: 'proj_9',
    eventTypes: ['mission.delivered'],
    payloadMode: 'thin'
  });
});

test('a create reveals its signing secret once and a reopened dialog reveals none', () => {
  // Create hands back a secret …
  assert.equal(
    secretFromSaveResult({ isEdit: false, result: { secret: 'whsec_abc' } }),
    'whsec_abc'
  );
  // … an edit save never does …
  assert.equal(secretFromSaveResult({ isEdit: true, result: { secret: 'whsec_abc' } }), null);
  // … and reopening on that subscription starts from a state with no secret in it,
  // so the secret is unrecoverable once the dialog closes.
  const reopened = initialWebhookFormFields(subscription());
  assert.equal('secret' in reopened, false);
  assert.equal(secretFromSaveResult({ isEdit: true, result: null }), null);
});

test('requires a name and at least one event type', () => {
  const base: WebhookFormFields = {
    name: 'Feed',
    endpointUrl: 'https://example.com/hook',
    projectId: 'all',
    eventTypes: ['mission.delivered'],
    payloadMode: 'auto'
  };
  assert.equal(validateWebhookFormFields(base), null);
  assert.equal(validateWebhookFormFields({ ...base, name: '   ' }), 'Name is required.');
  assert.equal(
    validateWebhookFormFields({ ...base, eventTypes: [] }),
    'Select at least one event type.'
  );
});

test('toggling an event type adds it then removes it without touching the rest', () => {
  assert.deepEqual(toggleWebhookEventType(['mission.delivered'], 'mission.blocked'), [
    'mission.delivered',
    'mission.blocked'
  ]);
  assert.deepEqual(
    toggleWebhookEventType(['mission.delivered', 'mission.blocked'], 'mission.delivered'),
    ['mission.blocked']
  );
});

test('builds request bodies with a trimmed name, null for all-projects, and auto omitted', () => {
  const fields: WebhookFormFields = {
    name: '  Feed post generator  ',
    endpointUrl: 'https://example.com/hook',
    projectId: 'all',
    eventTypes: ['mission.delivered'],
    payloadMode: 'auto'
  };

  assert.deepEqual(buildCreateWebhookBody(fields, 'ws_1'), {
    name: 'Feed post generator',
    endpointUrl: 'https://example.com/hook',
    workspaceId: 'ws_1',
    projectId: null,
    eventTypes: ['mission.delivered']
  });

  assert.deepEqual(
    buildUpdateWebhookBody({ ...fields, projectId: 'proj_9', payloadMode: 'full' }),
    {
      name: 'Feed post generator',
      endpointUrl: 'https://example.com/hook',
      projectId: 'proj_9',
      eventTypes: ['mission.delivered'],
      payloadMode: 'full'
    }
  );
});
