import type { ActivityFeedDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { keys } from '../../lib/query-keys.ts';

import { ActivityFeed } from './ActivityFeed.tsx';

it('pauses delivery history while Delivered is off and resumes it when turned back on', async t => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalObserver = globalThis.IntersectionObserver;
  let intersect: (() => void) | undefined;
  globalThis.IntersectionObserver = class {
    constructor(private readonly notify: IntersectionObserverCallback) {}
    observe() {
      intersect = () =>
        this.notify(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
    }
    disconnect() {
      intersect = undefined;
    }
  } as unknown as typeof IntersectionObserver;

  const nextBefore = '2026-11-24T00:00:00.000Z';
  const cursors: Array<string | null> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const before = new URL(String(input), 'http://localhost').searchParams.get('before');
    cursors.push(before);
    const page: ActivityFeedDto = {
      items: [],
      counts: { mission_run: 0, blocking_question: 0, mission_delivered: 0 },
      generatedAt: '2026-11-27T00:00:00.000Z',
      nextBefore: before ? null : nextBefore
    };
    return Response.json(page);
  });

  try {
    render(
      <QueryClientProvider client={client}>
        <ActivityFeed onOpenMission={() => {}} />
      </QueryClientProvider>
    );

    const historyPrompt = /scroll to load the previous three days/i;
    const delivered = screen.getByRole('button', { name: /delivered/i });
    await screen.findByText(historyPrompt);
    fireEvent.click(delivered);
    assert.ok(!screen.queryByText(historyPrompt));
    assert.equal(intersect, undefined);
    assert.deepEqual(cursors, [null]);

    fireEvent.click(delivered);
    assert.ok(screen.getByText(historyPrompt));
    assert.ok(intersect);
    act(() => intersect?.());
    await waitFor(() => assert.ok(!screen.queryByText(historyPrompt)));
    assert.deepEqual(cursors, [null, nextBefore]);

    fireEvent.click(delivered);
    await act(() => client.invalidateQueries({ queryKey: keys.activityFeed }));
    assert.equal(intersect, undefined);
    assert.deepEqual(cursors, [null, nextBefore, null]);
  } finally {
    cleanup();
    client.clear();
    globalThis.IntersectionObserver = originalObserver;
  }
});
