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
import { afterEach, it } from 'node:test';

import type { MissionDetailDto, MissionSummaryResponse } from '../../../shared/contract.ts';
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
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

async function mount(response: MissionSummaryResponse = structuredClone(fixture.summaryResponse)) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } }
  });
  clients.push(client);
  const id = fixture.mission.id;
  client.setQueryData(keys.missionSummary(id), response);
  client.setQueryData(keys.missionAgentRequests(id), fixture.agentRequests);
  client.setQueryData(keys.missionDeliveries(id), {
    items: fixture.deliveries,
    total: fixture.deliveries.length
  });
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
  const action = screen.getByRole('button', { name: /Run the migration on staging/ });
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
  assert.ok(screen.getByRole('button', { name: /Run the migration on staging/ }));
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
