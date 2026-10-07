import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { api } from '@/lib/api.ts';
import {
  CHAT_DIAGNOSTICS_KEY,
  setChatDiagnosticsEnabled,
  useChatDiagnosticsEnabled
} from '@/lib/chat/diagnostics-setting.ts';

import { ChatDiagnostics } from './ChatDiagnostics.tsx';

const original = api.getChatDiagnostics;
afterEach(() => {
  cleanup();
  api.getChatDiagnostics = original;
  window.localStorage.removeItem(CHAT_DIAGNOSTICS_KEY);
});

test('diagnostics preference defaults off and updates mounted consumers immediately', () => {
  window.localStorage.removeItem(CHAT_DIAGNOSTICS_KEY);
  function Consumer() {
    const enabled = useChatDiagnosticsEnabled();
    return (
      <button onClick={() => setChatDiagnosticsEnabled(!enabled)}>
        {enabled ? 'Enabled' : 'Disabled'}
      </button>
    );
  }
  render(<Consumer />);
  fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));
  assert.ok(screen.getByRole('button', { name: 'Enabled' }));
  assert.equal(window.localStorage.getItem(CHAT_DIAGNOSTICS_KEY), 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
  assert.equal(window.localStorage.getItem(CHAT_DIAGNOSTICS_KEY), 'false');
});

test('log drains all pages, renders complete payloads as text on expansion, and stops on unmount', async () => {
  const calls: number[] = [];
  const secret = '<script>private-token</script>';
  api.getChatDiagnostics = async (_id, after = 0) => {
    calls.push(after);
    return {
      entries: after
        ? []
        : [
            {
              seq: 1,
              threadId: 'thread',
              runId: 'run',
              attemptId: 'attempt',
              kind: 'provider.chunk',
              createdAt: '2026-10-07T00:00:00Z',
              payload: { content: secret }
            }
          ],
      nextCursor: 1,
      hasMore: after === 0
    };
  };
  const view = render(<ChatDiagnostics threadId="thread" />);
  await waitFor(() => assert.deepEqual(calls, [0, 1]));
  const details = view.container.querySelector('details')!;
  assert.equal(view.container.querySelector('pre'), null);
  details.open = true;
  fireEvent(details, new Event('toggle', { bubbles: true }));
  await waitFor(() =>
    assert.ok(view.container.querySelector('pre')?.textContent?.includes(secret))
  );
  assert.equal(view.container.querySelector('script'), null);
  view.unmount();
});
