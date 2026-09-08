import { useState } from 'react';

import { useTestWebhookSubscription } from '@/lib/queries';

import { errorMessage } from './use-webhook-dialog-form.ts';

export const TEST_SEND_SUCCESS_MESSAGE = 'Test delivery sent successfully.';
export const TEST_SEND_FAILURE_MESSAGE = 'Test delivery failed.';

/**
 * The dialog's inline "send test delivery" flow: reports its outcome as a single
 * message line rather than a button state, since it sits next to the revealed
 * secret instead of in the footer.
 */
export function useWebhookTestSend(subscriptionId: string | undefined) {
  const testSubscription = useTestWebhookSubscription();
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    if (!subscriptionId) return;
    setResult(null);
    try {
      await testSubscription.mutateAsync(subscriptionId);
      setResult(TEST_SEND_SUCCESS_MESSAGE);
    } catch (err) {
      setResult(errorMessage(err, TEST_SEND_FAILURE_MESSAGE));
    }
  }

  return { result, clearResult: () => setResult(null), send };
}
