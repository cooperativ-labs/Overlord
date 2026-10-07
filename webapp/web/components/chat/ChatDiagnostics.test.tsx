import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { api } from '@/lib/api.ts';
import { ApiRequestError } from '@/lib/api/request.ts';
import {
  CHAT_DIAGNOSTICS_KEY,
  setChatDiagnosticsEnabled,
  useChatDiagnosticsEnabled
} from '@/lib/chat/diagnostics-setting.ts';

import { ChatDiagnostics, DIAGNOSTIC_ROW_HEIGHT } from './ChatDiagnostics.tsx';

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

function entry(seq: number, threadId = 'thread') {
  return {
    seq,
    threadId,
    runId: null,
    attemptId: null,
    kind: 'provider.chunk',
    createdAt: '2026-10-07T00:00:00Z',
    payload: { seq, threadId }
  };
}

/** Serves `total` ordered rows in 100-row pages, followed by anything pushed to `live`. */
function pagedLog(total: number) {
  const calls: number[] = [];
  const live: ReturnType<typeof entry>[] = [];
  api.getChatDiagnostics = async (id, after = 0) => {
    calls.push(after);
    const all = [...Array.from({ length: total }, (_, i) => entry(i + 1, id)), ...live];
    const entries = all.filter(row => row.seq > after).slice(0, 100);
    const nextCursor = entries.length ? entries[entries.length - 1].seq : after;
    return { entries, nextCursor, hasMore: all.some(row => row.seq > nextCursor) };
  };
  return { calls, live };
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function scrollRows(view: ReturnType<typeof render>, top: number) {
  const rows = view.getByTestId('chat-diagnostics-rows');
  rows.scrollTop = top;
  fireEvent.scroll(rows);
}

const renderedRows = (view: ReturnType<typeof render>) => [
  ...view.container.querySelectorAll('details')
];

test('large histories render a bounded window while every ordered row stays reachable', async () => {
  const { calls } = pagedLog(2_000);
  const view = render(<ChatDiagnostics threadId="thread" />);
  await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 2000 entries')));
  assert.deepEqual(
    calls.slice(0, 20),
    Array.from({ length: 20 }, (_, i) => i * 100)
  );
  assert.ok(renderedRows(view).length < 60, `rendered ${renderedRows(view).length} rows`);
  assert.match(renderedRows(view)[0].textContent ?? '', /^#1 /);
  for (const seq of [1_000, 2_000]) {
    scrollRows(view, (seq - 1) * DIAGNOSTIC_ROW_HEIGHT);
    await waitFor(() =>
      assert.ok(renderedRows(view).some(row => row.textContent?.startsWith(`#${seq} `)))
    );
    assert.ok(renderedRows(view).length < 60);
  }
  const seqs = renderedRows(view).map(row => Number(/^#(\d+)/.exec(row.textContent ?? '')![1]));
  assert.deepEqual(
    seqs,
    seqs.map((_, i) => seqs[0] + i)
  );
});

test('expansion survives rows leaving the window', async () => {
  pagedLog(500);
  const view = render(<ChatDiagnostics threadId="thread" />);
  await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 500 entries')));
  const first = view.container.querySelector('details')!;
  first.open = true;
  fireEvent(first, new Event('toggle', { bubbles: true }));
  const expanded = () => view.container.querySelector('pre')?.textContent ?? '';
  await waitFor(() => assert.match(expanded(), /"seq": 1,/));
  scrollRows(view, 400 * DIAGNOSTIC_ROW_HEIGHT);
  await waitFor(() => assert.equal(view.container.querySelector('pre'), null));
  scrollRows(view, 0);
  await waitFor(() => assert.match(expanded(), /"seq": 1,/));
  assert.equal(view.container.querySelector('details')!.open, true);
});

test('hidden views stop polling and resume from the same cursor; live rows append in order', async () => {
  const { calls, live } = pagedLog(150);
  try {
    render(<ChatDiagnostics threadId="thread" />);
    await waitFor(() => assert.deepEqual(calls, [0, 100]));
    setVisibility('hidden');
    await waitFor(() => assert.ok(screen.getByText(/Paused while hidden/)));
    live.push(entry(151), entry(152));
    await new Promise(resolve => setTimeout(resolve, 1_300));
    assert.deepEqual(calls, [0, 100]);
    setVisibility('visible');
    await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 152 entries')));
    assert.deepEqual(calls, [0, 100, 150]);
    assert.ok(screen.getByText(/^Live/));
  } finally {
    setVisibility('visible');
  }
});

test('thread changes restart from cursor zero and authorization loss clears and stops', async () => {
  const calls: Array<[string, number]> = [];
  api.getChatDiagnostics = async (id, after = 0) => {
    calls.push([id, after]);
    if (id === 'gone') throw new ApiRequestError('not found', 404);
    return after
      ? { entries: [], nextCursor: after, hasMore: false }
      : { entries: [entry(1, id), entry(2, id)], nextCursor: 2, hasMore: false };
  };
  const view = render(<ChatDiagnostics threadId="a" />);
  await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 2 entries')));
  const first = view.container.querySelector('details')!;
  first.open = true;
  fireEvent(first, new Event('toggle', { bubbles: true }));
  await waitFor(() => assert.match(view.container.querySelector('pre')?.textContent ?? '', /"a"/));
  view.rerender(<ChatDiagnostics threadId="b" />);
  await waitFor(() => assert.ok(calls.some(([id, after]) => id === 'b' && after === 0)));
  await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 2 entries')));
  assert.equal(view.container.querySelector('pre'), null);
  view.rerender(<ChatDiagnostics threadId="gone" />);
  await waitFor(() => assert.ok(screen.getByText('Chat diagnostics · 0 entries')));
  assert.ok(screen.getByRole('alert'));
  const settled = calls.length;
  await new Promise(resolve => setTimeout(resolve, 1_200));
  assert.equal(calls.length, settled);
});
