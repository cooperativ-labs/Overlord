import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import type { ReactNode } from 'react';

import type { MissionSummaryResponse } from '../../../shared/contract.ts';
import { api } from '../api.ts';

import {
  useAcknowledgeMissionSummary,
  useMissionSummaryVisitBaseline
} from './use-mission-summary-seen.ts';

afterEach(() => {
  cleanup();
  mock.restoreAll();
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
        targetRef: { current: null }
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
