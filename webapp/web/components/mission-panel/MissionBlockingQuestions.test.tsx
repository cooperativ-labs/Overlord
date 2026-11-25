import type { HumanAgentRequestDto, MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useMissionOpenAgentRequests } from '../../lib/queries.ts';
import { keys } from '../../lib/query-keys.ts';
import { invalidateRealtimeChanges } from '../../lib/realtime-invalidation.ts';

import {
  MissionBlockingQuestions,
  missionNotificationRequests
} from './MissionBlockingQuestions.tsx';

if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: window });
}

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];

beforeEach(() => {
  // Refetches fail: the cards seeded below must survive a failed refresh.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'offline' }), { status: 503 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});

function objective(id: string, state: ObjectiveDto['state']): ObjectiveDto {
  return { id, state, displayId: `coo:1.${id}`, title: `Title ${id}` } as ObjectiveDto;
}

function request(id: string, objectiveId: string, createdAt: string): HumanAgentRequestDto {
  return {
    id,
    missionId: 'mission-1',
    objectiveId,
    kind: 'question',
    status: 'open',
    summary: `Question ${id}?`,
    createdAt,
    windowExpiresAt: null,
    options: [],
    allowsFreeText: true,
    revision: 1,
    delivery: { mode: 'read_only', reason: 'no_latch_session', state: null, observedAt: null }
  } as unknown as HumanAgentRequestDto;
}

const mission = {
  id: 'mission-1',
  workspaceId: 'ws-1',
  projectId: 'project-1',
  terminalSessions: [],
  objectives: [
    objective('a', 'executing'),
    objective('b', 'pending_delivery'),
    objective('c', 'draft')
  ]
} as unknown as MissionDetailDto;

function Slot({ onOpen }: { onOpen: (ref: string) => void }) {
  const openRequests = useMissionOpenAgentRequests(mission.id);
  return (
    <MissionBlockingQuestions
      mission={mission}
      openRequests={openRequests}
      onOpenObjective={ref => onOpen(ref)}
    />
  );
}

async function mount(requests: HumanAgentRequestDto[], onOpen: (ref: string) => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false, gcTime: 0 }
    }
  });
  clients.push(client);
  client.setQueryData(keys.missionOpenAgentRequests(mission.id, null), {
    requests,
    complete: true,
    pages: 1
  });
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Slot onOpen={onOpen} />
      </QueryClientProvider>
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });
  await act(async () => {
    await router.load();
    render(<RouterProvider router={router} />);
  });
  return client;
}

/** Presence as a boolean: a failed assertion on a DOM node makes node:assert inspect it at length. */
function slotPresent() {
  return screen.queryByRole('region', { name: 'Blocking questions' }) !== null;
}

const q1 = request('q1', 'a', '2026-11-15T10:00:00.000Z');
const q2 = request('q2', 'b', '2026-11-15T11:00:00.000Z');
const q3 = request('q3', 'a', '2026-11-15T12:00:00.000Z');

describe('MissionBlockingQuestions (plan §5)', () => {
  it('skips requests of objectives no longer in flight', () => {
    const stale = request('q9', 'c', '2026-11-15T09:00:00.000Z');
    assert.deepEqual(
      missionNotificationRequests([stale, q1], mission.objectives).map(r => r.id),
      ['q1']
    );
  });

  it('renders nothing without an open request', async () => {
    await mount([]);
    assert.equal(slotPresent(), false);
  });

  it('shows the two oldest, then a disclosure for the rest', async () => {
    await mount([q1, q2, q3]);
    const ids = [...document.querySelectorAll('[data-request-id]')].map(node =>
      node.getAttribute('data-request-id')
    );
    assert.deepEqual(ids, ['q1', 'q2']);
    const more = screen.getByRole('button', { name: 'Show 1 more' });
    fireEvent.click(more);
    assert.equal(document.querySelectorAll('[data-request-id]').length, 3);
  });

  it("opens the request's objective from its id", async () => {
    const opened: string[] = [];
    await mount([q1], ref => opened.push(ref));
    fireEvent.click(screen.getByRole('button', { name: 'Open objective coo:1.a' }));
    assert.deepEqual(opened, ['coo:1.a']);
  });

  it('writes dismissal with the displayed revision and restores it through the server', async () => {
    let serverRequest = q1;
    const writes: Array<{ method: string; body?: BodyInit | null }> = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/agent-requests/q1/dismissal') {
        const method = init?.method ?? 'GET';
        writes.push({ method, body: init?.body });
        serverRequest = { ...q1, dismissed: method === 'POST' };
        return Response.json({ changed: true, request: serverRequest });
      }
      return Response.json({ requests: [serverRequest] });
    };
    await mount([q1]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notification' }));
    await waitFor(() => assert.ok(screen.getByText('Dismissed notifications (1)')));
    assert.equal(document.querySelector('[data-request-id="q1"]'), null);
    assert.deepEqual(writes, [{ method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) }]);
    cleanup();

    await mount([serverRequest]);
    assert.equal(document.querySelector('[data-request-id="q1"]'), null);
    fireEvent.click(screen.getByText('Dismissed notifications (1)'));
    fireEvent.click(screen.getByText('Restore', { selector: 'button' }));
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Dismiss this notification' }))
    );
    assert.deepEqual(
      writes.map(write => write.method),
      ['POST', 'DELETE']
    );
  });

  it('refreshes the card after another client dismisses the same request revision', async () => {
    globalThis.fetch = async () => Response.json({ requests: [{ ...q1, dismissed: true }, q2] });
    const client = await mount([q1, q2]);
    await act(async () => {
      invalidateRealtimeChanges(client, [
        {
          seq: 1,
          workspaceId: mission.workspaceId,
          projectId: mission.projectId,
          missionId: mission.id,
          objectiveId: 'a',
          entityId: q1.id,
          entityType: 'agent_request',
          operation: 'update',
          changedFields: ['dismissal'],
          occurredAt: q1.createdAt
        }
      ]);
    });
    await waitFor(() => assert.ok(screen.getByText('Dismissed notifications (1)')));
    const ids = [...document.querySelectorAll('[data-request-id]')].map(node =>
      node.getAttribute('data-request-id')
    );
    assert.deepEqual(ids, ['q2']);
  });

  it('keeps the card and reports an error when dismissal fails', async () => {
    await mount([q1]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notification' }));
    await waitFor(() => assert.ok(screen.getByText(/Could not dismiss notification/)));
    assert.ok(screen.getByRole('button', { name: 'Dismiss this notification' }));
  });

  it('disappears when the last request resolves', async () => {
    const client = await mount([q1]);
    assert.equal(slotPresent(), true);
    await act(async () => {
      client.setQueryData(keys.missionOpenAgentRequests(mission.id, null), {
        requests: [],
        complete: true,
        pages: 1
      });
    });
    // Query notifications are batched on a timer: let them flush.
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(slotPresent(), false);
  });
});
