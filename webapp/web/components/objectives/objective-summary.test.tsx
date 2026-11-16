import type { ObjectiveDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { resetObjectiveEditBuffers } from '../../lib/objective-edit-buffers.ts';
import { resetSummaryBuffers } from '../../lib/objective-summary-buffers.ts';
import { ObjectiveDetailTabs } from '../objective-detail/ObjectiveDetailTabs.tsx';

/**
 * coo:1275 — objective summaries, as the objective detail's Summary and Instructions tabs
 * present them (coo:1281 plan §9.6). These render the real tabs against a stubbed REST
 * transport, so every assertion about what the detail *sends* is about real requests.
 */

const LONG_INSTRUCTION = `Implement the description UI in webapp/web/components/objectives. ${'Keep every queue rule. '.repeat(20)}`;
const SUMMARY =
  'Show a short summary on each objective card. Decision needed: include the inbox now or later.\n\nCAUTION: Do not change the launch payload. The work is done when people can read both texts.';

type Recorded = { method: string; path: string; body: unknown };
let requests: Recorded[] = [];
let respond: (req: Recorded) => { status: number; body: unknown } | null = () => null;

const MEMBERS = [
  {
    workspaceUserId: 'wu-me',
    userId: 'u-me',
    displayName: 'Me',
    handle: 'me',
    email: null,
    kind: 'human',
    roleKeys: [],
    isAdmin: false,
    isOperator: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    avatarUrl: null
  },
  {
    workspaceUserId: 'wu-ana',
    userId: 'u-ana',
    displayName: 'Ana',
    handle: 'ana',
    email: null,
    kind: 'human',
    roleKeys: [],
    isAdmin: false,
    isOperator: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
    avatarUrl: null
  }
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];

beforeEach(() => {
  requests = [];
  respond = () => null;
  resetSummaryBuffers();
  resetObjectiveEditBuffers();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : (init?.body ?? null);
    const req = { method, path: url.pathname, body };
    requests.push(req);
    const custom = respond(req);
    if (custom) return json(custom.status, custom.body);
    if (method === 'GET' && /\/api\/workspaces\/[^/]+\/members$/.test(url.pathname)) {
      return json(200, MEMBERS);
    }
    if (method === 'GET' && url.pathname.endsWith('/attachments')) return json(200, []);
    if (method === 'PATCH' || method === 'POST') return json(200, objective({ id: 'echo' }));
    return json(404, { error: 'not stubbed' });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  globalThis.fetch = originalFetch;
});

function objective(overrides: Partial<ObjectiveDto> & { id: string }): ObjectiveDto {
  return {
    workspaceId: 'ws-1',
    projectId: 'project-1',
    missionId: 'mission-1',
    position: 0,
    title: `Title ${overrides.id}`,
    titleSource: 'generated',
    titleStatus: null,
    description: null,
    descriptionSource: null,
    descriptionStale: false,
    descriptionStatus: null,
    descriptionFailureCode: null,
    descriptionSuppressed: false,
    descriptionEligible: true,
    descriptionRevision: 0,
    descriptionUpdatedAt: null,
    descriptionAuthorWorkspaceUserId: null,
    descriptionAuthorAgent: null,
    instructionText: LONG_INSTRUCTION,
    state: 'draft',
    autoAdvance: false,
    queueEntry: null,
    assignedAgent: null,
    model: null,
    reasoningEffort: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    launchedAt: null,
    startedAt: null,
    completedAt: null,
    reopenedAt: null,
    revision: 1,
    externalSessionId: null,
    branch: null,
    resourceKey: null,
    displayKey: overrides.id,
    displayId: `coo:1.${overrides.id}`,
    createdByKind: 'agent',
    createdByAgent: 'claude-code',
    createdByWorkspaceUserId: 'wu-me',
    launchConfigOverrides: {},
    ...overrides
  };
}

function withSummary(id: string, overrides: Partial<ObjectiveDto> = {}): ObjectiveDto {
  return objective({
    id,
    description: SUMMARY,
    descriptionSource: 'generated',
    descriptionRevision: 3,
    ...overrides
  });
}

function setup(initial: ObjectiveDto) {
  const qc = new QueryClient({
    // gcTime Infinity schedules no garbage-collection timers, so the test process can exit.
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  clients.push(qc);
  const view = (current: ObjectiveDto) => (
    <QueryClientProvider client={qc}>
      <ObjectiveDetailTabs
        // Keyed by objective id, as the detail mounts it.
        key={current.id}
        objective={current}
        emptyDraftGuard={{ attachmentCount: 0, hasHistory: false }}
        onObjectiveDeleted={() => undefined}
      />
    </QueryClientProvider>
  );
  const utils = render(view(initial));
  return { ...utils, rerenderTabs: (next: ObjectiveDto) => utils.rerender(view(next)) };
}

const descriptionRequests = () => requests.filter(r => r.path.endsWith('/description-requests'));
const summaryEditor = () =>
  screen.getByRole('textbox', { name: 'Objective summary' }) as HTMLTextAreaElement;

describe('Summary and Instructions tabs', () => {
  it('opens on Summary: prose, provenance, mention labels and actions; instructions behind their tab', () => {
    setup(withSummary('a'));
    const summaryTab = screen.getByRole('tab', { name: 'Summary' });
    assert.equal(summaryTab.getAttribute('aria-selected'), 'true');
    assert.ok(screen.getByText(/Show a short summary on each objective card/));
    assert.ok(screen.getByText('AI summary'));
    assert.ok(screen.getByRole('img', { name: 'Summary mentions 1 decision' }));
    assert.ok(screen.getByRole('img', { name: 'Summary mentions 1 caution' }));
    assert.ok(screen.getByRole('button', { name: 'Edit summary' }));
    assert.ok(screen.getByRole('button', { name: 'Regenerate summary' }));
    assert.ok(screen.getByRole('button', { name: 'Remove summary' }));

    const instructionsTab = screen.getByRole('tab', { name: 'Instructions' });
    const panel = document.getElementById(instructionsTab.getAttribute('aria-controls')!)!;
    assert.equal(panel.hidden, true);
    fireEvent.click(instructionsTab);
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent ?? '', /Implement the description UI/);
    // Rendering never asks for a summary.
    assert.equal(descriptionRequests().length, 0);
  });

  it('shows person-written and short instructions as today, with no tab row or summary controls', () => {
    const { unmount } = setup(
      objective({ id: 'a', instructionText: 'Fix the typo.', descriptionEligible: false })
    );
    assert.ok(screen.getByText('Fix the typo.'));
    assert.equal(screen.queryByRole('tablist'), null, 'no tabs without a summary');
    assert.equal(screen.queryByRole('button', { name: 'Summarize instructions' }), null);
    unmount();
    setup(objective({ id: 'b', instructionText: '' }));
    assert.equal(screen.queryByTestId('objective-summary-fallback'), null);
  });

  it('a blank draft keeps its instruction editor even when an old summary is stored', () => {
    setup(withSummary('a', { instructionText: '' }));
    assert.equal(screen.queryByRole('tablist'), null);
    assert.equal(screen.queryByTestId('objective-summary-prose'), null);
    assert.ok(screen.getByRole('button', { name: 'Edit instructions' }));
  });
});

describe('summary states and actions', () => {
  it('Summarize asks the server, never waits for a model, and leaves the instructions readable', async () => {
    setup(objective({ id: 'a' }));
    assert.ok(screen.getByText(/Implement the description UI/));
    fireEvent.click(screen.getByRole('button', { name: 'Summarize instructions' }));
    await waitFor(() => assert.equal(descriptionRequests().length, 1));
    assert.deepEqual(descriptionRequests()[0]!.body, { mode: 'summarize' });
    assert.equal(descriptionRequests()[0]!.path, '/api/objectives/a/description-requests');
  });

  it('pending keeps the instructions with "Writing summary…", and Cancel removes durably', async () => {
    setup(objective({ id: 'a', descriptionStatus: 'pending' }));
    assert.ok(screen.getByText('Writing summary…'));
    assert.ok(screen.getByText(/Implement the description UI/));
    fireEvent.click(screen.getByRole('button', { name: 'Stop summary' }));
    await waitFor(() => assert.ok(requests.some(r => r.method === 'PATCH')));
    const patch = requests.find(r => r.method === 'PATCH')!;
    assert.equal(patch.path, '/api/objectives/a');
    assert.deepEqual(patch.body, { description: null });
  });

  it('failure shows a stable message and Retry', async () => {
    setup(
      objective({
        id: 'a',
        descriptionStatus: 'failed',
        descriptionFailureCode: 'provider_unavailable'
      })
    );
    assert.ok(screen.getByText('Summary unavailable: no model provider is configured.'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry summary' }));
    await waitFor(() => assert.deepEqual(descriptionRequests()[0]?.body, { mode: 'retry' }));
  });

  it('regeneration keeps the prior summary with stale and pending lines', () => {
    setup(withSummary('a', { descriptionStale: true, descriptionStatus: 'pending' }));
    assert.ok(screen.getByText(/Show a short summary/));
    assert.ok(screen.getByText('Writing a new summary…'));
    assert.equal(screen.queryByRole('button', { name: 'Regenerate summary' }), null);
  });

  it('Remove keeps the summary absent until a person clicks Summarize, whatever arrives later', async () => {
    const { rerenderTabs } = setup(withSummary('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove summary' }));
    await waitFor(() => assert.ok(requests.some(r => r.method === 'PATCH')));
    assert.deepEqual(requests.find(r => r.method === 'PATCH')!.body, { description: null });

    // Server state after Remove, then after an instruction edit and a catch-up scan:
    // still suppressed, still no summary. The detail shows instructions and Summarize.
    rerenderTabs(objective({ id: 'a', descriptionSuppressed: true, descriptionRevision: 4 }));
    assert.ok(screen.getByText('Summary removed'));
    assert.ok(screen.getByText(/Implement the description UI/));
    assert.equal(screen.queryByTestId('objective-summary-prose'), null);
    rerenderTabs(
      objective({
        id: 'a',
        instructionText: `${LONG_INSTRUCTION} Edited.`,
        descriptionSuppressed: true,
        descriptionRevision: 4
      })
    );
    assert.equal(screen.queryByTestId('objective-summary-prose'), null);
    assert.equal(descriptionRequests().length, 0, 'nothing re-enables it automatically');

    fireEvent.click(screen.getByRole('button', { name: 'Summarize instructions' }));
    await waitFor(() => assert.deepEqual(descriptionRequests()[0]?.body, { mode: 'summarize' }));
  });

  it('attributes edits accurately: "Edited by you" only to the editor', async () => {
    const mine = setup(
      withSummary('a', { descriptionSource: 'user', descriptionAuthorWorkspaceUserId: 'wu-me' })
    );
    await waitFor(() => assert.ok(screen.getByText('Edited by you')));
    mine.unmount();
    const ana = setup(
      withSummary('b', { descriptionSource: 'user', descriptionAuthorWorkspaceUserId: 'wu-ana' })
    );
    await waitFor(() => assert.ok(screen.getByText('Edited by Ana')));
    ana.unmount();
    setup(withSummary('c', { descriptionSource: 'agent', descriptionAuthorAgent: null }));
    assert.ok(screen.getByText('Written by agent'));
  });
});

describe('editing through realtime results and launch', () => {
  it('a summary that arrives mid-edit keeps the instruction editor and selects Instructions', () => {
    const a = objective({ id: 'a', descriptionStatus: 'pending' });
    const { rerenderTabs } = setup(a);
    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions' }));
    const editor = screen.getByRole('textbox', {
      name: 'Objective instruction'
    }) as HTMLTextAreaElement;
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: 'Still typing' } });

    rerenderTabs(withSummary('a', { descriptionRevision: 1 }));

    const after = screen.getByRole('textbox', { name: 'Objective instruction' });
    assert.equal((after as HTMLTextAreaElement).value, 'Still typing');
    assert.equal(
      screen.getByRole('tab', { name: 'Instructions' }).getAttribute('aria-selected'),
      'true'
    );
    assert.ok(screen.getByTestId('objective-summary-prose'));
  });

  it('keeps an unsaved summary when the objective launches, and across a remount', () => {
    const a = withSummary('a');
    const { rerenderTabs, unmount } = setup(a);
    fireEvent.click(screen.getByRole('button', { name: 'Edit summary' }));
    fireEvent.change(summaryEditor(), { target: { value: 'Edit across launch.' } });
    const launching = { ...a, state: 'launching' as const, launchedAt: '2026-11-14T10:05:00.000Z' };
    rerenderTabs(launching);
    assert.equal(summaryEditor().value, 'Edit across launch.');
    unmount();
    setup(launching);
    assert.equal(summaryEditor().value, 'Edit across launch.');
  });

  it('saves with the starting revision and keeps the text on a 409 conflict', async () => {
    respond = req =>
      req.method === 'PATCH'
        ? {
            status: 409,
            body: {
              error: 'The summary changed after you started editing it.',
              code: 'description_conflict'
            }
          }
        : null;
    setup(withSummary('a', { descriptionRevision: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit summary' }));
    fireEvent.change(summaryEditor(), { target: { value: 'Mine.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }));
    await waitFor(() => assert.ok(screen.getByText(/changed while you were editing/)));
    assert.deepEqual(requests.find(r => r.method === 'PATCH')!.body, {
      description: 'Mine.',
      expectedDescriptionRevision: 3
    });
    assert.equal(summaryEditor().value, 'Mine.');
  });

  it('Escape cancels the summary edit without a request', () => {
    setup(withSummary('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit summary' }));
    fireEvent.keyDown(summaryEditor(), { key: 'Escape' });
    assert.equal(screen.queryByRole('textbox', { name: 'Objective summary' }), null);
    assert.equal(requests.filter(r => r.method === 'PATCH').length, 0);
  });
});

describe('executed objectives', () => {
  it('a completed objective keeps an editable summary, with read-only instructions in their tab', () => {
    setup(
      withSummary('a', {
        state: 'complete',
        startedAt: '2026-11-14T10:00:00.000Z',
        completedAt: '2026-11-14T11:00:00.000Z'
      })
    );
    assert.ok(screen.getByTestId('objective-summary-prose'));
    assert.ok(screen.getByRole('button', { name: 'Edit summary' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Instructions' }));
    assert.equal(screen.queryByRole('button', { name: 'Edit instructions' }), null);
  });

  it('without a summary shows the instructions and Summarize, never an empty Summary tab', () => {
    setup(
      objective({
        id: 'a',
        state: 'complete',
        startedAt: '2026-11-14T10:00:00.000Z',
        completedAt: '2026-11-14T11:00:00.000Z'
      })
    );
    assert.ok(screen.getByText(/Implement the description UI/));
    assert.equal(screen.queryByRole('tab', { name: 'Summary' }), null);
    assert.ok(screen.getByRole('button', { name: 'Summarize instructions' }));
  });
});
