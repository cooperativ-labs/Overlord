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

import {
  dismissAgentRequest,
  resetDismissedAgentRequestsForTests
} from '../../lib/dismissed-agent-requests.ts';
import { useMissionOpenAgentRequests } from '../../lib/queries.ts';
import { keys } from '../../lib/query-keys.ts';

import { MissionOverviewCard, overviewBadge } from './MissionOverviewCard.tsx';

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

type FixtureRequest = { status: string };

/** The complete open-request collection the panel shares with the card (plan §3.1). */
function setOpenRequests(client: QueryClient, all: readonly FixtureRequest[]) {
  client.setQueryData(keys.missionOpenAgentRequests(fixture.mission.id, null), {
    requests: all.filter(request => request.status === 'open'),
    complete: true,
    pages: 1
  });
}

function Card() {
  const mission = fixture.mission as MissionDetailDto;
  const openRequests = useMissionOpenAgentRequests(mission.id);
  return (
    <MissionOverviewCard
      mission={mission}
      openRequests={openRequests}
      occluded={false}
      objectiveList={<p>Objective rows</p>}
    />
  );
}

function selectTab(name: RegExp) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.click(tab);
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  return tab;
}

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
  setOpenRequests(client, fixture.agentRequests);
  // The Files tab mounts after the first render; seed what it reads so no request outlives the
  // test's fetch stub.
  client.setQueryData(keys.profile, { editorScheme: null });
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
        <Card />
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

it('keeps old missions to Objectives and For you, and shows the before-first-delivery state', async () => {
  // Its notification was dismissed: For you still lists it (plan §5).
  resetDismissedAgentRequestsForTests();
  for (const request of fixture.agentRequests as Array<{ id: string }>) {
    dismissAgentRequest(
      { workspaceId: fixture.mission.workspaceId, missionId: fixture.mission.id },
      request.id
    );
  }
  await mount({ eligible: false, summary: null, evidence: null, watermark: null, seenAt: null });
  // The card never hides: it carries the objective list and, on an old summary-ineligible
  // mission, still lists the open question under For you (plan §6.1, decision 13).
  assert.ok(screen.getByText('Objective rows'));
  const tabs = screen.getAllByRole('tab').map(tab => tab.textContent);
  assert.deepEqual(tabs, ['Objectives1/6', 'For you1']);
  assert.equal(
    screen.getByRole('tab', { name: /Objectives/ }).getAttribute('aria-selected'),
    'true'
  );
  selectTab(/For you/);
  assert.ok(screen.getByText(/Answer the agent's question on/));
  cleanup();
  resetDismissedAgentRequestsForTests();
  const response = structuredClone(fixture.summaryResponse);
  response.summary = null;
  response.evidence = {
    actions: [],
    sources: [],
    totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
    truncated: { actions: false, sources: false }
  };
  await mount(response);
  assert.equal(screen.queryByText(/The summary appears after/), null);
  assert.equal(screen.queryByText(/Summary updated/), null);
  assert.ok(screen.getByRole('tab', { name: /Objectives/ }));
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
  selectTab(/For you/);
  const action = screen.getByRole('button', {
    name: /^Show details: Run the migration on staging/
  });
  assert.equal(action.getAttribute('aria-expanded'), 'false');
  fireEvent.click(action);
  assert.equal(action.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('yarn db:migrate --env staging'));
  // A promoted suggestion is a resolved item; it is listed in the Resolved tab.
  selectTab(/Resolved/);
  assert.ok(screen.getByText(/Add derivation tests on iOS/));
  selectTab(/Summary/);
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
  selectTab(/Files/);
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
  selectTab(/For you/);
  assert.ok(screen.getByRole('button', { name: /^Show details: Run the migration on staging/ }));
  assert.equal(screen.queryByText(fixture.summaryResponse.summary.headline) === null, true);
  await act(async () => {
    setOpenRequests(client, []);
    client.setQueryData(keys.missionSummary(fixture.mission.id), {
      ...fixture.summaryResponse,
      evidence: {
        ...fixture.summaryResponse.evidence,
        actions: [],
        totals: { ...fixture.summaryResponse.evidence.totals, actions: 0 }
      }
    });
  });
  // The For you count reached zero: the tab disappears and selection returns to Objectives.
  await waitFor(() => assert.equal(screen.queryByRole('tab', { name: /For you/ }) === null, true));
  assert.equal(
    screen.getByRole('tab', { name: /Objectives/ }).getAttribute('aria-selected'),
    'true'
  );
  assert.ok(screen.getByText('Objective rows'));
});

it('names the authoring objective, and shows no provenance for automatic summaries', async () => {
  await mount();
  selectTab(/Summary/);
  assert.ok(screen.getByText('Updated by'));
  assert.ok(
    screen.getByRole('button', { name: 'Open objective coo:900.cccc, which wrote this summary' })
  );
  cleanup();
  const fallback = structuredClone(fixture.summaryResponse);
  fallback.summary.author = { kind: 'gemini', objectiveId: null, deliveryId: null };
  fallback.summary.generatedBy = 'gemini';
  await mount(fallback);
  selectTab(/Summary/);
  assert.equal(screen.queryByText('Written automatically from deliveries') === null, true);
  assert.equal(screen.queryByText('Updated by') === null, true);
});

it('lists resolved items in their tab, with kind, who resolved them and the reason', async () => {
  await mount();
  selectTab(/Resolved\s*4$/);
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
  assert.equal(screen.queryByRole('tab', { name: /Resolved/ }) === null, true);
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
  selectTab(/Risks/);

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
  assert.equal(screen.queryByRole('button', { name: `Resolve risk: ${risk.text}` }) === null, true);
  const put = requests.find(req => req.method === 'PUT');
  assert.deepEqual(put, {
    method: 'PUT',
    path: `/api/mission-items/${risk.id}/resolution`,
    body: { status: 'dismissed', reason: 'The widget target was removed.' }
  });
  selectTab(/Resolved\s*5$/);
  assert.ok(screen.getByRole('button', { name: `Restore risk: ${risk.text}` }));
  assert.ok(screen.getByText('“The widget target was removed.”'));
});

it('resolves a human action as done without a reason; Escape cancels and returns focus', async () => {
  const action = fixture.summaryResponse.evidence.actions[0];
  await mount();
  selectTab(/For you/);
  const trigger = screen.getByRole('button', { name: `Resolve action: ${action.action}` });
  fireEvent.click(trigger);
  const form = screen.getByRole('form', { name: `Resolve action: ${action.action}` });
  fireEvent.keyDown(form, { key: 'Escape' });
  assert.equal(
    screen.queryByRole('form', { name: `Resolve action: ${action.action}` }) === null,
    true
  );
  assert.equal(document.activeElement, trigger);

  fireEvent.click(trigger);
  fireEvent.submit(screen.getByRole('form', { name: `Resolve action: ${action.action}` }));
  await settle();
  assert.deepEqual(requests.find(req => req.method === 'PUT')?.body, {
    status: 'done',
    reason: null
  });
  // Questions are answered, not resolved.
  assert.equal(screen.queryByRole('button', { name: /Resolve action: Answer/ }) === null, true);
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
  selectTab(/Resolved\s*4$/);
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

it('chooses the badge from blocked, in-flight, launching and complete state', () => {
  const blocked = new Map([['b', [{}]]]);
  const none = new Map<string, unknown[]>();
  const at = (state: string) => [{ id: 'b', state }] as never;
  assert.equal(
    overviewBadge({
      objectives: at('executing'),
      blockingByObjective: blocked,
      statusType: 'execute'
    }),
    'waiting'
  );
  assert.equal(
    overviewBadge({
      objectives: at('pending_delivery'),
      blockingByObjective: none,
      statusType: 'execute'
    }),
    'executing'
  );
  assert.equal(
    overviewBadge({
      objectives: at('launching'),
      blockingByObjective: blocked,
      statusType: 'execute'
    }),
    'launching'
  );
  assert.equal(
    overviewBadge({
      objectives: at('complete'),
      blockingByObjective: none,
      statusType: 'complete'
    }),
    'complete'
  );
  assert.equal(
    overviewBadge({ objectives: at('draft'), blockingByObjective: none, statusType: 'next' }),
    null
  );
});

it('is a tablist with arrow-key movement and a linked tab panel', async () => {
  await mount();
  const objectives = screen.getByRole('tab', { name: /Objectives/ });
  objectives.focus();
  fireEvent.keyDown(objectives, { key: 'ArrowRight' });
  // Summary sits directly right of Objectives.
  const summaryTab = screen.getByRole('tab', { name: /Summary/ });
  assert.equal(summaryTab.getAttribute('aria-selected'), 'true');
  fireEvent.keyDown(summaryTab, { key: 'ArrowRight' });
  const forYou = screen.getByRole('tab', { name: /For you/ });
  assert.equal(forYou.getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, forYou);
  const panel = document.getElementById(forYou.getAttribute('aria-controls') ?? '');
  assert.equal(panel?.getAttribute('role'), 'tabpanel');
  assert.equal(panel?.getAttribute('aria-labelledby'), forYou.id);
  // The objective list stays mounted (hidden) so its order and reorder state survive.
  assert.ok(document.body.textContent?.includes('Objective rows'));
  fireEvent.keyDown(forYou, { key: 'End' });
  assert.equal(screen.getAllByRole('tab').at(-1)?.getAttribute('aria-selected'), 'true');
});

it('does not acknowledge the watermark while an evidence tab was never opened', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await mount();
  await act(async () => t.mock.timers.tick(10_000));
  assert.equal(
    requests.some(req => req.method !== 'GET' && req.path.endsWith('/summary/seen')),
    false
  );
  t.mock.timers.reset();
});
