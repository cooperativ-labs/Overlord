import type { MissionDetailDto, MissionSummaryResponse } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, it } from 'node:test';

import { useMissionOpenAgentRequests } from '../../lib/queries.ts';
import { keys } from '../../lib/query-keys.ts';

import { MissionOverviewCard } from './MissionOverviewCard.tsx';

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

/** Opens the Summary tab and expands its collapsed Resolved group (the mission's decisions). */
function openResolved(count?: number) {
  selectTab(/Summary/);
  const toggle = screen.getByRole('button', {
    name: count === undefined ? /^Resolved\s*\d+$/ : new RegExp(`^Resolved\\s*${count}$`)
  });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

async function mount(
  response: MissionSummaryResponse = structuredClone(fixture.summaryResponse),
  deliveries: unknown[] = fixture.deliveries,
  agentRequests: readonly FixtureRequest[] = fixture.agentRequests
) {
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
  setOpenRequests(client, agentRequests);
  // The Files tab mounts after the first render; seed what it reads so no request outlives the
  // test's fetch stub.
  client.setQueryData(keys.profile, { editorScheme: null });
  client.setQueryData(keys.missionDeliveries(id), { items: deliveries, total: deliveries.length });
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

type Narrative = Extract<MissionSummaryResponse, { eligible: true }>['narrative'];

/** A narrative envelope (contract v175) over sensible defaults. */
function narrative(patch: Partial<Narrative> = {}): Narrative {
  return {
    state: 'current',
    evidenceRevision: 4,
    publishedEvidenceRevision: 4,
    deliveryId: 'delivery-c4',
    objectiveId: 'obj-c',
    publishedAt: '2026-10-23T10:05:00.000Z',
    changedAt: '2026-10-23T10:05:00.000Z',
    outstandingDeliveryId: null,
    ...patch
  };
}

function seenWrites(): string[] {
  return requests
    .filter(req => req.method === 'PUT' && req.path.endsWith('/summary/seen'))
    .map(req => (req.body as { watermark: string }).watermark);
}

it('keeps old missions to Objectives and For you, and shows the before-first-delivery state', async () => {
  // Dismissal removes the top notification, leaving the question available under For you.
  const dismissed = (fixture.agentRequests as FixtureRequest[]).map(request => ({
    ...request,
    dismissed: true
  }));
  await mount(
    {
      eligible: false,
      summary: null,
      evidence: null,
      watermark: null,
      narrative: null,
      narrativeWatermark: null,
      seenAt: null
    },
    fixture.deliveries,
    dismissed
  );
  assert.ok(screen.getByText('Objective rows'));
  assert.ok(screen.getByRole('tab', { name: /For you/ }));
  assert.equal(screen.getAllByRole('tab').length, 2);
  assert.equal(
    screen.getByRole('tab', { name: /Objectives/ }).getAttribute('aria-selected'),
    'true'
  );
  const status = screen.getByRole('group', { name: 'Mission status' });
  const waiting = within(status).getByText('Waiting on you');
  assert.doesNotMatch(waiting.className, /bg-amber/);
  selectTab(/For you/);
  const questionChip = screen.getByText('Question', { exact: true });
  assert.doesNotMatch(questionChip.className, /bg-amber/);
  cleanup();
  window.localStorage.clear();
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

it('never shows an updating state, and renders expandable actions, compact promoted suggestions, and persistent visit dots', async () => {
  // A historical `pending` status no longer means a writer runs (ADR 0076).
  const response = structuredClone(fixture.summaryResponse);
  response.summary.status = 'pending';
  const client = await mount(response);
  const region = screen.getByRole('region', { name: 'Mission summary' });
  assert.equal(region.getAttribute('aria-busy'), null);
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(screen.queryByText(/Updating/), null);
  selectTab(/For you/);
  const action = screen.getByRole('button', {
    name: /^Show details: Run the migration on staging/
  });
  assert.equal(action.getAttribute('aria-expanded'), 'false');
  fireEvent.click(action);
  assert.equal(action.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('yarn db:migrate --env staging'));
  // A promoted suggestion is a resolved item; it is listed in the Summary tab's Resolved group.
  openResolved();
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
  // Files sit in the Summary tab, below the summary and risks.
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

it('names the authoring objective, and keeps automatic provenance on earlier summaries', async () => {
  await mount();
  selectTab(/Summary/);
  // Risks, resolved items and files live in the Summary tab, not in tabs of their own.
  const labels = screen.getAllByRole('tab').map(tab => tab.textContent ?? '');
  for (const gone of [/^Risks/, /^Resolved/, /^Files/]) {
    assert.equal(
      labels.some(label => gone.test(label)),
      false,
      String(gone)
    );
  }
  assert.ok(screen.getByRole('heading', { name: /^Risks/ }));
  assert.ok(screen.getByRole('heading', { name: /^Files changed/ }));
  // The full summary is shown; there is no clamp toggle.
  assert.equal(screen.queryByRole('button', { name: /^Show (more|less)$/ }), null);
  assert.ok(screen.getByText('Updated by'));
  assert.ok(
    screen.getByRole('button', { name: 'Open objective coo:900.cccc, which wrote this summary' })
  );
  cleanup();
  const fallback = structuredClone(fixture.summaryResponse);
  fallback.summary.author = { kind: 'gemini', objectiveId: null, deliveryId: null };
  fallback.summary.generatedBy = 'gemini';
  fallback.narrative = narrative({ state: 'legacy', changedAt: fallback.summary.generatedAt });
  fallback.narrativeWatermark = fallback.summary.generatedAt;
  await mount(fallback);
  selectTab(/Summary/);
  // Historical generated text stays visibly earlier and is never called agent-authored.
  assert.ok(screen.getByText('Earlier summary'));
  assert.ok(screen.getByText('Written automatically from deliveries'));
  assert.equal(screen.queryByText('Updated by'), null);
  assert.equal(screen.queryByText('Written by'), null);
});

it('lists reported tradeoffs in their own Summary section, and hides it when there are none', async () => {
  await mount();
  selectTab(/Summary/);
  assert.equal(screen.queryByRole('region', { name: /^Tradeoffs/ }), null);
  cleanup();
  const tradeoff = {
    id: 'tradeoff-0',
    decision: 'Kept the summary cache in memory.',
    alternativesConsidered: ['Redis', 'No cache'],
    rationale: 'One process serves the panel today.',
    impact: 'A restart drops the cache.',
    source: 'agent'
  };
  const deliveries = fixture.deliveries.map((delivery: { id: string }, index: number) =>
    index === 0
      ? { ...delivery, report: { presentation: { tradeoffsMade: [tradeoff] } } }
      : delivery
  );
  await mount(structuredClone(fixture.summaryResponse), deliveries);
  selectTab(/Summary/);
  const region = screen.getByRole('region', { name: /^Tradeoffs\s*1$/ });
  const text = region.textContent ?? '';
  for (const part of [
    tradeoff.decision,
    tradeoff.rationale,
    'Impact: A restart drops the cache.',
    'Considered: Redis, No cache'
  ]) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(
    within(region).getByRole('button', { name: 'Open the delivery in objective coo:900.cccc' })
  );
});

it('lists resolved items in the Summary tab, with kind, who resolved them and the reason', async () => {
  await mount();
  openResolved(4);
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
  selectTab(/Summary/);
  assert.equal(screen.queryByRole('region', { name: 'Resolved items' }) === null, true);
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
  selectTab(/Summary/);

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
  openResolved(5);
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
  openResolved(4);
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

/** The live status line: its kind from `data-live-status`, and its visible text. */
function liveStatus() {
  const element = screen.getByRole('group', { name: 'Mission status' });
  return { kind: element.getAttribute('data-live-status'), text: element.textContent ?? '' };
}

it('shows the live status apart from the summary prose and updates it when the last blocker closes', async () => {
  const blocker = fixture.summaryResponse.evidence.actions[0];
  assert.equal(blocker.blocking, true);
  const after = structuredClone(fixture.summaryResponse);
  after.evidence.actions = after.evidence.actions.filter(
    (action: { id: string }) => action.id !== blocker.id
  );
  after.evidence.totals.actions -= 1;
  nextSummary = after;
  await mount();

  // Blocked by the one blocking action; the agent-written prose is untouched and separate.
  assert.deepEqual(liveStatus().kind, 'blocked');
  assert.match(liveStatus().text, /Blocked/);
  assert.match(liveStatus().text, /1 blocking action needs you/);
  selectTab(/Summary/);
  const status = screen.getByRole('group', { name: 'Mission status' });
  assert.equal(
    status.contains(screen.getByRole('heading', { level: 2 })),
    false,
    'the status is outside the headline and summary'
  );

  selectTab(/For you/);
  fireEvent.click(screen.getByRole('button', { name: `Resolve action: ${blocker.action}` }));
  fireEvent.submit(screen.getByRole('form', { name: `Resolve action: ${blocker.action}` }));
  await settle();

  // No delivery and no new summary prose: the status moved on from live item state alone. The
  // open question still needs a person.
  assert.equal(liveStatus().kind, 'waiting');
  assert.match(liveStatus().text, /Waiting on you/);
});

it('groups equal actions into one row and closes every record, oldest first', async () => {
  const response = structuredClone(fixture.summaryResponse);
  const [newest, older] = response.evidence.actions.filter((action: { action: string }) =>
    /overlord_flag/i.test(action.action)
  );
  assert.ok(newest && older);
  await mount(response);
  selectTab(/For you/);

  const row = screen.getByText(newest.action).closest('li')!;
  const group = row.querySelector('[data-item-group]');
  assert.ok(group, 'the row says it stands for several records');
  assert.match(group.textContent ?? '', /2 matching action records from/);
  assert.ok(
    within(group as HTMLElement).getByRole('button', { name: 'Open objective coo:900.cccc' })
  );
  assert.match(group.textContent ?? '', /Delivery/, 'a deleted objective shows as Delivery');
  assert.equal(
    screen.getAllByText(newest.action).length,
    1,
    'the older wording is not a second row'
  );

  const trigger = within(row).getByRole('button', {
    name: /Resolve all 2 matching action records/
  });
  assert.match(trigger.textContent ?? '', /Resolve all 2/);
  fireEvent.click(trigger);
  const form = screen.getByRole('form', { name: /Resolve all 2 matching action records/ });
  assert.match(form.textContent ?? '', /closes all 2 matching action records/);
  fireEvent.submit(form);
  await settle();
  assert.deepEqual(
    requests.filter(req => req.method === 'PUT').map(req => req.path),
    [`/api/mission-items/${older.id}/resolution`, `/api/mission-items/${newest.id}/resolution`],
    'the older record closes first and the shown record last'
  );
});

it('groups a risk reported by two objectives and shows its sources and the close-all control', async () => {
  const response = structuredClone(fixture.summaryResponse);
  const risk = response.summary.risks[0];
  risk.duplicates = [
    {
      id: 'item-risk-dup',
      deliveryId: 'delivery-a1',
      objectiveId: 'obj-a',
      deliveredAt: '2026-10-21T08:00:00.000Z'
    }
  ];
  await mount(response);
  selectTab(/Summary/);

  const row = screen.getByText(risk.text).closest('li')!;
  assert.match(
    row.querySelector('[data-item-group]')?.textContent ?? '',
    /2 matching risk records from/
  );
  fireEvent.click(within(row).getByRole('button', { name: /Resolve all 2 matching risk records/ }));
  fireEvent.submit(screen.getByRole('form', { name: /Resolve all 2 matching risk records/ }));
  await settle();
  assert.deepEqual(
    requests.filter(req => req.method === 'PUT').map(req => req.path),
    ['/api/mission-items/item-risk-dup/resolution', `/api/mission-items/${risk.id}/resolution`]
  );
});

it('decides a grouped suggestion for every matching record, and keeps different scope apart', async () => {
  const response = structuredClone(fixture.summaryResponse);
  const [first, second] = response.summary.suggestions;
  first.duplicates = [
    {
      id: 'item-suggestion-dup',
      deliveryId: 'delivery-a1',
      objectiveId: 'obj-a',
      deliveredAt: '2026-10-21T08:00:00.000Z'
    }
  ];
  await mount(response);
  selectTab(/Suggested/);

  const row = screen.getByText(first.title).closest('li')!;
  assert.match(
    row.querySelector('[data-item-group]')?.textContent ?? '',
    /2 matching suggestion records from/
  );
  const otherRow = screen.getByText(second.title).closest('li')!;
  assert.equal(
    otherRow.querySelector('[data-item-group]'),
    null,
    'a suggestion with its own scope is not grouped'
  );

  fireEvent.click(within(row).getByRole('button', { name: new RegExp(first.title) }));
  assert.match(row.textContent ?? '', /applies to all 2 matching records/);
  fireEvent.click(within(row).getByRole('button', { name: `Dismiss: ${first.title}` }));
  await settle();
  // The older record closes through its item id before the shown one is decided.
  assert.deepEqual(
    requests.find(req => req.method === 'PUT'),
    {
      method: 'PUT',
      path: '/api/mission-items/item-suggestion-dup/resolution',
      body: { status: 'dismissed', reason: 'Dismissed with its match.' }
    }
  );
  assert.equal(
    requests.filter(req => req.path.startsWith('/api/mission-items/')).length,
    1,
    'only the matching duplicate closes here; the shown record uses the delivery route'
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

it('shows outdated prose with its author and the latest accepted work, without a spinner', async () => {
  const response = structuredClone(fixture.summaryResponse);
  response.summary.author = { kind: 'agent', objectiveId: 'obj-a', deliveryId: 'delivery-a2' };
  response.narrative = narrative({
    state: 'outdated',
    evidenceRevision: 5,
    deliveryId: 'delivery-a2',
    objectiveId: 'obj-a',
    changedAt: '2026-10-23T10:00:00.001Z',
    outstandingDeliveryId: 'delivery-c4'
  });
  response.narrativeWatermark = '2026-10-23T10:00:00.001Z';
  await mount(response);
  selectTab(/Summary/);
  assert.ok(screen.getByText(fixture.summaryResponse.summary.headline));
  assert.ok(screen.getByText('Summary not updated for the latest delivery.'));
  assert.ok(
    screen.getByRole('button', {
      name: 'Open objective coo:900.cccc, the latest accepted delivery'
    })
  );
  assert.ok(
    screen.getByRole('button', { name: 'Open objective coo:900.aaaa, which wrote this summary' })
  );
  assert.equal(screen.queryByText('Earlier summary'), null);
  assert.equal(screen.queryByRole('status'), null);
  // Live status and items stay independent of the narrative.
  assert.ok(screen.getByRole('group', { name: 'Mission status' }));
  assert.ok(screen.getByRole('heading', { name: /^Risks/ }));
});

it('shows accepted work with no prose as not yet provided, keeping items and live status', async () => {
  const response = structuredClone(fixture.summaryResponse);
  response.summary = {
    ...response.summary,
    headline: '',
    summary: '',
    author: { kind: 'deterministic', objectiveId: null, deliveryId: null },
    generatedBy: 'deterministic',
    generatedAt: null,
    model: null
  };
  response.narrative = narrative({
    state: 'absent',
    evidenceRevision: 3,
    publishedEvidenceRevision: null,
    deliveryId: null,
    objectiveId: null,
    publishedAt: null,
    changedAt: '2026-10-23T10:00:00.000Z',
    outstandingDeliveryId: 'delivery-c4'
  });
  response.narrativeWatermark = '2026-10-23T10:00:00.000Z';
  await mount(response);
  selectTab(/Summary/);
  assert.ok(screen.getByText('Summary not yet provided.'));
  // With no prose the header falls back to the mission's own title, never a generated line.
  assert.equal(
    document.getElementById(`mission-summary-headline-${fixture.mission.id}`)?.textContent ?? '',
    fixture.mission.title ?? ''
  );
  assert.equal(screen.queryByText(fixture.summaryResponse.summary.headline), null);
  assert.ok(
    screen.getByRole('button', {
      name: 'Open objective coo:900.cccc, the latest accepted delivery'
    })
  );
  assert.equal(screen.queryByText(/Updated by|Written by|Written automatically/), null);
  assert.ok(screen.getByRole('heading', { name: /^Risks/ }));
  selectTab(/For you/);
  assert.ok(screen.getByRole('button', { name: /^Show details: Run the migration on staging/ }));
});

it('renders an older server response without narrative fields and invents no freshness', async () => {
  const response = structuredClone(fixture.summaryResponse) as Record<string, unknown>;
  delete response.narrative;
  delete response.narrativeWatermark;
  await mount(response as unknown as MissionSummaryResponse);
  selectTab(/Summary/);
  assert.ok(screen.getByText(fixture.summaryResponse.summary.headline));
  assert.equal(screen.queryByText(/Summary not (updated|yet provided)/), null);
  assert.equal(screen.queryByText('Earlier summary'), null);
  assert.ok(screen.getByText('Updated by'));
});

/** Every evidence group of the fixture, displayed for two seconds each. */
async function coverTabs(t: { mock: { timers: { tick: (ms: number) => void } } }, tabs: RegExp[]) {
  for (const tab of tabs) {
    selectTab(tab);
    await act(async () => t.mock.timers.tick(2_000));
  }
}

it('keeps older hidden actions unread while a newer narrative is visible, then acknowledges the combined maximum', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = structuredClone(fixture.summaryResponse);
  // The narrative changed after every delivery and question in this snapshot.
  const newer = '2026-10-23T12:00:00.000Z';
  response.narrative = narrative({ changedAt: newer, publishedAt: newer });
  response.narrativeWatermark = newer;
  await mount(response);
  await coverTabs(t, [/Summary/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'For you and Suggested were never displayed');
  await coverTabs(t, [/For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(2_000));
  // settle() runs on real timers.
  t.mock.timers.reset();
  await settle();
  assert.deepEqual(seenWrites(), [newer]);
  t.mock.timers.reset();
});

it('keeps an older hidden narrative unread while newer actions are visible, across a remount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = structuredClone(fixture.summaryResponse);
  const older = '2026-10-22T09:00:00.000Z';
  response.narrative = narrative({ changedAt: older, publishedAt: older });
  response.narrativeWatermark = older;
  await mount(response);
  await coverTabs(t, [/For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'the Summary header was never displayed');
  // Navigating away and back is a cold read: earlier coverage does not carry over.
  cleanup();
  await mount(response);
  await coverTabs(t, [/Summary/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'coverage from the earlier mount was not kept');
  await coverTabs(t, [/For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(2_000));
  // settle() runs on real timers.
  t.mock.timers.reset();
  await settle();
  assert.deepEqual(seenWrites(), [fixture.summaryResponse.watermark]);
  t.mock.timers.reset();
});

it('re-requires the Summary header when the narrative changes, even within one millisecond', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = structuredClone(fixture.summaryResponse);
  const at = '2026-10-23T12:00:00.000Z';
  response.narrative = narrative({ changedAt: at, publishedAt: at });
  response.narrativeWatermark = at;
  const client = await mount(response);
  await coverTabs(t, [/Summary/, /For you/]);
  // A new publication lands with the same display time but a new content revision, while the
  // Suggested tab (the last uncovered group) is open: the changed header is not covered yet.
  selectTab(/Suggested/);
  await act(async () =>
    client.setQueryData(keys.missionSummary(fixture.mission.id), {
      ...response,
      summary: { ...response.summary, contentRevision: response.summary.contentRevision + 1 },
      narrative: narrative({ changedAt: at, publishedAt: at, evidenceRevision: 4 })
    })
  );
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'the changed header invalidated its earlier coverage');
  await coverTabs(t, [/Summary/, /Suggested/]);
  await act(async () => t.mock.timers.tick(2_000));
  // settle() runs on real timers.
  t.mock.timers.reset();
  await settle();
  assert.deepEqual(seenWrites(), [at]);
  t.mock.timers.reset();
});

function crossDecisionResponse(at = '2026-10-23T13:00:00.000Z') {
  const response = structuredClone(fixture.summaryResponse);
  response.itemsWatermark = at;
  response.itemsTruncated = false;
  const row = response.summary.closedItems[0];
  row.status = 'dismissed';
  row.resolvedAt = at;
  row.reason = 'Verified by the fixing mission';
  row.resolvedBy = {
    kind: 'agent',
    workspaceUserId: null,
    objectiveId: 'foreign-obj',
    deliveryId: null,
    missionId: 'foreign-mission',
    missionDisplayId: 'coo:901',
    objectiveDisplayId: 'coo:901.abcd',
    crossMission: true
  };
  return response;
}

it('auto-opens new cross-mission rows with correct provenance and keeps hidden groups unread', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = crossDecisionResponse();
  await mount(response);
  selectTab(/Summary/);
  assert.equal(
    screen.getByRole('button', { name: /^Resolved.*New$/ }).getAttribute('aria-expanded'),
    'true'
  );
  const links = screen.getAllByRole('link');
  assert.ok(
    links.some(
      link =>
        link.textContent === 'coo:901.abcd' &&
        link.getAttribute('href')?.includes('objective=coo%3A901.abcd')
    )
  );
  assert.ok(
    links.some(
      link => link.textContent === 'coo:901' && link.getAttribute('href')?.includes('coo%3A901')
    )
  );
  assert.ok(screen.getByText('Not delivered yet', { exact: false }));
  assert.ok(screen.getByText('Verified by the fixing mission', { exact: false }));
  await act(async () => t.mock.timers.tick(2_000));
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'older actions and suggestions still hidden');
  await coverTabs(t, [/For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(2_000));
  t.mock.timers.reset();
  await settle();
  assert.deepEqual(seenWrites(), [response.itemsWatermark]);
});

it('newer actions cannot acknowledge collapsed older decisions, and remount clears item coverage', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = crossDecisionResponse('2026-10-20T09:00:00.000Z');
  await mount(response);
  await coverTabs(t, [/Summary/, /For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'old item decision is collapsed and unread');
  selectTab(/Summary/);
  fireEvent.click(screen.getByRole('button', { name: /^Resolved\s*\d+$/ }));
  await act(async () => t.mock.timers.tick(2_000));
  cleanup();
  await mount(response);
  await coverTabs(t, [/For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'item and narrative coverage does not survive remount');
  t.mock.timers.reset();
});

it('linking a standalone close invalidates item coverage until the new provenance is displayed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = crossDecisionResponse();
  const client = await mount(response);
  await coverTabs(t, [/Summary/, /For you/]);
  const linked = structuredClone(response);
  linked.summary.closedItems[0].resolvedBy.deliveryId = 'accepted-elsewhere';
  await act(async () => client.setQueryData(keys.missionSummary(fixture.mission.id), linked));
  await coverTabs(t, [/Suggested/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), [], 'prior standalone row coverage is stale');
  await coverTabs(t, [/Summary/]);
  await act(async () => t.mock.timers.tick(2_000));
  t.mock.timers.reset();
  await settle();
  assert.deepEqual(seenWrites(), [response.itemsWatermark]);
  assert.equal(screen.queryByText('Not delivered yet', { exact: false }), null);
});

it('never acknowledges capped resolved rows, even after every rendered tab is covered', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = crossDecisionResponse();
  response.itemsTruncated = true;
  await mount(response);
  await coverTabs(t, [/Summary/, /For you/, /Suggested/]);
  await act(async () => t.mock.timers.tick(10_000));
  assert.deepEqual(seenWrites(), []);
  selectTab(/Summary/);
  assert.ok(screen.getByText(/partial snapshot will remain unread/));
  t.mock.timers.reset();
});

it('a visible resolved header and first row cannot cover another cross-mission row below the viewport', async t => {
  const original = globalThis.IntersectionObserver;
  const observers: Array<{
    notify: IntersectionObserverCallback;
    node: Element | null;
    live: boolean;
  }> = [];
  globalThis.IntersectionObserver = class {
    entry: (typeof observers)[number];
    constructor(notify: IntersectionObserverCallback) {
      this.entry = { notify, node: null, live: true };
      observers.push(this.entry);
    }
    observe(node: Element) {
      this.entry.node = node;
    }
    disconnect() {
      this.entry.live = false;
    }
  } as unknown as typeof IntersectionObserver;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const response = crossDecisionResponse();
    response.summary.closedItems.push({
      ...structuredClone(response.summary.closedItems[0]),
      id: 'below-viewport',
      text: 'Another cross-mission decision below viewport'
    });
    await mount(response);
    const observe = async (includeLast: boolean) =>
      act(async () => {
        for (const { notify, node, live } of observers) {
          if (!live || !node) continue;
          const hidden =
            node.tagName === 'LI' && node.textContent?.includes('Another cross-mission decision');
          const visible = includeLast || !hidden;
          notify(
            [
              {
                isIntersecting: visible,
                intersectionRatio: visible ? 1 : 0
              } as IntersectionObserverEntry
            ],
            {} as IntersectionObserver
          );
        }
      });
    for (const tab of [/Summary/, /For you/, /Suggested/]) {
      selectTab(tab);
      await observe(false);
      await act(async () => t.mock.timers.tick(2_000));
    }
    await act(async () => t.mock.timers.tick(10_000));
    assert.deepEqual(seenWrites(), [], 'one actual decision row has never been displayed');
    selectTab(/Summary/);
    await observe(true);
    await act(async () => t.mock.timers.tick(2_000));
    await act(async () => t.mock.timers.tick(2_000));
    t.mock.timers.reset();
    await settle();
    assert.deepEqual(seenWrites(), [response.itemsWatermark]);
  } finally {
    t.mock.timers.reset();
    cleanup();
    globalThis.IntersectionObserver = original;
  }
});
