import type {
  MissionDetailDto,
  ObjectiveDto,
  ObjectiveRunQueueEntryDto,
  ObjectiveState,
  ProjectResourceDto
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { keys } from '../../lib/query-keys.ts';

import { MissionObjectivesSection } from './MissionObjectivesSection.tsx';
import {
  moveObjectiveIdBy,
  OBJECTIVE_ROW_MOUSE_SENSOR_OPTIONS,
  OBJECTIVE_ROW_TOUCH_SENSOR_OPTIONS,
  restrictToVerticalAxis,
  suppressNextClick
} from './objective-row-dnd.ts';
import { ObjectiveRow, objectiveRowTitle, objectiveShortKey } from './ObjectiveRow.tsx';
import { OBJECTIVE_ROW_LINE_CLOSE_DELAY_MS } from './ObjectiveRowHoverLine.tsx';

/**
 * Mission panel redesign §6.3 / §7: compact objective rows, the unified state-aware menu, the
 * Run Queue control, and the row list's order and reordering. Rendered against a stubbed REST
 * transport so assertions about what is sent are about real requests.
 */

type Recorded = { method: string; path: string; body: unknown };
let requests: Recorded[] = [];
let respond: (req: Recorded) => { status: number; body: unknown } | null = () => null;
let openRequests: Array<Record<string, unknown>> = [];
let clipboardText: string | null = null;

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
  openRequests = [];
  clipboardText = null;
  respond = () => null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        clipboardText = value;
      }
    }
  });
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
    if (method === 'PATCH' && url.pathname.endsWith('/objectives/reorder')) {
      return json(200, { objectives: [] });
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
    instructionText: 'Do the work',
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

function queueEntry(overrides: Partial<ObjectiveRunQueueEntryDto> = {}): ObjectiveRunQueueEntryDto {
  return {
    id: 'entry-1',
    queueId: 'queue-1',
    queueName: 'Mission queue',
    position: 1,
    state: 'waiting',
    blockedReason: null,
    waitingReason: null,
    waitingOnObjectiveId: null,
    waitingOnObjectiveDisplayId: null,
    attemptCount: 0,
    precededBy: null,
    ...overrides
  };
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

function client() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  clients.push(qc);
  return qc;
}

function wrap(qc: QueryClient, node: ReactNode) {
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

type Opened = { id: string };

function renderRow(o: ObjectiveDto, extra: { blocked?: boolean } = {}) {
  const opened: Opened[] = [];
  const utils = render(
    wrap(
      client(),
      <ul>
        <ObjectiveRow
          objective={o}
          blocked={extra.blocked}
          onOpen={objective => opened.push({ id: objective.id })}
        />
      </ul>
    )
  );
  return { ...utils, opened, row: utils.container.querySelector('li') as HTMLElement };
}

function stateIcon(row: HTMLElement): string | null {
  return (
    row.querySelector('[data-objective-state-icon]')?.getAttribute('data-objective-state-icon') ??
    null
  );
}

async function openMenu(row: HTMLElement) {
  const trigger = within(row).getByRole('button', { name: 'Objective options' });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return await waitFor(() => {
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu, 'menu opened');
    return menu as HTMLElement;
  });
}

function menuLabels(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('[role="menuitem"]')].map(
    item => item.textContent?.trim() ?? ''
  );
}

describe('ObjectiveRow', () => {
  it('renders the shared state icon for each state, and blocked only while in flight', () => {
    const cases: Array<[ObjectiveState, boolean, string]> = [
      ['draft', false, 'draft'],
      ['submitted', false, 'submitted'],
      ['launching', false, 'launching'],
      ['executing', false, 'executing'],
      ['pending_delivery', false, 'pending_delivery'],
      ['complete', false, 'complete'],
      ['executing', true, 'blocked'],
      ['pending_delivery', true, 'blocked'],
      // A not-started or complete objective cannot be blocked on a human.
      ['draft', true, 'draft'],
      ['complete', true, 'complete']
    ];
    for (const [state, blocked, expected] of cases) {
      const { row, unmount } = renderRow(objective({ id: `o-${state}`, state }), { blocked });
      assert.equal(stateIcon(row), expected, `${state} blocked=${blocked}`);
      assert.equal(row.getAttribute('data-blocked') === 'true', expected === 'blocked');
      unmount();
    }
  });

  it('names the state icon for assistive technology', () => {
    const { row } = renderRow(objective({ id: 'b', state: 'executing' }), { blocked: true });
    assert.ok(within(row).getByRole('img', { name: 'Waiting on an answer' }));
  });

  it('opens the detail from the row button only', async () => {
    const { row, opened } = renderRow(
      objective({ id: 'r', state: 'draft', queueEntry: queueEntry() })
    );
    const buttons = within(row).getAllByRole('button');
    const rowButton = buttons.find(b => b.getAttribute('title')?.startsWith('Click to open'));
    assert.ok(rowButton);
    assert.equal(rowButton.getAttribute('title'), 'Click to open. Hold and drag to reorder.');
    for (const control of buttons.filter(b => b !== rowButton)) {
      await act(async () => {
        fireEvent.click(control);
      });
    }
    assert.equal(opened.length, 0, 'no control opened the detail');
    fireEvent.click(rowButton);
    assert.deepEqual(opened, [{ id: 'r' }]);
  });

  it('titles a started row "Click to open" without the drag hint', () => {
    const { row } = renderRow(objective({ id: 'c', state: 'complete' }));
    assert.ok(within(row).getByTitle('Click to open'));
  });

  it('shows the queue button always and emerald when queued, amber when the queue blocks it', () => {
    const queued = renderRow(objective({ id: 'q', state: 'executing', queueEntry: queueEntry() }));
    const button = within(queued.row).getByRole('button', { name: /^Queued · / });
    assert.match(button.className, /text-emerald-600/);
    assert.doesNotMatch(button.className, /opacity-0/);
    queued.unmount();

    const blocked = renderRow(
      objective({
        id: 'qb',
        state: 'draft',
        queueEntry: queueEntry({ state: 'blocked', blockedReason: 'dispatch_failed: boom' })
      })
    );
    const amber = within(blocked.row).getByRole('button', { name: /^Queued · / });
    assert.match(amber.className, /text-amber-600/);
  });

  it('keeps a hidden hover/focus add button on unqueued not-started rows only', () => {
    for (const state of ['draft', 'submitted'] as const) {
      const { row, unmount } = renderRow(objective({ id: `h-${state}`, state }));
      const add = within(row).getByRole('button', { name: 'Add to Run Queue' });
      assert.match(add.className, /opacity-0/);
      assert.match(add.className, /group-hover\/row:opacity-100/);
      assert.match(add.className, /group-focus-within\/row:opacity-100/);
      unmount();
    }
    for (const state of ['launching', 'executing', 'pending_delivery', 'complete'] as const) {
      const { row, unmount } = renderRow(objective({ id: `n-${state}`, state }));
      assert.equal(within(row).queryByRole('button', { name: 'Add to Run Queue' }), null, state);
      unmount();
    }
  });

  it('copies the full identifier and reads "Copied" briefly', async () => {
    const { row } = renderRow(objective({ id: 'rjay', state: 'complete' }));
    const idButton = within(row).getByRole('button', { name: 'Copy coo:1.rjay' });
    assert.equal(idButton.textContent, 'rjay');
    await act(async () => {
      fireEvent.click(idButton);
    });
    assert.equal(clipboardText, 'coo:1.rjay');
    assert.equal(idButton.textContent, 'Copied');
  });

  it('makes the agent icon a button only when not started', () => {
    const draft = renderRow(objective({ id: 'a1', state: 'draft', assignedAgent: 'claude' }));
    assert.ok(within(draft.row).getByRole('button', { name: /^Change agent, currently / }));
    draft.unmount();
    for (const state of ['launching', 'executing', 'complete'] as const) {
      const { row, unmount } = renderRow(
        objective({ id: `a-${state}`, state, assignedAgent: 'claude' })
      );
      assert.equal(within(row).queryByRole('button', { name: /^Change agent/ }), null, state);
      assert.ok(within(row).getByRole('img', { name: /claude/i }), state);
      unmount();
    }
  });

  it('falls back to the first instruction line, then "Untitled objective"', () => {
    assert.equal(
      objectiveRowTitle({ title: null, instructionText: '\n  First line\nSecond' }),
      'First line'
    );
    assert.equal(objectiveRowTitle({ title: '  ', instructionText: '' }), 'Untitled objective');
    assert.equal(objectiveRowTitle({ title: 'Named', instructionText: 'x' }), 'Named');
    assert.equal(objectiveShortKey('coo:1107.v8qc'), 'v8qc');
  });

  it('shows the menu items each state allows', async () => {
    const executing = renderRow(
      objective({
        id: 'm1',
        state: 'executing',
        assignedAgent: 'claude',
        externalSessionId: 'sess-1'
      })
    );
    const menu = await openMenu(executing.row);
    const labels = menuLabels(menu);
    assert.ok(labels.includes('Copy coo:1.m1'));
    assert.ok(labels.includes('Copy session ID'));
    assert.ok(labels.includes('Add to queue…'));
    assert.ok(labels.includes('Mark complete'));
    assert.ok(labels.includes('Mark draft'));
    assert.ok(labels.includes('Force disconnect'));
    assert.ok(labels.includes('Delete'));
    assert.ok(!labels.includes('Move up'));
    executing.unmount();
    cleanup();

    const complete = renderRow(objective({ id: 'm2', state: 'complete', queueEntry: null }));
    const completeLabels = menuLabels(await openMenu(complete.row));
    assert.ok(!completeLabels.includes('Mark complete'));
    assert.ok(!completeLabels.includes('Add to queue…'));
    assert.ok(!completeLabels.includes('Force disconnect'));
    assert.ok(completeLabels.includes('Mark draft'));
    complete.unmount();
    cleanup();

    const queued = renderRow(objective({ id: 'm3', state: 'draft', queueEntry: queueEntry() }));
    const queuedLabels = menuLabels(await openMenu(queued.row));
    assert.ok(!queuedLabels.includes('Add to queue…'));
    assert.ok(!queuedLabels.includes('Mark draft'));
    assert.ok(queuedLabels.includes('Mark complete'));
  });
});

describe('MissionObjectivesSection', () => {
  function renderSection(objectives: ObjectiveDto[]) {
    const qc = client();
    const opened: string[] = [];
    const orders: string[][] = [];
    const ui = (next: ObjectiveDto[]) =>
      wrap(
        qc,
        <MissionObjectivesSection
          mission={mission(next)}
          onOpenObjective={o => opened.push(o.id)}
          onRowOrderChange={order => orders.push(order)}
        />
      );
    const utils = render(ui(objectives));
    return {
      ...utils,
      opened,
      orders,
      rerenderSection: (next: ObjectiveDto[]) => utils.rerender(ui(next))
    };
  }

  function rowIds(container: HTMLElement): string[] {
    return [...container.querySelectorAll('li[data-objective-id]')].map(
      li => li.getAttribute('data-objective-id') ?? ''
    );
  }

  const MIXED = [
    objective({ id: 'd2', state: 'draft', position: 5 }),
    objective({
      id: 'c1',
      state: 'complete',
      startedAt: '2026-11-14T10:00:00.000Z',
      completedAt: '2026-11-14T11:00:00.000Z',
      position: 0
    }),
    objective({
      id: 'l1',
      state: 'launching',
      launchedAt: '2026-11-14T12:00:00.000Z',
      position: 2
    }),
    objective({ id: 'e1', state: 'executing', startedAt: '2026-11-14T11:30:00.000Z', position: 1 }),
    objective({ id: 'd1', state: 'submitted', position: 4 })
  ];

  it('orders executed, then launching, then not started; only not-started rows are sortable', async () => {
    const { container, orders } = renderSection(MIXED);
    assert.deepEqual(rowIds(container), ['c1', 'e1', 'l1', 'd1', 'd2']);
    const started = container.querySelector('ol[aria-label="Started objectives"]') as HTMLElement;
    const notStarted = container.querySelector(
      'ol[aria-label="Objectives not started"]'
    ) as HTMLElement;
    assert.deepEqual(rowIds(started), ['c1', 'e1', 'l1']);
    assert.deepEqual(rowIds(notStarted), ['d1', 'd2']);
    await waitFor(() => assert.deepEqual(orders.at(-1), ['c1', 'e1', 'l1', 'd1', 'd2']));
  });

  it('hides the committing objective from every group', () => {
    const qc = client();
    const { container } = render(
      wrap(
        qc,
        <MissionObjectivesSection
          mission={mission(MIXED)}
          committingObjectiveId="d2"
          onOpenObjective={() => {}}
        />
      )
    );
    assert.deepEqual(rowIds(container), ['c1', 'e1', 'l1', 'd1']);
  });

  it('shows "No objectives yet" with no objectives', () => {
    const { container } = renderSection([]);
    assert.match(container.textContent ?? '', /No objectives yet/);
  });

  it('Move down sends the complete not-started set', async () => {
    const objectives = [
      objective({ id: 'a', state: 'draft', position: 0 }),
      objective({ id: 'b', state: 'submitted', position: 1 }),
      objective({ id: 'c', state: 'draft', position: 2 }),
      objective({
        id: 'x',
        state: 'complete',
        completedAt: '2026-11-14T11:00:00.000Z',
        startedAt: '2026-11-14T10:00:00.000Z',
        position: 3
      })
    ];
    const { container } = renderSection(objectives);
    const rowA = container.querySelector('li[data-objective-id="a"]') as HTMLElement;
    const menu = await openMenu(rowA);
    const labels = menuLabels(menu);
    assert.ok(!labels.includes('Move up'), 'first row has no Move up');
    const moveDown = [...menu.querySelectorAll('[role="menuitem"]')].find(
      item => item.textContent?.trim() === 'Move down'
    ) as HTMLElement;
    await act(async () => {
      fireEvent.click(moveDown);
    });
    await waitFor(() => {
      const reorder = requests.find(
        r => r.method === 'PATCH' && r.path.endsWith('/objectives/reorder')
      );
      assert.ok(reorder, 'reorder sent');
      assert.deepEqual((reorder.body as { orderedObjectiveIds: string[] }).orderedObjectiveIds, [
        'b',
        'a',
        'c'
      ]);
    });
  });

  it('rolls a rejected reorder back', async () => {
    respond = req =>
      req.method === 'PATCH' && req.path.endsWith('/objectives/reorder')
        ? { status: 409, body: { error: 'stale_objective_set', message: 'stale' } }
        : null;
    const objectives = [
      objective({ id: 'a', state: 'draft', position: 0 }),
      objective({ id: 'b', state: 'draft', position: 1 })
    ];
    const { container } = renderSection(objectives);
    const rowB = container.querySelector('li[data-objective-id="b"]') as HTMLElement;
    const menu = await openMenu(rowB);
    const moveUp = [...menu.querySelectorAll('[role="menuitem"]')].find(
      item => item.textContent?.trim() === 'Move up'
    ) as HTMLElement;
    await act(async () => {
      fireEvent.click(moveUp);
    });
    await waitFor(() =>
      assert.ok(requests.some(r => r.method === 'PATCH' && r.path.endsWith('/objectives/reorder')))
    );
    await waitFor(() => assert.deepEqual(rowIds(container), ['a', 'b']));
  });

  it('tints an in-flight row blocked from the shared open-request collection', async () => {
    openRequests = [
      {
        id: 'req-1',
        kind: 'question',
        status: 'open',
        objectiveId: 'e1',
        missionId: 'mission-1',
        createdAt: '2026-11-14T12:00:00.000Z'
      }
    ];
    const { container } = renderSection(MIXED);
    await waitFor(() => {
      const row = container.querySelector('li[data-objective-id="e1"]') as HTMLElement;
      assert.equal(row.getAttribute('data-blocked'), 'true');
      assert.match(row.className, /bg-yellow-300\/60/);
    });
    assert.equal(
      container.querySelector('li[data-objective-id="d1"]')?.getAttribute('data-blocked'),
      null
    );
  });

  it('opens the detail when a row is clicked', () => {
    const { container, opened } = renderSection(MIXED);
    const row = container.querySelector('li[data-objective-id="e1"]') as HTMLElement;
    fireEvent.click(within(row).getByTitle('Click to open'));
    assert.deepEqual(opened, ['e1']);
  });
});

describe('objective row drag helpers', () => {
  it('requires a hold before a drag starts', () => {
    assert.deepEqual(OBJECTIVE_ROW_MOUSE_SENSOR_OPTIONS.activationConstraint, {
      delay: 250,
      tolerance: 6
    });
    assert.deepEqual(OBJECTIVE_ROW_TOUCH_SENSOR_OPTIONS.activationConstraint, {
      delay: 250,
      tolerance: 8
    });
  });

  it('moves an id one place and refuses to move past either end', () => {
    assert.deepEqual(moveObjectiveIdBy(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
    assert.deepEqual(moveObjectiveIdBy(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
    assert.equal(moveObjectiveIdBy(['a', 'b'], 'a', -1), null);
    assert.equal(moveObjectiveIdBy(['a', 'b'], 'b', 1), null);
    assert.equal(moveObjectiveIdBy(['a'], 'z', 1), null);
  });

  it('locks movement to the vertical axis', () => {
    const transform = { x: 40, y: 12, scaleX: 1, scaleY: 1 };
    assert.deepEqual(
      restrictToVerticalAxis({ transform } as Parameters<typeof restrictToVerticalAxis>[0]),
      { x: 0, y: 12, scaleX: 1, scaleY: 1 }
    );
  });

  it('swallows exactly the click that follows a drop', async () => {
    let clicks = 0;
    const button = document.createElement('button');
    document.body.append(button);
    button.addEventListener('click', () => {
      clicks += 1;
    });
    suppressNextClick();
    button.click();
    assert.equal(clicks, 0, 'the drop click is swallowed');
    await new Promise(resolve => setTimeout(resolve, 5));
    button.click();
    assert.equal(clicks, 1, 'later clicks open normally');
    button.remove();
  });
});

function resource(key: string, isPrimary: boolean): ProjectResourceDto {
  return {
    id: `res-${key}`,
    workspaceId: 'ws-1',
    projectId: 'project-1',
    executionTargetId: null,
    resourceKey: key,
    type: 'local_directory',
    label: key,
    path: `/tmp/${key}`,
    isPrimary,
    accessMode: 'read_write',
    status: 'active',
    observedAt: null,
    observationSource: null,
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    revision: 1,
    sources: []
  } as ProjectResourceDto;
}

function seededClient(resources: ProjectResourceDto[]) {
  const qc = client();
  qc.setQueryData(keys.projectResources('project-1'), resources);
  qc.setQueryData(keys.launchPreference('project-1'), null);
  qc.setQueryData(keys.project('project-1'), { id: 'project-1', workspaceId: 'ws-1' });
  qc.setQueryData(keys.projectExecutionTarget('project-1'), {
    selectedExecutionTargetId: null,
    eligibleTargets: []
  });
  qc.setQueryData(keys.agentCatalog('ws-1'), {
    agents: [
      {
        key: 'claude',
        label: 'Claude',
        availableByDefault: true,
        models: [{ id: 'opus', displayName: 'Opus' }],
        defaultModel: 'opus',
        defaultReasoningEffort: null,
        reasoningLabel: 'Thinking'
      }
    ],
    defaultAgent: 'claude',
    defaultModel: 'opus'
  });
  return qc;
}

describe('ObjectiveRow menu Run and Resource (coo:1289)', () => {
  function renderSeeded(
    o: ObjectiveDto,
    options: { resources?: ProjectResourceDto[]; siblings?: ObjectiveDto[] } = {}
  ) {
    const qc = seededClient(
      options.resources ?? [resource('primary', true), resource('docs', false)]
    );
    const utils = render(
      wrap(
        qc,
        <ul>
          <ObjectiveRow
            objective={o}
            mission={mission([o, ...(options.siblings ?? [])])}
            onOpen={() => {}}
          />
        </ul>
      )
    );
    return { ...utils, row: utils.container.querySelector('li') as HTMLElement };
  }

  function item(menu: HTMLElement, label: string): HTMLElement {
    const found = [...menu.querySelectorAll('[role="menuitem"]')].find(el =>
      el.textContent?.trim().startsWith(label)
    );
    assert.ok(found, `menu item ${label}`);
    return found as HTMLElement;
  }

  it('offers Run and Resource on not-started rows only', async () => {
    const draft = renderSeeded(objective({ id: 'r1', assignedAgent: 'claude', model: 'opus' }));
    const labels = menuLabels(await openMenu(draft.row));
    assert.equal(labels[0], 'Run');
    assert.ok(labels.some(label => label.startsWith('Resource')));
    draft.unmount();
    cleanup();

    const executing = renderSeeded(objective({ id: 'r2', state: 'executing' }));
    const executingLabels = menuLabels(await openMenu(executing.row));
    assert.ok(!executingLabels.includes('Run'));
    assert.ok(!executingLabels.some(label => label.startsWith('Resource')));
  });

  it('hides Resource when the project has a single resource', async () => {
    const { row } = renderSeeded(objective({ id: 'r3', assignedAgent: 'claude' }), {
      resources: [resource('primary', true)]
    });
    const labels = menuLabels(await openMenu(row));
    assert.ok(labels.includes('Run'));
    assert.ok(!labels.some(label => label.startsWith('Resource')));
  });

  it('Run launches with the row selection', async () => {
    respond = req =>
      req.method === 'POST' && req.path === '/api/objectives/r4/launch'
        ? { status: 200, body: { id: 'req-1', objectiveId: 'r4', status: 'queued' } }
        : null;
    const { row } = renderSeeded(objective({ id: 'r4', assignedAgent: 'claude', model: 'opus' }));
    const menu = await openMenu(row);
    await act(async () => {
      fireEvent.click(item(menu, 'Run'));
    });
    await waitFor(() => {
      const launch = requests.find(r => r.path === '/api/objectives/r4/launch');
      assert.ok(launch, 'launch sent');
      assert.deepEqual(launch.body, { agent: 'claude', model: 'opus', reasoningEffort: null });
    });
  });

  it('Run queues behind an active sibling instead of launching', async () => {
    respond = req =>
      req.method === 'POST' && req.path === '/api/projects/project-1/run-queues/entries'
        ? { status: 200, body: { id: 'entry-1' } }
        : null;
    const { row } = renderSeeded(objective({ id: 'r5', assignedAgent: 'claude' }), {
      siblings: [objective({ id: 'busy', state: 'executing' })]
    });
    const menu = await openMenu(row);
    await act(async () => {
      fireEvent.click(item(menu, 'Run after current work'));
    });
    await waitFor(() => {
      const enqueue = requests.find(r => r.path === '/api/projects/project-1/run-queues/entries');
      assert.ok(enqueue, 'enqueue sent');
      assert.deepEqual(enqueue.body, { objectiveId: 'r5' });
    });
    assert.ok(!requests.some(r => r.path.endsWith('/launch')));
  });

  it('disables Run with a reason when there is no instruction', async () => {
    const { row } = renderSeeded(
      objective({ id: 'r6', assignedAgent: 'claude', instructionText: '  ' })
    );
    const run = item(await openMenu(row), 'Run');
    assert.ok(run.hasAttribute('data-disabled'));
    assert.match(run.textContent ?? '', /Write an instruction/);
  });

  it('Resource stores the chosen resource key', async () => {
    respond = req =>
      req.method === 'PATCH' && req.path === '/api/objectives/r7'
        ? { status: 200, body: objective({ id: 'r7', resourceKey: 'docs' }) }
        : null;
    const { row } = renderSeeded(objective({ id: 'r7', assignedAgent: 'claude' }));
    const menu = await openMenu(row);
    const trigger = item(menu, 'Resource');
    assert.match(trigger.textContent ?? '', /primary/);
    await act(async () => {
      fireEvent.click(trigger);
    });
    const docs = await waitFor(() => {
      const option = [...document.querySelectorAll('[role="menuitemradio"]')].find(
        el => el.textContent?.trim() === 'docs'
      );
      assert.ok(option, 'docs option');
      return option as HTMLElement;
    });
    await act(async () => {
      fireEvent.click(docs);
    });
    await waitFor(() => {
      const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/objectives/r7');
      assert.ok(patch, 'patch sent');
      assert.deepEqual(patch.body, { resourceKey: 'docs' });
    });
  });
});

describe('ObjectiveRow hover line (coo:1289.94nr)', () => {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  /** Longer than the line's close delay. */
  const AFTER_CLOSE_MS = OBJECTIVE_ROW_LINE_CLOSE_DELAY_MS + 60;
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function renderLineRow(
    o: ObjectiveDto,
    options: {
      resources?: ProjectResourceDto[];
      siblings?: ObjectiveDto[];
      listDragging?: boolean;
    } = {}
  ) {
    const qc = seededClient(
      options.resources ?? [resource('primary', true), resource('docs', false)]
    );
    const opened: Opened[] = [];
    const listEvents: string[] = [];
    const utils = render(
      wrap(
        qc,
        <ul
          onClick={() => listEvents.push('click')}
          onPointerDown={() => listEvents.push('pointerdown')}
        >
          <ObjectiveRow
            objective={o}
            mission={mission([o, ...(options.siblings ?? [])])}
            listDragging={options.listDragging}
            onOpen={objective => opened.push({ id: objective.id })}
          />
        </ul>
      )
    );
    return {
      ...utils,
      opened,
      listEvents,
      row: utils.container.querySelector('li') as HTMLElement
    };
  }

  function lineOf(row: HTMLElement): HTMLElement | null {
    return row.querySelector('[data-objective-row-line]');
  }

  /** The first row's trailing controls (everything after the row button). */
  function firstRowControls(row: HTMLElement): HTMLElement {
    return row.querySelector(':scope > button + div') as HTMLElement;
  }

  async function hover(row: HTMLElement) {
    await act(async () => {
      fireEvent.pointerEnter(row, { pointerType: 'mouse' });
    });
    return waitFor(() => {
      const line = lineOf(row);
      assert.equal(line?.getAttribute('data-objective-row-line'), 'open', 'line open');
      return line as HTMLElement;
    });
  }

  async function leave(row: HTMLElement) {
    await act(async () => {
      fireEvent.pointerLeave(row, { pointerType: 'mouse' });
    });
    // The close timer starts in an effect that act flushes on exit; wait it out afterwards.
    await act(async () => {
      await sleep(AFTER_CLOSE_MS);
    });
  }

  function isOpen(row: HTMLElement) {
    return lineOf(row)?.getAttribute('data-objective-row-line') === 'open';
  }

  function lineButton(line: HTMLElement, text: string): HTMLElement {
    const found = [...line.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
    assert.ok(found, `line button ${text}`);
    return found as HTMLElement;
  }

  it('opens on hover and keyboard focus for draft and submitted rows only', async () => {
    for (const state of ['draft', 'submitted'] as const) {
      const { row, unmount } = renderLineRow(objective({ id: `h-${state}`, state }));
      assert.equal(lineOf(row), null, 'controls are not mounted before the first open');
      await hover(row);
      unmount();
      cleanup();
    }

    const focused = renderLineRow(objective({ id: 'h-focus' }));
    await act(async () => {
      (focused.row.querySelector('button') as HTMLButtonElement).focus();
    });
    await waitFor(() => assert.ok(isOpen(focused.row), 'keyboard focus opens the line'));
    focused.unmount();
    cleanup();

    for (const state of ['launching', 'executing', 'complete'] as const) {
      const { row, unmount } = renderLineRow(objective({ id: `h-${state}`, state }));
      await act(async () => {
        fireEvent.pointerEnter(row, { pointerType: 'mouse' });
        await sleep(30);
      });
      assert.equal(lineOf(row), null, `${state} rows have no line`);
      unmount();
      cleanup();
    }
  });

  it('keeps the queue and identifier on the first row and hides the agent icon in place', async () => {
    const { row } = renderLineRow(objective({ id: 'mv', assignedAgent: 'claude', model: 'opus' }));
    const controls = firstRowControls(row);
    const idButton = controls.querySelector('[aria-label="Copy coo:1.mv"]');
    const queueButton = controls.querySelector('[aria-label="Add to Run Queue"]');
    assert.ok(idButton, 'id on the first row');
    assert.ok(queueButton, 'queue trigger on the first row');
    assert.ok(controls.querySelector('[aria-label^="Change agent"]'), 'agent icon on first row');
    assert.equal(controls.querySelector('[data-agent-icon-hidden]'), null, 'agent icon shown');

    const line = await hover(row);
    assert.equal(row.querySelectorAll('[aria-label="Copy coo:1.mv"]').length, 1, 'one id button');
    assert.equal(controls.querySelector('[aria-label="Copy coo:1.mv"]'), idButton, 'id stays');
    assert.equal(controls.querySelector('[aria-label="Add to Run Queue"]'), queueButton);
    assert.equal(line.querySelector('[aria-label="Copy coo:1.mv"]'), null, 'no id in the line');
    assert.equal(line.querySelector('[aria-label="Add to Run Queue"]'), null, 'no queue in line');
    assert.doesNotMatch((queueButton as HTMLElement).className, /opacity-0/, 'queue visible');
    // The agent icon keeps its slot (so nothing beside it shifts) but is invisible.
    const hiddenIcon = controls.querySelector('[data-agent-icon-hidden="true"]');
    assert.ok(hiddenIcon, 'agent icon slot kept');
    assert.match(hiddenIcon.className, /\binvisible\b/);

    await leave(row);
    assert.ok(!isOpen(row), 'line closes after leaving');
    assert.ok(lineOf(row)?.hasAttribute('inert'), 'closed line is inert');
    assert.equal(controls.querySelector('[data-agent-icon-hidden]'), null, 'agent icon back');
  });

  it('stays open while the resource picker is open and closes after it', async () => {
    const { row } = renderLineRow(objective({ id: 'hold', assignedAgent: 'claude' }));
    const line = await hover(row);
    await act(async () => {
      fireEvent.click(line.querySelector('[aria-label="Choose resource: primary"]') as HTMLElement);
    });
    await waitFor(() => assert.ok(document.querySelector('[role="menu"]'), 'picker open'));
    await leave(row);
    assert.ok(isOpen(row), 'held open by the picker');

    await act(async () => {
      fireEvent.keyDown(document.querySelector('[role="menu"]') as HTMLElement, { key: 'Escape' });
    });
    await waitFor(() => assert.equal(document.querySelector('[role="menu"]'), null));
    await act(async () => {
      await sleep(AFTER_CLOSE_MS);
    });
    // Escape is a keyboard close: focus returns to the trigger and keyboard focus holds the line.
    assert.ok(isOpen(row), 'keyboard focus on the trigger keeps it open');
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await act(async () => {
      await sleep(AFTER_CLOSE_MS);
    });
    assert.ok(!isOpen(row), 'closes once the picker is closed and focus has left');
  });

  it('never opens on devices without hover or while a row is dragged', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(hover: none)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    })) as unknown as typeof window.matchMedia;
    const touch = renderLineRow(objective({ id: 'touch' }));
    await act(async () => {
      fireEvent.pointerEnter(touch.row, { pointerType: 'mouse' });
      await sleep(30);
    });
    assert.equal(lineOf(touch.row), null, 'no line under (hover: none)');
    touch.unmount();
    cleanup();
    window.matchMedia = originalMatchMedia;

    const dragging = renderLineRow(objective({ id: 'drag' }), { listDragging: true });
    await act(async () => {
      fireEvent.pointerEnter(dragging.row, { pointerType: 'mouse' });
      await sleep(30);
    });
    assert.equal(lineOf(dragging.row), null, 'no line while dragging');
  });

  it('Run launches with the selection the agent chooser shows', async () => {
    respond = req =>
      req.method === 'POST' && req.path === '/api/objectives/run1/launch'
        ? { status: 200, body: { id: 'req-1', objectiveId: 'run1', status: 'queued' } }
        : null;
    const { row, opened } = renderLineRow(
      objective({ id: 'run1', assignedAgent: 'claude', model: 'opus' })
    );
    const line = await hover(row);
    const label = line.querySelector('[data-agent-label]');
    assert.equal(label?.textContent, 'Claude · Opus', 'full agent label');
    await act(async () => {
      fireEvent.click(lineButton(line, 'Run'));
    });
    await waitFor(() => {
      const launch = requests.find(r => r.path === '/api/objectives/run1/launch');
      assert.ok(launch, 'launch sent');
      assert.deepEqual(launch.body, { agent: 'claude', model: 'opus', reasoningEffort: null });
    });
    assert.deepEqual(opened, [], 'Run does not open the detail');
  });

  it('Run with an active sibling asks first instead of queueing silently', async () => {
    const { row } = renderLineRow(objective({ id: 'sib', assignedAgent: 'claude' }), {
      siblings: [objective({ id: 'busy', state: 'executing' })]
    });
    const line = await hover(row);
    await act(async () => {
      fireEvent.click(lineButton(line, 'Run'));
    });
    await waitFor(() =>
      assert.match(document.body.textContent ?? '', /An agent appears to be working/)
    );
    assert.ok(!requests.some(r => r.path.endsWith('/run-queues/entries')), 'nothing enqueued');
    assert.ok(!requests.some(r => r.path.endsWith('/launch')), 'nothing launched');
    await leave(row);
    assert.ok(isOpen(row), 'held open by the confirmation');
  });

  it('shows a launch failure in the row error slot and stays open', async () => {
    respond = req =>
      req.method === 'POST' && req.path === '/api/objectives/fail/launch'
        ? { status: 500, body: { error: 'Runner offline' } }
        : null;
    const { row } = renderLineRow(objective({ id: 'fail', assignedAgent: 'claude' }));
    const line = await hover(row);
    await act(async () => {
      fireEvent.click(lineButton(line, 'Run'));
    });
    await waitFor(() => assert.ok(row.querySelector('[role="alert"]'), 'row error shown'));
    await leave(row);
    assert.ok(isOpen(row), 'a failed launch keeps the line open');
  });

  it('Resource change sends the PATCH', async () => {
    respond = req =>
      req.method === 'PATCH' && req.path === '/api/objectives/res'
        ? { status: 200, body: objective({ id: 'res', resourceKey: 'docs' }) }
        : null;
    const { row } = renderLineRow(objective({ id: 'res', assignedAgent: 'claude' }));
    const line = await hover(row);
    await act(async () => {
      fireEvent.click(line.querySelector('[aria-label="Choose resource: primary"]') as HTMLElement);
    });
    const docs = await waitFor(() => {
      const option = [...document.querySelectorAll('[role="menuitem"]')].find(
        el => el.textContent?.trim() === 'docs'
      );
      assert.ok(option, 'docs option');
      return option as HTMLElement;
    });
    await act(async () => {
      fireEvent.click(docs);
    });
    await waitFor(() => {
      const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/objectives/res');
      assert.ok(patch, 'patch sent');
      assert.deepEqual(patch.body, { resourceKey: 'docs' });
    });
  });

  it('line controls do not open the detail or reach the list', async () => {
    const { row, opened, listEvents } = renderLineRow(objective({ id: 'iso' }));
    const line = await hover(row);
    listEvents.length = 0;
    for (const control of [
      line.querySelector('[aria-label="Choose resource: primary"]') as HTMLElement,
      line.querySelector('[aria-label^="Choose agent and model"]') as HTMLElement,
      line
    ]) {
      await act(async () => {
        fireEvent.pointerDown(control);
        fireEvent.click(control);
      });
    }
    assert.deepEqual(opened, []);
    assert.deepEqual(listEvents, [], 'pointerdown and click stop at the line');
  });

  it('shows the full agent label and collapses it below a 480px panel', async () => {
    const { row } = renderLineRow(objective({ id: 'lbl', assignedAgent: 'claude', model: 'opus' }));
    const line = await hover(row);
    const label = line.querySelector('[data-agent-label]') as HTMLElement;
    assert.equal(label.textContent, 'Claude · Opus');
    assert.ok(!label.className.includes('truncate'), 'not truncated');
    assert.ok(!/max-w-/.test(label.className), 'no width cap');
    assert.ok(label.className.includes('@max-[480px]/objective-list:hidden'), 'icon only < 480px');
  });
});
