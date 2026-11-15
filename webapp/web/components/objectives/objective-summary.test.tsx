import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { partitionMissionEvidence } from '../../lib/objective-evidence.ts';
import { resetSummaryBuffers } from '../../lib/objective-summary-buffers.ts';
import { MissionLatchSessionProvider } from '../ObjectiveTerminalSessions.tsx';

import { MissionObjectivesSection } from './MissionObjectivesSection.tsx';

/**
 * coo:1275 — objective summaries in the web/desktop mission panel. These render the real
 * panel (queue head, compact cards, launching and executed rows) against a stubbed REST
 * transport, so every assertion about what the panel *sends* is about real requests.
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

function mission(objectives: ObjectiveDto[]): MissionDetailDto {
  return {
    id: 'mission-1',
    projectId: 'project-1',
    workspaceId: 'ws-1',
    allowParallelObjectives: false,
    executionRequests: [],
    objectives
  } as unknown as MissionDetailDto;
}

function setup(initial: ObjectiveDto[]) {
  const qc = new QueryClient({
    // gcTime Infinity schedules no garbage-collection timers, so the test process can exit.
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  clients.push(qc);
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={qc}>
      <MissionLatchSessionProvider missionId="mission-1" workspaceId="ws-1" sessions={[]}>
        {node}
      </MissionLatchSessionProvider>
    </QueryClientProvider>
  );
  const panel = (objectives: ObjectiveDto[]) =>
    wrap(
      <MissionObjectivesSection
        mission={mission(objectives)}
        evidence={partitionMissionEvidence({ objectives })}
        evidenceLoading={{ deliveries: false }}
      />
    );
  const utils = render(panel(initial));
  return { ...utils, rerenderPanel: (next: ObjectiveDto[]) => utils.rerender(panel(next)) };
}

/** The queue card that owns a given objective (cards carry `data-objective-ref`). */
function card(displayId: string): HTMLElement {
  const anchor = document.querySelector(`[data-objective-ref="${displayId}"]`);
  assert.ok(anchor, `card ${displayId} is rendered`);
  return anchor as HTMLElement;
}

function bodyLayout(displayId: string): string | null {
  return within(card(displayId)).getByTestId('objective-card-body').getAttribute('data-layout');
}

const descriptionRequests = () => requests.filter(r => r.path.endsWith('/description-requests'));

describe('queue head and compact cards', () => {
  it('shows the head in full: title, summary, provenance, actions and a closed instruction disclosure', () => {
    setup([withSummary('a', { position: 0 }), withSummary('b', { position: 1 })]);
    const head = within(card('coo:1.a'));
    assert.equal(bodyLayout('coo:1.a'), 'full');
    assert.ok(head.getByText('Title a'));
    assert.ok(head.getByText(/Show a short summary on each objective card/));
    assert.ok(head.getByText('AI summary'));
    assert.ok(head.getByRole('button', { name: 'Edit summary' }));
    assert.ok(head.getByRole('button', { name: 'Regenerate summary' }));
    assert.ok(head.getByRole('button', { name: 'Remove summary' }));

    const disclosure = head.getByRole('button', { name: /Instructions/ });
    assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
    const instructions = document.getElementById(disclosure.getAttribute('aria-controls')!)!;
    assert.equal(instructions.hidden, true);
    fireEvent.click(disclosure);
    assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(instructions.hidden, false);
    assert.match(instructions.textContent ?? '', /Implement the description UI/);
    // Rendering never asks for a summary.
    assert.equal(descriptionRequests().length, 0);
  });

  it('keeps decision and caution indicators visible and keyboard-operable on a collapsed compact card', () => {
    setup([withSummary('a', { position: 0 }), withSummary('b', { position: 1 })]);
    const compact = within(card('coo:1.b'));
    assert.equal(bodyLayout('coo:1.b'), 'compact');
    assert.ok(compact.getByText('Title b'));
    // Read preview only: no controls, no instructions.
    assert.equal(compact.queryByRole('button', { name: 'Edit summary' }), null);
    const decision = compact.getByRole('button', {
      name: 'Summary mentions 1 decision. Show the summary'
    });
    assert.ok(
      compact.getByRole('button', { name: 'Summary mentions 1 caution. Show the summary' })
    );
    assert.equal(decision.getAttribute('aria-expanded'), 'false');
    const expand = compact.getByRole('button', { name: 'Expand objective' });
    assert.equal(expand.getAttribute('aria-expanded'), 'false');

    fireEvent.click(decision);
    assert.equal(bodyLayout('coo:1.b'), 'compact-expanded');
    assert.ok(compact.getByRole('button', { name: 'Edit summary' }));
    assert.equal(
      compact.getByRole('button', { name: 'Collapse objective' }).getAttribute('aria-expanded'),
      'true'
    );
  });

  it('shows person-written and short instructions as today, with no summary controls', () => {
    setup([
      objective({ id: 'a', instructionText: 'Fix the typo.', descriptionEligible: false }),
      objective({ id: 'b', position: 1, instructionText: '' })
    ]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText('Fix the typo.'));
    assert.equal(head.queryByText('Title a'), null, 'no summary layout without a summary');
    assert.equal(head.queryByRole('button', { name: 'Summarize instructions' }), null);
    const blank = within(card('coo:1.b'));
    assert.equal(blank.queryByTestId('objective-summary-fallback'), null);
  });

  it('a blank head keeps its placeholder even when an old summary is stored', () => {
    setup([withSummary('a', { instructionText: '' })]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText(/Describe what the agent should do/));
    assert.equal(head.queryByTestId('objective-summary-prose'), null);
  });
});

describe('summary states and actions', () => {
  it('Summarize asks the server, never waits for a model, and leaves the instructions readable', async () => {
    setup([objective({ id: 'a' })]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText(/Implement the description UI/));
    fireEvent.click(head.getByRole('button', { name: 'Summarize instructions' }));
    await waitFor(() => assert.equal(descriptionRequests().length, 1));
    assert.deepEqual(descriptionRequests()[0]!.body, { mode: 'summarize' });
    assert.equal(descriptionRequests()[0]!.path, '/api/objectives/a/description-requests');
  });

  it('pending keeps the instructions with "Writing summary…", and Cancel removes durably', async () => {
    setup([objective({ id: 'a', descriptionStatus: 'pending' })]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText('Writing summary…'));
    assert.ok(head.getByText(/Implement the description UI/));
    fireEvent.click(head.getByRole('button', { name: 'Stop summary' }));
    await waitFor(() => assert.ok(requests.some(r => r.method === 'PATCH')));
    const patch = requests.find(r => r.method === 'PATCH')!;
    assert.equal(patch.path, '/api/objectives/a');
    assert.deepEqual(patch.body, { description: null });
  });

  it('failure shows a stable message and Retry', async () => {
    setup([
      objective({
        id: 'a',
        descriptionStatus: 'failed',
        descriptionFailureCode: 'provider_unavailable'
      })
    ]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText('Summary unavailable: no model provider is configured.'));
    fireEvent.click(head.getByRole('button', { name: 'Retry summary' }));
    await waitFor(() => assert.deepEqual(descriptionRequests()[0]?.body, { mode: 'retry' }));
  });

  it('regeneration keeps the prior summary with stale and pending lines', () => {
    setup([withSummary('a', { descriptionStale: true, descriptionStatus: 'pending' })]);
    const head = within(card('coo:1.a'));
    assert.ok(head.getByText(/Show a short summary/));
    assert.ok(head.getByText('Writing a new summary…'));
    assert.equal(head.queryByRole('button', { name: 'Regenerate summary' }), null);
  });

  it('Remove keeps the summary absent until a person clicks Summarize, whatever arrives later', async () => {
    const { rerenderPanel } = setup([withSummary('a')]);
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: 'Remove summary' }));
    await waitFor(() => assert.ok(requests.some(r => r.method === 'PATCH')));
    assert.deepEqual(requests.find(r => r.method === 'PATCH')!.body, { description: null });

    // Server state after Remove, then after an instruction edit and a catch-up scan:
    // still suppressed, still no summary. The panel shows instructions and Summarize.
    rerenderPanel([objective({ id: 'a', descriptionSuppressed: true, descriptionRevision: 4 })]);
    let head = within(card('coo:1.a'));
    assert.ok(head.getByText('Summary removed'));
    assert.ok(head.getByText(/Implement the description UI/));
    assert.equal(head.queryByTestId('objective-summary-prose'), null);
    rerenderPanel([
      objective({
        id: 'a',
        instructionText: `${LONG_INSTRUCTION} Edited.`,
        descriptionSuppressed: true,
        descriptionRevision: 4
      })
    ]);
    head = within(card('coo:1.a'));
    assert.equal(head.queryByTestId('objective-summary-prose'), null);
    assert.equal(descriptionRequests().length, 0, 'nothing re-enables it automatically');

    fireEvent.click(head.getByRole('button', { name: 'Summarize instructions' }));
    await waitFor(() => assert.deepEqual(descriptionRequests()[0]?.body, { mode: 'summarize' }));
  });

  it('attributes edits accurately: "Edited by you" only to the editor', async () => {
    setup([
      withSummary('a', { descriptionSource: 'user', descriptionAuthorWorkspaceUserId: 'wu-me' }),
      withSummary('b', {
        position: 1,
        descriptionSource: 'user',
        descriptionAuthorWorkspaceUserId: 'wu-ana'
      }),
      withSummary('c', {
        position: 2,
        descriptionSource: 'agent',
        descriptionAuthorAgent: null
      })
    ]);
    await waitFor(() => assert.ok(within(card('coo:1.a')).getByText('Edited by you')));
    fireEvent.click(within(card('coo:1.b')).getByRole('button', { name: 'Expand objective' }));
    await waitFor(() => assert.ok(within(card('coo:1.b')).getByText('Edited by Ana')));
    fireEvent.click(within(card('coo:1.c')).getByRole('button', { name: 'Expand objective' }));
    assert.ok(within(card('coo:1.c')).getByText('Written by agent'));
  });
});

describe('editing through reorder, realtime results and launch', () => {
  it('keeps the summary buffer, the instruction editor and expansion by objective id across a head change', () => {
    const a = withSummary('a', { position: 0 });
    const b = withSummary('b', { position: 1 });
    const c = objective({ id: 'c', position: 2 });
    const { rerenderPanel } = setup([a, b, c]);

    // Open B's summary editor (compact → expand → Edit) and type.
    fireEvent.click(within(card('coo:1.b')).getByRole('button', { name: 'Expand objective' }));
    fireEvent.click(within(card('coo:1.b')).getByRole('button', { name: 'Edit summary' }));
    const summaryEditor = within(card('coo:1.b')).getByRole('textbox', {
      name: 'Objective summary'
    }) as HTMLTextAreaElement;
    fireEvent.change(summaryEditor, { target: { value: 'My unsaved summary.' } });

    // Start an instruction edit on A (the head) and type without committing.
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: /Instructions/ }));
    fireEvent.click(within(card('coo:1.a')).getByTitle('Click to edit'));
    const instructionEditor = within(card('coo:1.a')).getByRole('textbox', {
      name: 'Objective instruction'
    }) as HTMLTextAreaElement;
    fireEvent.focus(instructionEditor);
    fireEvent.change(instructionEditor, { target: { value: 'My unsaved instruction.' } });

    // Expand C.
    fireEvent.click(within(card('coo:1.c')).getByRole('button', { name: 'Expand objective' }));

    // A refetch brings a new order with B at the head (another client reordered).
    rerenderPanel([
      { ...b, position: 0 },
      { ...a, position: 1 },
      { ...c, position: 2 }
    ]);

    assert.equal(bodyLayout('coo:1.b'), 'full');
    assert.equal(
      (
        within(card('coo:1.b')).getByRole('textbox', {
          name: 'Objective summary'
        }) as HTMLTextAreaElement
      ).value,
      'My unsaved summary.'
    );
    // A is compact now but its active editor is never clipped or remounted.
    assert.notEqual(bodyLayout('coo:1.a'), 'compact');
    const stillEditing = within(card('coo:1.a')).getByRole('textbox', {
      name: 'Objective instruction'
    }) as HTMLTextAreaElement;
    assert.equal(stillEditing, instructionEditor, 'same element: no remount');
    assert.equal(stillEditing.value, 'My unsaved instruction.');
    assert.equal(bodyLayout('coo:1.c'), 'compact-expanded');
    assert.equal(descriptionRequests().length, 0, 'reorder never generates');
  });

  it('a summary that arrives mid-edit does not replace the instruction editor', () => {
    const a = objective({ id: 'a', descriptionStatus: 'pending' });
    const { rerenderPanel } = setup([a]);
    fireEvent.click(within(card('coo:1.a')).getByTitle('Click to edit'));
    const editor = within(card('coo:1.a')).getByRole('textbox', {
      name: 'Objective instruction'
    }) as HTMLTextAreaElement;
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: 'Still typing' } });

    rerenderPanel([withSummary('a', { descriptionRevision: 1 })]);

    const after = within(card('coo:1.a')).getByRole('textbox', { name: 'Objective instruction' });
    assert.equal(after, editor);
    assert.equal((after as HTMLTextAreaElement).value, 'Still typing');
    const disclosure = within(card('coo:1.a')).getByRole('button', { name: /Instructions/ });
    assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
    assert.ok(within(card('coo:1.a')).getByTestId('objective-summary-prose'));
  });

  it('keeps an unsaved summary when the card launches and remounts in the launching group', () => {
    const a = withSummary('a');
    const { rerenderPanel } = setup([a]);
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: 'Edit summary' }));
    fireEvent.change(within(card('coo:1.a')).getByRole('textbox', { name: 'Objective summary' }), {
      target: { value: 'Edit across launch.' }
    });
    rerenderPanel([{ ...a, state: 'launching', launchedAt: '2026-11-14T10:05:00.000Z' }]);
    assert.equal(
      (
        within(card('coo:1.a')).getByRole('textbox', {
          name: 'Objective summary'
        }) as HTMLTextAreaElement
      ).value,
      'Edit across launch.'
    );
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
    setup([withSummary('a', { descriptionRevision: 3 })]);
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: 'Edit summary' }));
    const editor = within(card('coo:1.a')).getByRole('textbox', { name: 'Objective summary' });
    fireEvent.change(editor, { target: { value: 'Mine.' } });
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: 'Save summary' }));
    await waitFor(() =>
      assert.ok(within(card('coo:1.a')).getByText(/changed while you were editing/))
    );
    assert.deepEqual(requests.find(r => r.method === 'PATCH')!.body, {
      description: 'Mine.',
      expectedDescriptionRevision: 3
    });
    assert.equal(
      (
        within(card('coo:1.a')).getByRole('textbox', {
          name: 'Objective summary'
        }) as HTMLTextAreaElement
      ).value,
      'Mine.'
    );
  });

  it('Escape cancels the summary edit without a request', () => {
    setup([withSummary('a')]);
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: 'Edit summary' }));
    const editor = within(card('coo:1.a')).getByRole('textbox', { name: 'Objective summary' });
    fireEvent.keyDown(editor, { key: 'Escape' });
    assert.equal(
      within(card('coo:1.a')).queryByRole('textbox', { name: 'Objective summary' }),
      null
    );
    assert.equal(requests.filter(r => r.method === 'PATCH').length, 0);
  });
});

describe('executed rows', () => {
  it('closed rows show the title and a decision badge; the summary appears only when open', async () => {
    const done = withSummary('a', {
      state: 'complete',
      startedAt: '2026-11-14T10:00:00.000Z',
      completedAt: '2026-11-14T11:00:00.000Z'
    });
    setup([done]);
    const row = within(card('coo:1.a'));
    assert.ok(row.getByText('Title a'));
    assert.equal(row.queryByTestId('objective-summary-prose'), null);
    const badge = row.getByRole('button', {
      name: 'Summary mentions 1 decision. Show the summary'
    });
    assert.equal(row.queryByRole('button', { name: /caution/ }), null);
    await act(async () => {
      fireEvent.click(badge);
    });
    await waitFor(() => assert.ok(row.getByTestId('objective-summary-prose')));
    // People can still edit a completed objective's summary; instructions sit behind a disclosure.
    assert.ok(row.getByRole('button', { name: 'Edit summary' }));
    assert.ok(row.getByRole('button', { name: /Instructions/ }));
  });

  it('open rows without a summary show the instructions and no empty SUMMARY section', async () => {
    const done = objective({
      id: 'a',
      state: 'complete',
      startedAt: '2026-11-14T10:00:00.000Z',
      completedAt: '2026-11-14T11:00:00.000Z'
    });
    setup([done]);
    fireEvent.click(within(card('coo:1.a')).getByRole('button', { name: /Title a/ }));
    await waitFor(() =>
      assert.ok(within(card('coo:1.a')).getByText(/Implement the description UI/))
    );
    assert.equal(within(card('coo:1.a')).queryByText('Summary'), null);
    assert.ok(within(card('coo:1.a')).getByRole('button', { name: 'Summarize instructions' }));
  });
});
