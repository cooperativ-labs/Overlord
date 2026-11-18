import type { DeliveryDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { keys } from '../lib/query-keys.ts';

import { deferredWorkPromotion } from './DeferredWorkItem.tsx';
import {
  DeliveryPresentation,
  type DeliveryPresentationVariant,
  deliveryVariantForEligibility
} from './DeliverySummaryCard.tsx';

Object.defineProperty(globalThis, 'self', { configurable: true, value: window });

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  // Cached queries schedule gc timers that would keep the test process alive.
  clients.splice(0).forEach(client => client.clear());
});

const deferred = {
  id: 'deferred-work-0-d8cae660820aadbb',
  title: 'Advance the fake clock before the second retry',
  change: 'The test never advances the fake clock between attempts.',
  location: 'backend/sync-worker.test.ts › retries after a 503',
  doneWhen: 'The test passes 20 consecutive runs.'
};

function delivery(): DeliveryDto {
  return {
    id: 'delivery-1',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    sessionId: null,
    summary: 'Raw delivery summary text.',
    verificationSummary: null,
    followUpNotes: null,
    report: {
      schemaVersion: 1,
      agentReport: {
        humanActions: [],
        tradeoffsMade: [],
        knownRisks: [],
        deferredWork: [],
        assumptions: []
      },
      presentation: {
        status: 'composed',
        markdown: 'Shipped the retry worker.',
        humanActions: [
          {
            id: 'human-action-1',
            action: 'Add GEMINI_API_KEY to the backend service.',
            category: 'environment',
            source: 'agent'
          }
        ],
        tradeoffsMade: [
          {
            id: 'tradeoff-1',
            decision: 'Kept retries in process.',
            alternativesConsidered: ['A queue'],
            rationale: 'Fewer moving parts.',
            source: 'agent'
          }
        ],
        knownRisks: ['Retries can double-post on a crash.'],
        deferredWork: [deferred],
        assumptions: ['The provider rate limit stays at 60 per minute.'],
        generatedBy: 'gemini'
      }
    } as DeliveryDto['report'],
    deliveredAt: '2026-10-24T10:00:00.000Z',
    agentIdentifier: null,
    modelIdentifier: null,
    deferredWorkItems: [
      {
        actionId: deferred.id,
        title: deferred.title,
        change: deferred.change,
        location: deferred.location,
        doneWhen: deferred.doneWhen,
        resolution: null
      }
    ]
  };
}

function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function renderCard(variant: DeliveryPresentationVariant) {
  const value = delivery();
  return render(
    withQueryClient(
      <DeliveryPresentation delivery={value} summaryText={value.summary} variant={variant} />
    )
  );
}

describe('DeliveryPresentation', () => {
  it('drops follow-up actions and deferred work from an objective card', () => {
    renderCard('objective');
    assert.equal(screen.queryByText('Follow-up actions'), null);
    assert.equal(screen.queryByText('Deferred work'), null);
    assert.equal(screen.queryByText(deferred.title), null);
    assert.ok(screen.getByText('Tradeoffs made'));
    assert.ok(screen.getByText('Kept retries in process.'));
    assert.ok(screen.getByText('Known risks'));
    assert.ok(screen.getByText('Assumptions'));
    assert.ok(screen.getByText('Shipped the retry worker.'));
  });

  it('still opens the full delivery text on an objective card', () => {
    renderCard('objective');
    fireEvent.click(screen.getByText('Full delivery text'));
    assert.ok(screen.getByText('Raw delivery summary text.'));
  });

  it('keeps every section, with the structured deferred-work item, on a full card', () => {
    renderCard('full');
    assert.ok(screen.getByText('Follow-up actions'));
    assert.ok(screen.getByText('Deferred work'));
    assert.ok(screen.getByText(deferred.title));
    assert.ok(screen.getByText(deferred.change));
    assert.ok(screen.getByText(deferred.location));
    assert.ok(screen.getByText(deferred.doneWhen));
    assert.ok(screen.getByText('Tradeoffs made'));
  });
});

describe('deferred work resolved by an agent or a person', () => {
  function renderResolved(
    resolution: NonNullable<DeliveryDto['deferredWorkItems'][number]['resolution']>
  ) {
    const value = delivery();
    value.deferredWorkItems = [{ ...value.deferredWorkItems[0]!, resolution }];
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    clients.push(client);
    // The mission panel has already loaded the mission and its workspace members.
    client.setQueryData(keys.mission(value.missionId), {
      id: value.missionId,
      workspaceId: 'workspace-1',
      objectives: [
        { id: value.objectiveId, displayId: 'coo:900.cccc', title: 'Retry', state: 'complete' }
      ]
    });
    client.setQueryData(keys.workspaceMembers('workspace-1'), [
      {
        workspaceUserId: 'wu-1',
        displayName: 'Dana Reyes',
        handle: 'dana',
        email: null,
        isOperator: false
      }
    ]);
    return render(
      <QueryClientProvider client={client}>
        <DeliveryPresentation delivery={value} summaryText={value.summary} variant="full" />
      </QueryClientProvider>
    );
  }

  it("shows the closing objective and the agent's reason", () => {
    renderResolved({
      status: 'done',
      resolvedAt: '2026-10-23T10:00:00.000Z',
      resolvedByWorkspaceUserId: null,
      outcome: null,
      outcomeRef: null,
      reason: 'Implemented by the retry guard in this objective.',
      resolvedBy: {
        kind: 'agent',
        workspaceUserId: null,
        objectiveId: delivery().objectiveId,
        deliveryId: 'd-2'
      }
    });
    assert.ok(screen.getByRole('status').textContent?.includes('Done'));
    assert.ok(screen.getByText('coo:900.cccc'));
    assert.ok(screen.getByText('Implemented by the retry guard in this objective.'));
    assert.ok(screen.getByRole('button', { name: `Reopen: ${deferred.title}` }));
  });

  it('names the person who dismissed it', () => {
    renderResolved({
      status: 'dismissed',
      resolvedAt: '2026-10-23T10:00:00.000Z',
      resolvedByWorkspaceUserId: 'wu-1',
      outcome: null,
      outcomeRef: null,
      reason: null,
      resolvedBy: { kind: 'person', workspaceUserId: 'wu-1', objectiveId: null, deliveryId: null }
    });
    assert.ok(screen.getByRole('status').textContent?.includes('Dismissed'));
    assert.ok(screen.getByText('Dana Reyes'));
    assert.equal(screen.queryByText(/Reason:/), null);
  });
});

describe('deliveryVariantForEligibility', () => {
  it('trims only for a mission the summary envelope marks eligible', () => {
    assert.equal(deliveryVariantForEligibility(true), 'objective');
    assert.equal(deliveryVariantForEligibility(false), 'full');
    assert.equal(deliveryVariantForEligibility(undefined), 'full');
  });
});

describe('deferredWorkPromotion', () => {
  it('builds the title and the change, location and done-when instruction verbatim', () => {
    assert.deepEqual(deferredWorkPromotion(deferred), {
      title: deferred.title,
      instructionText:
        'The test never advances the fake clock between attempts.\n\n' +
        'Location: backend/sync-worker.test.ts › retries after a 503\n\n' +
        'Done when: The test passes 20 consecutive runs.'
    });
  });
});

it('renders closedElsewhere as live delivery data without changing the accepted report', async () => {
  const value = delivery();
  value.closedElsewhere = [
    {
      itemId: 'foreign-close',
      kind: 'risk',
      text: 'Fixed elsewhere',
      missionDisplayId: 'coo:901',
      status: 'dismissed',
      reason: 'No longer applies'
    }
  ];
  const immutableReport = JSON.stringify(value.report);
  const route = createRootRoute({
    component: () =>
      withQueryClient(<DeliveryPresentation delivery={value} summaryText={value.summary} />)
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });
  await act(async () => {
    await router.load();
    render(<RouterProvider router={router} />);
  });
  assert.ok(screen.getByText('Closed on other missions'));
  assert.ok(screen.getByText('Dismissed'));
  assert.ok(screen.getByText('No longer applies'));
  assert.ok(
    screen.getByRole('link', { name: 'coo:901' }).getAttribute('href')?.includes('coo%3A901')
  );
  assert.equal(JSON.stringify(value.report), immutableReport);
});
