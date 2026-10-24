import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { MissionDetailDto, ScheduleDto } from '../../../shared/contract.ts';

import { MissionDueDatePopover } from './MissionDueDatePopover.tsx';

const originalFetch = globalThis.fetch;
let requests: Array<{ path: string; method: string; body: unknown }> = [];
let queryClient: QueryClient | null = null;

const weeklySchedule = {
  id: 'schedule-1',
  periodType: 'w',
  periodInterval: 1,
  weeksOfMonth: [],
  daysOfMonth: [],
  daysOfWeek: [{ dayNum: 1, times: ['09:00'] }],
  timezone: 'UTC',
  startDate: null,
  nextStatusKey: null
} as unknown as ScheduleDto;

function stubFetch({ schedule }: { schedule: ScheduleDto | null }) {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    requests.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    });
    const payload = path.endsWith('/schedule/preview')
      ? { dueDatetime: '2026-11-02T09:00:00.000Z', schedule: null }
      : path.endsWith('/schedule')
        ? { dueDatetime: '2026-11-02T09:00:00.000Z', schedule }
        : {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
}

function renderPopover(overrides: Partial<MissionDetailDto>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  queryClient = client;
  const mission = {
    id: 'mission-1',
    dueDatetime: null,
    scheduleId: null,
    statuses: [],
    ...overrides
  } as unknown as MissionDetailDto;
  return render(
    <QueryClientProvider client={client}>
      <MissionDueDatePopover mission={mission} />
    </QueryClientProvider>
  );
}

function writes() {
  return requests.filter(request => request.method !== 'GET' && !request.path.endsWith('/preview'));
}

beforeEach(() => stubFetch({ schedule: null }));
afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = null;
  globalThis.fetch = originalFetch;
});

describe('MissionDueDatePopover', () => {
  it('saves a picked date without touching the schedule', async () => {
    renderPopover({});
    fireEvent.click(screen.getByRole('button', { name: 'No due date' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => assert.equal(writes().length, 1));
    const [write] = writes();
    assert.equal(write?.method, 'PATCH');
    assert.equal(write?.path, '/api/missions/mission-1');
    assert.equal(typeof (write?.body as { dueDatetime: unknown }).dueDatetime, 'string');
  });

  it('creates a schedule when Repeat is switched on', async () => {
    renderPopover({});
    fireEvent.click(screen.getByRole('button', { name: 'No due date' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Repeat' }));
    assert.ok(await screen.findByLabelText('Repeat interval'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => assert.equal(writes().length, 1));
    const [write] = writes();
    assert.equal(write?.path, '/api/missions/mission-1/schedule');
    assert.equal((write?.body as { periodType: string }).periodType, 'w');
  });

  it('removes the schedule but keeps the shown due date when Repeat is switched off', async () => {
    stubFetch({ schedule: weeklySchedule });
    renderPopover({ scheduleId: 'schedule-1', dueDatetime: '2026-11-02T09:00:00.000Z' });
    fireEvent.click(await screen.findByRole('button', { name: /Repeats: Weekly on Mon/ }));
    const toggle = await screen.findByRole('switch', { name: 'Repeat' });
    await waitFor(() => assert.equal(toggle.getAttribute('aria-checked'), 'true'));
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => assert.equal(writes().length, 2));
    const [clearWrite, restoreWrite] = writes();
    assert.equal(clearWrite?.method, 'DELETE');
    assert.equal(clearWrite?.path, '/api/missions/mission-1/schedule');
    assert.equal(restoreWrite?.method, 'PATCH');
    assert.deepEqual(restoreWrite?.body, { dueDatetime: '2026-11-02T09:00:00.000Z' });
  });
});
