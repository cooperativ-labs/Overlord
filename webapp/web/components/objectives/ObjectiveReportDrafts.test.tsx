import type {
  EntityChangeDto,
  ObjectiveReportDraftList,
  ReportDraftDto,
  ReportDraftEntryDto
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { REPORT_DRAFTS_SECTION_LABEL } from '../../lib/objective-report-drafts.ts';
import { invalidateRealtimeChanges } from '../../lib/realtime-invalidation.ts';

import { ObjectiveReportDrafts } from './ObjectiveReportDrafts.tsx';

/**
 * Plan §7.3: the read-only "Draft evidence — not delivered" section against a
 * stubbed REST transport, so laziness and scoped refresh are asserted on real
 * requests rather than on hook calls.
 */

type Recorded = { method: string; path: string };
let requests: Recorded[] = [];
let response: ObjectiveReportDraftList = { objectiveId: 'obj-1', drafts: [] };

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];

beforeEach(() => {
  requests = [];
  response = { objectiveId: 'obj-1', drafts: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
    if (url.pathname === '/api/objectives/obj-1/report-drafts') {
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  globalThis.fetch = originalFetch;
});

function entry(overrides: Partial<ReportDraftEntryDto> & { entryId: string }): ReportDraftEntryDto {
  return {
    kind: 'known_risk',
    content: { text: `Risk ${overrides.entryId}` },
    position: 0,
    state: 'active',
    withdrawnAt: null,
    withdrawnReason: null,
    importedFrom: null,
    sealedRef: null,
    revision: 1,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...overrides
  };
}

function draft(overrides: Partial<ReportDraftDto> & { id: string }): ReportDraftDto {
  const entries = overrides.entries ?? [];
  return {
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    sessionId: `sess-${overrides.id}-0000`,
    state: 'open',
    revision: 1,
    batchCount: 1,
    entryCount: entries.length,
    activeCounts: { human_action: 0, tradeoff: 0, known_risk: 0, deferred_work: 0, assumption: 0 },
    withdrawnCount: overrides.withdrawn?.length ?? 0,
    sealedAt: null,
    sealedDeliveryId: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:05:00.000Z',
    entries,
    withdrawn: [],
    ...overrides
  };
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ObjectiveReportDrafts objective={{ id: 'obj-1' }} />
    </QueryClientProvider>
  );
  return client;
}

function draftRequests() {
  return requests.filter(req => req.path.endsWith('/report-drafts'));
}

function openSection() {
  fireEvent.click(screen.getByRole('button', { name: REPORT_DRAFTS_SECTION_LABEL }));
}

function change(overrides: Partial<EntityChangeDto>): EntityChangeDto {
  return {
    seq: 1,
    workspaceId: 'ws-1',
    entityType: 'delivery_report_draft',
    entityId: 'd-1',
    operation: 'update',
    projectId: 'project-1',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    changedFields: ['revision', 'entries'],
    occurredAt: '2026-11-18T10:06:00.000Z',
    ...overrides
  };
}

describe('ObjectiveReportDrafts', () => {
  it('is collapsed and makes no request until opened', async () => {
    renderSection();
    assert.ok(screen.getByRole('button', { name: REPORT_DRAFTS_SECTION_LABEL }));
    assert.equal(screen.queryByText(/Loading draft evidence/), null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(draftRequests().length, 0);

    openSection();
    await screen.findByText('No draft evidence was recorded for this objective.');
    assert.equal(draftRequests().length, 1);
    // Only the draft read: no mission, summary, seen or item request.
    assert.deepEqual(requests, [{ method: 'GET', path: '/api/objectives/obj-1/report-drafts' }]);
  });

  it('shows the live draft, its source session and withdrawn observations behind a disclosure', async () => {
    response = {
      objectiveId: 'obj-1',
      drafts: [
        draft({
          id: 'd-1',
          sessionId: 'abcdef0123456789',
          entries: [
            entry({ entryId: 'r1', content: { text: 'Cache invalidation may race' } }),
            entry({
              entryId: 'h1',
              kind: 'human_action',
              content: { action: 'Apply the migration', blocking: true }
            })
          ],
          withdrawn: [
            entry({
              entryId: 'r0',
              state: 'withdrawn',
              content: { text: 'Login is broken' },
              withdrawnAt: '2026-11-18T10:03:00.000Z',
              withdrawnReason: 'False alarm'
            })
          ]
        })
      ]
    };
    renderSection();
    openSection();

    await screen.findByText('Cache invalidation may race');
    assert.ok(screen.getByText('Recording'));
    assert.ok(screen.getByText(/Session abcdef01/));
    assert.ok(screen.getByText(/has not delivered/));
    assert.ok(screen.getByText('Apply the migration'));
    assert.equal(screen.queryByText(/blocking/i), null);
    // No editing, withdrawal, import or promotion control.
    for (const name of [/edit/i, /withdraw$/i, /import/i, /promote/i, /resolve/i, /dismiss/i]) {
      assert.equal(screen.queryByRole('button', { name }), null);
    }

    // Withdrawn observations stay hidden until their own disclosure opens.
    assert.equal(screen.queryByText('Login is broken'), null);
    fireEvent.click(screen.getByRole('button', { name: /Withdrawn observations · 1/ }));
    await screen.findByText('Login is broken');
    assert.ok(screen.getByText(/False alarm/));
  });

  it('refreshes in place through scoped changes: open → abandoned, and open → sealed', async () => {
    response = {
      objectiveId: 'obj-1',
      drafts: [draft({ id: 'd-1', entries: [entry({ entryId: 'r1' })] })]
    };
    const client = renderSection();
    openSection();
    await screen.findByText('Recording');
    assert.equal(draftRequests().length, 1);

    // An unrelated mission change does not refetch the drafts.
    act(() => {
      invalidateRealtimeChanges(client, [
        change({ entityType: 'mission_summary', entityId: 'mission-1', objectiveId: null })
      ]);
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(draftRequests().length, 1);

    // The session ends without delivering: the same draft is now abandoned.
    response = {
      objectiveId: 'obj-1',
      drafts: [draft({ id: 'd-1', state: 'abandoned', entries: [entry({ entryId: 'r1' })] })]
    };
    act(() => {
      invalidateRealtimeChanges(client, [
        change({
          entityType: 'agent_session',
          entityId: 'sess',
          changedFields: ['phase', 'ended_at']
        })
      ]);
    });
    await screen.findByText('Abandoned');
    assert.ok(screen.getByText(/never accepted/));
    assert.equal(draftRequests().length, 2);

    // A replacement execution delivers and seals its own draft.
    response = {
      objectiveId: 'obj-1',
      drafts: [
        draft({
          id: 'd-2',
          state: 'sealed',
          sealedAt: '2026-11-18T11:00:00.000Z',
          sealedDeliveryId: 'delivery-1',
          entries: [
            entry({ entryId: 'r1', sealedRef: 'knownRisks[0]', content: { text: 'Kept risk' } }),
            entry({ entryId: 'r2', content: { text: 'Dropped risk' } })
          ]
        }),
        draft({ id: 'd-1', state: 'abandoned', entries: [entry({ entryId: 'r1' })] })
      ]
    };
    act(() => {
      invalidateRealtimeChanges(client, [
        change({ entityId: 'd-2', changedFields: ['sealed_at', 'sealed_delivery_id'] })
      ]);
    });
    await screen.findByText('Sealed by delivery');
    assert.equal(draftRequests().length, 3);
    // Sealed and abandoned drafts start as compact rows; open the sealed one.
    assert.equal(screen.queryByText('Kept risk'), null);
    fireEvent.click(screen.getByText('Sealed by delivery'));
    await screen.findByText('Kept risk');
    assert.ok(screen.getByText('In the accepted report as knownRisks[0]'));
    assert.ok(screen.getByText('Excluded at delivery'));
    assert.ok(screen.getByText(/Its delivery card shows the accepted report/));
  });

  it('does not refetch while closed, and reads fresh data when reopened', async () => {
    const client = renderSection();
    openSection();
    await screen.findByText('No draft evidence was recorded for this objective.');
    openSection(); // close
    await waitFor(() =>
      assert.equal(screen.queryByText('No draft evidence was recorded for this objective.'), null)
    );

    response = {
      objectiveId: 'obj-1',
      drafts: [
        draft({ id: 'd-1', entries: [entry({ entryId: 'r1', content: { text: 'New risk' } })] })
      ]
    };
    act(() => {
      invalidateRealtimeChanges(client, [change({})]);
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(draftRequests().length, 1);

    openSection();
    await screen.findByText('New risk');
    assert.equal(draftRequests().length, 2);
  });
});
