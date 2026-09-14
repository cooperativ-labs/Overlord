import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { WebhookSecretReveal } from './WebhooksPage.tsx';

afterEach(cleanup);

test('displays a newly created webhook signing secret', () => {
  render(
    <WebhookSecretReveal
      secret="whsec_create_only"
      canSendTest={false}
      testResult={null}
      onSendTest={() => {}}
      onDismiss={() => {}}
    />
  );

  assert.ok(screen.getByText('whsec_create_only'));
});

test('Done dismisses the revealed secret on the create path', () => {
  let dismisses = 0;
  render(
    <WebhookSecretReveal
      secret="whsec_create_only"
      canSendTest={false}
      testResult={null}
      onSendTest={() => {}}
      onDismiss={() => {
        dismisses += 1;
      }}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Done' }));

  assert.equal(dismisses, 1);
});

test('the edit path offers a test delivery instead of Done', () => {
  render(
    <WebhookSecretReveal
      secret="whsec_rotated"
      canSendTest
      testResult={null}
      onSendTest={() => {}}
      onDismiss={() => {}}
    />
  );

  assert.ok(screen.getByRole('button', { name: 'Send test delivery' }));
  assert.equal(screen.queryByRole('button', { name: 'Done' }), null);
});
