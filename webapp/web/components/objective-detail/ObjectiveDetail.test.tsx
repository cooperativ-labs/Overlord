import type { HumanAgentRequestDto, MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { useState } from 'react';

import { resetDismissedAgentRequestsForTests } from '../../lib/dismissed-agent-requests.ts';
import { useObjectiveDetailNavigation } from '../../lib/hooks/use-objective-detail-navigation.ts';
import {
  objectiveSearchFromLocation,
  parseMissionPanelSearch
} from '../../lib/mission-panel-search.ts';
import { resetObjectiveEditBuffers } from '../../lib/objective-edit-buffers.ts';
import { partitionMissionEvidence } from '../../lib/objective-evidence.ts';

import { ObjectiveBlockingQuestions } from './ObjectiveBlockingQuestions.tsx';
import { ObjectiveDetail } from './ObjectiveDetail.tsx';

/**
 * Mission panel redesign §9: the objective detail against a real memory-history router and a
 * stubbed REST transport, so URL and history assertions are about real navigation and
 * mutation assertions are about real requests.
 */

type Recorded = { method: string; path: string; body: unknown };
let requests: Recorded[] = [];
let respond: (req: Recorded) => { status: number; body: unknown } | null = () => null;
let openRequests: HumanAgentRequestDto[] = [];
let attachments: unknown[] = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// The router reads `self`, which the shared happy-dom setup does not define.
if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: window });
}

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];

beforeEach(() => {
  requests = [];
  openRequests = [];
  attachments = [];
  respond = () => null;
  window.localStorage.clear();
  resetDismissedAgentRequestsForTests();
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
    if (method === 'GET' && url.pathname === '/api/agent-requests') {
      return json(200, {
        requests: openRequests,
        page: { complete: true, nextCursor: null, limit: 200, status: 'open' }
      });
    }
    if (method === 'GET' && url.pathname.endsWith('/attachments')) return json(200, attachments);
    if (method === 'PATCH' && url.pathname.startsWith('/api/objectives/')) {
      return json(200, { ...(body as object) });
    }
    if (method === 'DELETE' && url.pathname.startsWith('/api/objectives/')) {
      return json(200, { ok: true });
    }
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
    summary: null,
    summarySource: null,
    summaryStale: false,
    summaryStatus: null,
    summaryFailureCode: null,
    summarySuppressed: false,
    summaryEligible: true,
    summaryRevision: 0,
    summaryUpdatedAt: null,
    summaryAuthorWorkspaceUserId: null,
    summaryAuthorAgent: null,
    instructionText: `Instructions for ${overrides.id}`,
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

function request(overrides: Partial<HumanAgentRequestDto> & { id: string }): HumanAgentRequestDto {
  return {
    missionId: 'mission-1',
    objectiveId: 'a',
    kind: 'question',
    status: 'open',
    summary: 'Which database should I use?\nMore detail here.',
    createdAt: '2026-11-15T10:00:00.000Z',
    windowExpiresAt: null,
    options: [],
    allowsFreeText: true,
    revision: 1,
    delivery: { mode: 'read_only', reason: 'no_latch_session', state: null, observedAt: null },
    ...overrides
  } as unknown as HumanAgentRequestDto;
}

function missionWith(objectives: ObjectiveDto[]): MissionDetailDto {
  return {
    id: 'mission-1',
    title: 'Mission one',
    projectId: 'project-1',
    workspaceId: 'ws-1',
    allowParallelObjectives: false,
    executionRequests: [],
    terminalSessions: [],
    objectives
  } as unknown as MissionDetailDto;
}

let setObjectivesRef: ((next: ObjectiveDto[]) => void) | null = null;

function Harness({ initial }: { initial: ObjectiveDto[] }) {
  const [objectives, setObjectives] = useState(initial);
  setObjectivesRef = setObjectives;
  const nav = useObjectiveDetailNavigation();
  const mission = missionWith(objectives);
  const evidence = partitionMissionEvidence({
    objectives,
    deliveries: [],
    fileChanges: [],
    terminalSessions: []
  });
  return (
    <div>
      <span data-testid="current-ref">{nav.currentRef ?? ''}</span>
      {objectives.map(o => (
        <button key={o.id} type="button" data-row={o.id} onClick={() => nav.open(o.displayId)}>
          Row {o.id}
        </button>
      ))}
      <ObjectiveDetail
        mission={mission}
        rowOrder={objectives.map(o => o.id)}
        evidence={evidence}
        evidenceLoading={{ deliveries: false }}
        evidenceTruncation={{ deliveries: null, fileChanges: null }}
      />
    </div>
  );
}

async function renderDetail(initial: ObjectiveDto[], initialPath = '/missions/mission-1') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  clients.push(qc);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const missionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/missions/$missionId',
    validateSearch: parseMissionPanelSearch,
    component: () => <Harness initial={initial} />
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>Home</p>
  });
  const history = createMemoryHistory({ initialEntries: ['/', initialPath] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, missionRoute]),
    history
  });
  await act(async () => {
    await router.load();
  });
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return { ...utils, router, history };
}

const searchObjective = (router: Awaited<ReturnType<typeof renderDetail>>['router']) =>
  objectiveSearchFromLocation(router.history.location.search);

async function dialog() {
  return await screen.findByTestId('objective-detail');
}

describe('ObjectiveDetail (plan §9)', () => {
  it('opens from ?objective= by display id or UUID, named by its title', async () => {
    const { unmount } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    const node = await dialog();
    assert.equal(node.getAttribute('role'), 'dialog');
    assert.ok(screen.getByRole('heading', { name: /Title a/ }));
    unmount();
    await renderDetail([objective({ id: 'a' })], '/missions/mission-1?objective=a');
    assert.ok(await dialog());
  });

  it('clears an ?objective= that names no objective of the loaded mission', async () => {
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.zzzz'
    );
    await waitFor(() => assert.equal(searchObjective(router), undefined));
    assert.equal(screen.queryByTestId('objective-detail'), null);
  });

  it('previous/next follow row order, wrap, and replace the detail entry', async () => {
    const { router, history } = await renderDetail(
      [objective({ id: 'a' }), objective({ id: 'b' }), objective({ id: 'c' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    const length = history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Next objective' }));
    await waitFor(() => assert.equal(searchObjective(router), 'coo:1.b'));
    assert.ok(screen.getByText('2 of 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous objective' }));
    await waitFor(() => assert.equal(searchObjective(router), 'coo:1.a'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous objective' }));
    await waitFor(() => assert.equal(searchObjective(router), 'coo:1.c'));
    assert.equal(history.length, length);
  });

  it('closing a locally opened detail returns to the mission entry beneath it', async () => {
    const { router, container } = await renderDetail([objective({ id: 'a' })]);
    await act(async () => {
      fireEvent.click(container.querySelector('[data-row="a"]') as HTMLElement);
    });
    await dialog();
    const index = router.history.location.state.__TSR_index;
    fireEvent.click(screen.getByRole('button', { name: 'Close objective' }));
    await waitFor(() => assert.equal(searchObjective(router), undefined));
    assert.equal(router.history.location.state.__TSR_index, index - 1);
    assert.equal(router.history.location.pathname, '/missions/mission-1');
  });

  it('closing a direct link replaces it with the mission URL and never goes back past it', async () => {
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    const index = router.history.location.state.__TSR_index;
    fireEvent.click(screen.getByRole('button', { name: 'Close objective' }));
    await waitFor(() => assert.equal(searchObjective(router), undefined));
    assert.equal(router.history.location.pathname, '/missions/mission-1');
    assert.equal(router.history.location.state.__TSR_index, index);
  });

  it('Escape in the title editor cancels the edit and leaves the detail open; a second Escape closes', async () => {
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = await screen.findByRole('textbox', { name: 'Objective title' });
    fireEvent.change(input, { target: { value: 'Draft title' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      assert.equal(screen.queryByRole('textbox', { name: 'Objective title' }), null)
    );
    assert.equal(searchObjective(router), 'coo:1.a');
    fireEvent.keyDown(await dialog(), { key: 'Escape' });
    await waitFor(() => assert.equal(searchObjective(router), undefined));
  });

  it('saves the title before closing, and a failed save keeps the detail open with a retry', async () => {
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    respond = req =>
      req.method === 'PATCH' ? { status: 500, body: { error: 'Server unavailable' } } : null;
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = await screen.findByRole('textbox', { name: 'Objective title' });
    fireEvent.change(input, { target: { value: 'A better title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close objective' }));
    await screen.findByText(/Some edits could not be saved/);
    assert.equal(searchObjective(router), 'coo:1.a');
    assert.equal(
      (screen.getByRole('textbox', { name: 'Objective title' }) as HTMLInputElement).value,
      'A better title'
    );
    respond = () => null;
    fireEvent.click(screen.getByRole('button', { name: 'Close objective' }));
    await waitFor(() => assert.equal(searchObjective(router), undefined));
    const patches = requests.filter(r => r.method === 'PATCH');
    assert.deepEqual(patches.at(-1)?.body, { title: 'A better title' });
  });

  it('shows Summary first when there is a summary, and no tab row without one', async () => {
    const withSummary = objective({
      id: 'a',
      summary: 'The goal is a faster build.',
      summarySource: 'generated',
      summaryRevision: 1
    });
    const { unmount } = await renderDetail([withSummary], '/missions/mission-1?objective=coo:1.a');
    await dialog();
    const summaryTab = screen.getByRole('tab', { name: 'Summary' });
    assert.equal(summaryTab.getAttribute('aria-selected'), 'true');
    fireEvent.keyDown(summaryTab, { key: 'ArrowRight' });
    assert.equal(
      screen.getByRole('tab', { name: 'Instructions' }).getAttribute('aria-selected'),
      'true'
    );
    unmount();
    await renderDetail([objective({ id: 'a' })], '/missions/mission-1?objective=coo:1.a');
    await dialog();
    assert.equal(screen.queryByRole('tablist', { name: 'Objective text' }), null);
  });

  it('edits instructions only while not started', async () => {
    const { unmount } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.ok(screen.getByRole('button', { name: 'Edit instructions' }));
    unmount();
    await renderDetail(
      [objective({ id: 'a', state: 'complete', completedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.equal(screen.queryByRole('button', { name: 'Edit instructions' }), null);
  });

  it('emptying a draft with attachments saves instead of deleting', async () => {
    attachments = [
      {
        id: 'att-1',
        filename: 'spec.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        url: '/x'
      }
    ];
    await renderDetail([objective({ id: 'a' })], '/missions/mission-1?objective=coo:1.a');
    await dialog();
    await screen.findByText('spec.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions' }));
    const textarea = await screen.findByRole('textbox', { name: 'Objective instruction' });
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.blur(textarea);
    await waitFor(() => assert.ok(requests.some(r => r.method === 'PATCH')));
    assert.equal(
      requests.some(r => r.method === 'DELETE'),
      false
    );
  });

  it('emptying an unattached draft deletes it and closes only after the delete succeeds', async () => {
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    await waitFor(() => assert.ok(requests.some(r => r.path.endsWith('/attachments'))));
    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions' }));
    const textarea = await screen.findByRole('textbox', { name: 'Objective instruction' });
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.blur(textarea);
    await waitFor(() => assert.ok(requests.some(r => r.method === 'DELETE')));
    await waitFor(() => assert.equal(searchObjective(router), undefined));
    act(() => setObjectivesRef?.([]));
  });

  it('refuses empty-draft deletion when attachment loading failed', async () => {
    respond = req =>
      req.path.endsWith('/attachments')
        ? { status: 500, body: { error: 'Attachments unavailable' } }
        : null;
    const { router } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    await waitFor(() => assert.ok(requests.some(r => r.path.endsWith('/attachments'))));
    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions' }));
    const textarea = await screen.findByRole('textbox', { name: 'Objective instruction' });
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close objective' }));
    await screen.findByText('Still checking attachments and history. Try again in a moment.');
    assert.equal(
      requests.some(r => r.method === 'DELETE'),
      false
    );
    assert.equal(searchObjective(router), 'coo:1.a');
  });

  it('offers the primary action for the state', async () => {
    const { unmount } = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.ok(screen.getByRole('button', { name: /^Run$/ }));
    unmount();
    const second = await renderDetail(
      [objective({ id: 'a', state: 'executing', startedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.ok(screen.getByRole('button', { name: 'Force disconnect' }));
    second.unmount();
    await renderDetail(
      [objective({ id: 'a', state: 'complete', completedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.equal(screen.queryByRole('button', { name: 'Force disconnect' }), null);
    assert.equal(screen.queryByRole('button', { name: /^Run$/ }), null);
  });

  it('shows collapsed draft evidence on started objectives and fetches it only when opened', async () => {
    const draftReads = () => requests.filter(req => req.path.endsWith('/report-drafts'));
    respond = req =>
      req.path === '/api/objectives/a/report-drafts'
        ? { status: 200, body: { objectiveId: 'a', drafts: [] } }
        : null;

    // Not started: no draft section at all.
    const first = await renderDetail(
      [objective({ id: 'a' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.equal(screen.queryByRole('button', { name: 'Draft evidence — not delivered' }), null);
    first.unmount();

    // Executing: collapsed, with no request until the operator opens it.
    const second = await renderDetail(
      [objective({ id: 'a', state: 'executing', startedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    const trigger = screen.getByRole('button', { name: 'Draft evidence — not delivered' });
    assert.equal(draftReads().length, 0);
    fireEvent.click(trigger);
    await screen.findByText('No draft evidence was recorded for this objective.');
    assert.equal(draftReads().length, 1);
    second.unmount();

    // Reverted to draft after running, with no other evidence: abandoned drafts stay reachable
    // instead of a "Nothing has run yet" claim.
    await renderDetail(
      [objective({ id: 'a', state: 'draft', startedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    assert.ok(screen.getByRole('button', { name: 'Draft evidence — not delivered' }));
    assert.equal(screen.queryByText(/Nothing has run yet/), null);
  });

  it('dismissing the top notification removes every highlight of the request', async () => {
    openRequests = [request({ id: 'req-1' })];
    await renderDetail(
      [objective({ id: 'a', state: 'executing', startedAt: '2026-11-15T10:00:00.000Z' })],
      '/missions/mission-1?objective=coo:1.a'
    );
    await dialog();
    const dismiss = await screen.findByRole('button', { name: 'Dismiss this notification' });
    assert.ok(screen.getByText('Blocking questions'));
    fireEvent.click(dismiss);
    await waitFor(() =>
      assert.equal(screen.queryByRole('button', { name: 'Dismiss this notification' }), null)
    );
    assert.equal(screen.queryByRole('button', { name: /Which database should I use\?/ }), null);
    assert.equal(screen.queryByText('Blocking questions'), null);
    assert.equal(screen.queryByText('Waiting on you'), null);
  });
});

describe('ObjectiveBlockingQuestions (plan §9.7)', () => {
  function renderList(requestsList: HumanAgentRequestDto[], dismissed: string[] = []) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(qc);
    return render(
      <QueryClientProvider client={qc}>
        <ObjectiveBlockingQuestions requests={requestsList} dismissedIds={new Set(dismissed)} />
      </QueryClientProvider>
    );
  }

  it('is absent with no open request', () => {
    const { container } = renderList([]);
    assert.equal(container.textContent, '');
  });

  it('renders a disclosure per request whose body is a sibling of the button', () => {
    const { container } = renderList([
      request({ id: 'r1' }),
      request({ id: 'r2', summary: 'Second?' })
    ]);
    const buttons = container.querySelectorAll('button[aria-expanded]');
    assert.equal(buttons.length, 2);
    fireEvent.click(buttons[0] as HTMLElement);
    assert.equal(buttons[0]?.getAttribute('aria-expanded'), 'true');
    const body = document.getElementById(buttons[0]?.getAttribute('aria-controls') ?? '');
    assert.ok(body && !body.hidden);
    assert.equal(buttons[0]?.contains(body), false);
    assert.equal(buttons[0]?.querySelector('textarea, input, form'), null);
  });

  it('starts expanded on the first row when every notification was dismissed', () => {
    const { container } = renderList([request({ id: 'r1' })], ['r1']);
    assert.equal(
      container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'),
      'true'
    );
  });
});
