import type { MissionDetailDto, MissionSummaryResponse } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, it } from 'node:test';

import { keys } from '../../lib/query-keys.ts';

import { MissionSummarySection } from './MissionSummarySection.tsx';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contract/mission-summary-derive-fixtures.json', import.meta.url),
    'utf8'
  )
).reviewMission.input;
const clients: QueryClient[] = [];
// The shared DOM harness exposes window/document; the router also uses self.
Object.defineProperty(globalThis, 'self', { configurable: true, value: window });

type Recorded = { method: string; path: string; body: unknown };
let requests: Recorded[] = [];
/** What a summary refetch answers: the state after the server applied a write. */
let nextSummary: MissionSummaryResponse | null = null;
let itemResponse: (req: Recorded) => { status: number; body: unknown } = () => ({
  status: 200,
  body: {}
});
const originalFetch = globalThis.fetch;

/**
 * Lets the stubbed requests, the mutation and the refetch it awaits run.
 * `waitFor` stalls in this harness once a request is in flight, so tests that
 * write yield to the event loop explicitly.
 */
async function settle(turns = 6) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  requests = [];
  nextSummary = null;
  itemResponse = () => ({ status: 200, body: {} });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const req = { method, path: url.pathname, body };
    requests.push(req);
    if (url.pathname.startsWith('/api/mission-items/')) {
      const answer = itemResponse(req);
      return json(answer.status, answer.body);
    }
    if (method === 'GET' && url.pathname.endsWith('/summary') && nextSummary) {
      return json(200, nextSummary);
    }
    if (method === 'GET' && url.pathname.endsWith('/deliveries')) {
      return json(200, { items: fixture.deliveries, total: fixture.deliveries.length });
    }
    return json(404, { error: 'not stubbed' });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  globalThis.fetch = originalFetch;
});

async function mount(response: MissionSummaryResponse = structuredClone(fixture.summaryResponse)) {
  // gcTime 0: a finished mutation's five-minute gc timer would keep the test process alive.
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false, gcTime: 0 }
    }
  });
  clients.push(client);
  const id = fixture.mission.id;
  client.setQueryData(keys.missionSummary(id), response);
  client.setQueryData(keys.missionAgentRequests(id), fixture.agentRequests);
  client.setQueryData(keys.missionDeliveries(id), {
    items: fixture.deliveries,
    total: fixture.deliveries.length
  });
  client.setQueryData(keys.workspaceMembers(fixture.mission.workspaceId), fixture.members);
  client.setQueryData(keys.missionFileChanges(id), {
    items: fixture.fileChanges.items,
    total: fixture.fileChanges.items.length
  });
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <MissionSummarySection mission={fixture.mission as MissionDetailDto} />
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

it('hides old missions and shows the before-first-delivery state for eligible missions', async () => {
  await mount({ eligible: false, summary: null, evidence: null, watermark: null, seenAt: null });
  assert.equal(screen.queryByText('Mission summary'), null);
  cleanup();
  const response = structuredClone(fixture.summaryResponse);
  response.summary = null;
  response.evidence = {
    actions: [],
    sources: [],
    totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
    truncated: { actions: false, sources: false }
  };
  await mount(response);
  assert.ok(screen.getByText(/The summary appears after its first delivery/));
});

it('renders updating evidence, expandable actions, compact promoted suggestions, and persistent visit dots', async () => {
  const response = structuredClone(fixture.summaryResponse);
  response.summary.status = 'pending';
  const client = await mount(response);
  assert.equal(
    screen.getByRole('region', { name: 'Mission summary' }).getAttribute('aria-busy'),
    'true'
  );
  assert.match(screen.getByRole('status').textContent ?? '', /Updating from the delivery/);
  const action = screen.getByRole('button', {
    name: /^Show details: Run the migration on staging/
  });
  assert.equal(action.getAttribute('aria-expanded'), 'false');
  fireEvent.click(action);
  assert.equal(action.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('yarn db:migrate --env staging'));
  assert.ok(screen.getByText(/Add derivation tests on iOS/));
  assert.equal(screen.queryByRole('button', { name: /Add derivation tests on iOS/ }), null);
  const dots = screen.getAllByRole('img', { name: 'New since your last visit' }).length;
  await act(async () =>
    client.setQueryData(keys.missionSummary(fixture.mission.id), {
      ...response,
      seenAt: response.watermark,
      summary: { ...response.summary, headline: 'The refreshed summary is ready.' }
    })
  );
  await waitFor(() => assert.ok(screen.getByText('The refreshed summary is ready.')));
  assert.equal(screen.getAllByRole('img', { name: 'New since your last visit' }).length, dots);
  const more = screen.getByRole('button', { name: /\+\d+ more/ });
  fireEvent.click(more);
  assert.equal(
    screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded'),
    'true'
  );
});

it('shows first-compose evidence without an empty post and shows all-clear after questions close', async () => {
  const response = structuredClone(fixture.summaryResponse);
  response.summary = {
    ...response.summary,
    status: 'pending',
    generatedAt: null,
    headline: '',
    summary: ''
  };
  const client = await mount(response);
  assert.ok(screen.getByRole('button', { name: /^Show details: Run the migration on staging/ }));
  assert.equal(screen.queryByText(fixture.summaryResponse.summary.headline), null);
  await act(async () => {
    client.setQueryData(keys.missionAgentRequests(fixture.mission.id), []);
    client.setQueryData(keys.missionSummary(fixture.mission.id), {
      ...fixture.summaryResponse,
      evidence: {
        ...fixture.summaryResponse.evidence,
        actions: [],
        totals: { ...fixture.summaryResponse.evidence.totals, actions: 0 }
      }
    });
  });
  await waitFor(() => assert.ok(screen.getByText('No open actions')));
});

it('names the authoring objective, or says the summary was written automatically', async () => {
  await mount();
  assert.ok(screen.getByText('Updated by'));
  assert.ok(
    screen.getByRole('button', { name: 'Open objective coo:900.cccc, which wrote this summary' })
  );
  cleanup();
  const fallback = structuredClone(fixture.summaryResponse);
  fallback.summary.author = { kind: 'gemini', objectiveId: null, deliveryId: null };
  fallback.summary.generatedBy = 'gemini';
  await mount(fallback);
  assert.ok(screen.getByText('Written automatically from deliveries'));
  assert.equal(screen.queryByText('Updated by'), null);
});

it('lists resolved items collapsed, with kind, who resolved them and the reason', async () => {
  await mount();
  const toggle = screen.getByRole('button', { name: /Resolved\s*4/ });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  assert.ok(list?.hidden);
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(list?.hidden, false);
  const region = screen.getByRole('region', { name: 'Resolved items' });
  const text = region.textContent ?? '';
  // Kind and status are text, not colour alone.
  for (const label of ['Risk', 'Action', 'Suggestion', 'Done', 'Dismissed']) {
    assert.ok(text.includes(label), label);
  }
  assert.ok(text.includes('Objective coo:900.ffff added'));
  assert.ok(text.includes('by Dana Reyes'));
  assert.ok(text.includes('by you'));
  assert.ok(text.includes('by an agent'));
  assert.ok(text.includes('“Fixed by the cache key added in this objective.”'));
  assert.ok(
    screen.getByRole('button', { name: 'Open objective coo:900.cccc, which resolved this item' })
  );
  assert.ok(
    screen.getByRole('button', {
      name: 'Restore risk: The summary cache can serve a stale headline.'
    })
  );
});

it('hides the resolved group when nothing is resolved', async () => {
  const response = structuredClone(fixture.summaryResponse);
  response.summary.closedItems = [];
  await mount(response);
  assert.equal(screen.queryByRole('region', { name: 'Resolved items' }), null);
});

it('resolves a risk with a reason and moves it to the resolved group live', async () => {
  const risk = fixture.summaryResponse.summary.risks[0];
  const after = structuredClone(fixture.summaryResponse);
  after.summary.risks = after.summary.risks.slice(1);
  after.summary.closedItems = [
    {
      id: risk.id,
      kind: 'risk',
      text: risk.text,
      objectiveId: risk.objectiveId,
      status: 'dismissed',
      reason: 'The widget target was removed.',
      outcome: null,
      outcomeRef: null,
      resolvedBy: { kind: 'person', workspaceUserId: 'wu-2', objectiveId: null, deliveryId: null },
      resolvedAt: '2026-10-23T12:00:00.000Z'
    },
    ...after.summary.closedItems
  ];
  nextSummary = after;
  await mount();

  const trigger = screen.getByRole('button', { name: `Resolve risk: ${risk.text}` });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const form = screen.getByRole('form', { name: `Resolve risk: ${risk.text}` });
  assert.equal(trigger.getAttribute('aria-controls'), form.id);
  // Focus moves into the form, on the first choice.
  assert.equal(document.activeElement, screen.getByRole('radio', { name: /Done/ }));
  fireEvent.click(screen.getByRole('radio', { name: /Dismissed/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), {
    target: { value: '  The widget target was removed.  ' }
  });
  // happy-dom does not submit a form from a button click; submit the form directly.
  assert.equal(screen.getByRole('button', { name: 'Resolve risk' }).getAttribute('type'), 'submit');
  fireEvent.submit(form);

  await settle();
  assert.equal(screen.queryByRole('button', { name: `Resolve risk: ${risk.text}` }), null);
  const put = requests.find(req => req.method === 'PUT');
  assert.deepEqual(put, {
    method: 'PUT',
    path: `/api/mission-items/${risk.id}/resolution`,
    body: { status: 'dismissed', reason: 'The widget target was removed.' }
  });
  fireEvent.click(screen.getByRole('button', { name: /Resolved\s*5/ }));
  assert.ok(screen.getByRole('button', { name: `Restore risk: ${risk.text}` }));
  assert.ok(screen.getByText('“The widget target was removed.”'));
});

it('resolves a human action as done without a reason; Escape cancels and returns focus', async () => {
  const action = fixture.summaryResponse.evidence.actions[0];
  await mount();
  const trigger = screen.getByRole('button', { name: `Resolve action: ${action.action}` });
  fireEvent.click(trigger);
  const form = screen.getByRole('form', { name: `Resolve action: ${action.action}` });
  fireEvent.keyDown(form, { key: 'Escape' });
  assert.equal(screen.queryByRole('form', { name: `Resolve action: ${action.action}` }), null);
  assert.equal(document.activeElement, trigger);

  fireEvent.click(trigger);
  fireEvent.submit(screen.getByRole('form', { name: `Resolve action: ${action.action}` }));
  await settle();
  assert.deepEqual(requests.find(req => req.method === 'PUT')?.body, {
    status: 'done',
    reason: null
  });
  // Questions are answered, not resolved.
  assert.equal(screen.queryByRole('button', { name: /Resolve action: Answer/ }), null);
});

it('restores a resolved item and explains a superseded one', async () => {
  itemResponse = req =>
    req.path.includes('item-risk-x3')
      ? {
          status: 409,
          body: { error: 'superseded', code: 'mission_item_superseded' }
        }
      : { status: 200, body: {} };
  await mount();
  fireEvent.click(screen.getByRole('button', { name: /Resolved\s*4/ }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Restore risk: The old summary route may still be cached by proxies.'
    })
  );
  await settle();
  assert.match(screen.getByRole('alert').textContent ?? '', /A later delivery replaced this item/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Restore action: Restart the worker after deploy' })
  );
  await settle();
  assert.ok(
    requests.some(
      req =>
        req.method === 'DELETE' && req.path === '/api/mission-items/item-action-x3-old/resolution'
    )
  );
});
