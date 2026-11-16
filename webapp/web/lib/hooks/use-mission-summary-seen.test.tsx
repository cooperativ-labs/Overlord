import type { MissionSummaryResponse } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import type { ReactNode } from 'react';

import { api } from '../api.ts';

import {
  MISSION_SUMMARY_SEEN_DELAY_MS,
  useAcknowledgeMissionSummary,
  useEvidenceGroupCoverage,
  useForegroundVisible,
  useMissionSummaryVisitBaseline
} from './use-mission-summary-seen.ts';

afterEach(() => {
  cleanup();
  mock.restoreAll();
});

it('requires an observed quarter of the evidence to be visible before counting it', () => {
  const original = globalThis.IntersectionObserver;
  let notify!: IntersectionObserverCallback;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      notify = callback;
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  try {
    const ref = { current: document.createElement('div') };
    const hook = renderHook(() => useForegroundVisible(ref, true));
    assert.equal(hook.result.current, false, 'wait for the first actual observation');
    const observe = (ratio: number) =>
      act(() =>
        notify(
          [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      );
    observe(0.01);
    assert.equal(hook.result.current, false, 'a one-pixel sliver is not displayed evidence');
    observe(0.25);
    assert.equal(hook.result.current, true);
    observe(0.1);
    assert.equal(hook.result.current, false, 'crossing below the threshold cancels coverage');
    hook.unmount();
  } finally {
    globalThis.IntersectionObserver = original;
  }
});

const first = '2026-10-01T00:00:00.000Z';
const second = '2026-10-02T00:00:00.000Z';
const third = '2026-10-03T00:00:00.000Z';
const response = (watermark: string, seenAt: string | null): MissionSummaryResponse => ({
  eligible: true,
  summary: null,
  watermark,
  seenAt,
  evidence: {
    actions: [],
    sources: [],
    totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
    truncated: { actions: false, sources: false }
  }
});

it('freezes the visit baseline across seen writes/refetches and recaptures it on the next visit', () => {
  const hook = renderHook(({ value }) => useMissionSummaryVisitBaseline(value), {
    initialProps: { value: response(second, first) }
  });
  assert.equal(hook.result.current, first);
  hook.rerender({ value: response(third, second) });
  assert.equal(hook.result.current, first);
  hook.unmount();
  const next = renderHook(() => useMissionSummaryVisitBaseline(response(third, second)));
  assert.equal(next.result.current, second);
});

it('acknowledges only a snapshot displayed for two seconds; new evidence and unmount cancel the timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes: string[] = [];
  mock.method(api, 'markMissionSummarySeen', async (_id: string, body: { watermark: string }) => {
    writes.push(body.watermark);
    return { seenAt: body.watermark };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ value, displayed }) =>
      useAcknowledgeMissionSummary({
        missionId: 'mission',
        response: value,
        displayed,
        visible: true,
        coverageComplete: true
      }),
    {
      wrapper,
      initialProps: { value: response(second, first), displayed: true }
    }
  );
  await act(async () => t.mock.timers.tick(1999));
  assert.deepEqual(writes, []);
  hook.rerender({ value: response(third, first), displayed: true });
  await act(async () => t.mock.timers.tick(1));
  assert.deepEqual(writes, [], 'arrival of new evidence resets the visibility period');
  await act(async () => t.mock.timers.tick(1999));
  assert.deepEqual(writes, [third]);
  hook.rerender({ value: response('2026-10-04T00:00:00.000Z', third), displayed: true });
  await act(async () => t.mock.timers.tick(1999));
  hook.unmount();
  await act(async () => t.mock.timers.tick(2000));
  assert.deepEqual(writes, [third]);
  queryClient.clear();
  t.mock.timers.reset();
});

function ackHarness(t: { mock: { method: typeof mock.method } }) {
  const writes: string[] = [];
  t.mock.method(api, 'markMissionSummarySeen', async (_id: string, body: { watermark: string }) => {
    writes.push(body.watermark);
    return { seenAt: body.watermark };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { writes, queryClient, wrapper };
}

it('never acknowledges while evidence is uncovered, hidden or occluded (plan §6.1)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { writes, queryClient, wrapper } = ackHarness(t);
  const hook = renderHook(
    ({ visible, coverageComplete }) =>
      useAcknowledgeMissionSummary({
        missionId: 'mission',
        response: response(second, first),
        displayed: true,
        visible,
        coverageComplete
      }),
    { wrapper, initialProps: { visible: true, coverageComplete: false } }
  );
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(writes, [], 'an unopened evidence tab keeps the snapshot unread');
  hook.rerender({ visible: false, coverageComplete: true });
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(writes, [], 'a header under the objective dialog or off screen does not count');
  hook.rerender({ visible: true, coverageComplete: true });
  await act(async () => t.mock.timers.tick(MISSION_SUMMARY_SEEN_DELAY_MS));
  assert.deepEqual(writes, [second]);
  hook.unmount();
  queryClient.clear();
  t.mock.timers.reset();
});

it('covers an evidence group only after two uninterrupted seconds with the same content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const covered: Array<[string, string]> = [];
  const hook = renderHook(
    ({ signature, active }) =>
      useEvidenceGroupCoverage({
        group: 'risks',
        signature,
        active,
        onCovered: (group, sig) => covered.push([group, sig])
      }),
    { initialProps: { signature: 'a', active: true } }
  );
  await act(async () => t.mock.timers.tick(1500));
  hook.rerender({ signature: 'a', active: false });
  await act(async () => t.mock.timers.tick(5000));
  assert.deepEqual(covered, [], 'switching away (or hiding the page) cancels the interval');
  hook.rerender({ signature: 'a', active: true });
  await act(async () => t.mock.timers.tick(1500));
  hook.rerender({ signature: 'b', active: true });
  await act(async () => t.mock.timers.tick(1999));
  assert.deepEqual(covered, [], 'changed evidence restarts the interval');
  await act(async () => t.mock.timers.tick(1));
  assert.deepEqual(covered, [['risks', 'b']]);
  hook.rerender({ signature: 'c', active: true });
  hook.unmount();
  await act(async () => t.mock.timers.tick(5000));
  assert.deepEqual(covered, [['risks', 'b']], 'unmounting cancels an unfinished interval');
  t.mock.timers.reset();
});
