import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import type { DeliveryDto } from '../../shared/contract.ts';

import { deferredWorkPromotion } from './DeferredWorkItem.tsx';
import {
  DeliveryPresentation,
  type DeliveryPresentationVariant,
  deliveryVariantForEligibility
} from './DeliverySummaryCard.tsx';

afterEach(() => cleanup());

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
