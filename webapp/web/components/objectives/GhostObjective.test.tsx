import type {
  CreateObjectiveBody,
  MissionDetailDto,
  ObjectiveDto,
  ProjectResourceDto
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { api } from '../../lib/api.ts';
import { partitionMissionEvidence } from '../../lib/objective-evidence.ts';
import { keys } from '../../lib/query-keys.ts';

import { GhostObjective } from './GhostObjective.tsx';
import { MissionObjectivesSection } from './MissionObjectivesSection.tsx';

const PROJECT_ID = 'project-1';
const MISSION_ID = 'mission-1';

type ApiRecord = Record<string, unknown>;
const apiRecord = api as unknown as ApiRecord;
const originalApi: ApiRecord = { ...apiRecord };

let createCalls: CreateObjectiveBody[] = [];
let uploadCalls: Array<{ objectiveId: string; name: string }> = [];
let createImpl: (body: CreateObjectiveBody) => Promise<ObjectiveDto>;
let uploadImpl: (objectiveId: string, file: File) => Promise<unknown>;

function resource(key: string, isPrimary: boolean): ProjectResourceDto {
  return {
    id: `res-${key}`,
    workspaceId: 'ws-1',
    projectId: PROJECT_ID,
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

function objective(overrides: Partial<ObjectiveDto> & { id: string }): ObjectiveDto {
  return {
    missionId: MISSION_ID,
    projectId: PROJECT_ID,
    displayId: `coo:1.${overrides.id}`,
    instructionText: 'Do the thing',
    state: 'draft',
    position: 0,
    assignedAgent: null,
    model: null,
    reasoningEffort: null,
    ...overrides
  } as ObjectiveDto;
}

beforeEach(() => {
  createCalls = [];
  uploadCalls = [];
  createImpl = async body => objective({ id: 'created-1', instructionText: body.instructionText });
  uploadImpl = async () => ({});
  // Every API call the composer's hooks make fails fast (the cache is seeded
  // with what the card reads); the tests replace only the writes they observe.
  for (const name of Object.keys(originalApi)) {
    if (typeof originalApi[name] === 'function') {
      apiRecord[name] = () => Promise.reject(new Error(`api.${name} is not stubbed`));
    }
  }
  apiRecord.createObjective = (body: CreateObjectiveBody) => {
    createCalls.push(body);
    return createImpl(body);
  };
  apiRecord.uploadObjectiveAttachment = (objectiveId: string, file: File) => {
    uploadCalls.push({ objectiveId, name: file.name });
    return uploadImpl(objectiveId, file);
  };
});

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  Object.assign(apiRecord, originalApi);
});

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      // No garbage-collection timers left behind to keep the test process alive.
      mutations: { gcTime: Infinity }
    }
  });
  clients.push(qc);
  qc.setQueryData(keys.projectResources(PROJECT_ID), [
    resource('primary', true),
    resource('docs', false)
  ]);
  qc.setQueryData(keys.launchPreference(PROJECT_ID), null);
  qc.setQueryData(keys.project(PROJECT_ID), { id: PROJECT_ID, workspaceId: 'ws-1' });
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

function renderWithClient(ui: ReactNode, qc = makeClient()) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

function renderGhost(props: Partial<Parameters<typeof GhostObjective>[0]> = {}) {
  const events = { materialized: 0, dismissed: 0, committing: [] as Array<string | null> };
  const result = renderWithClient(
    <div>
      <GhostObjective
        missionId={MISSION_ID}
        projectId={PROJECT_ID}
        onMaterialized={() => (events.materialized += 1)}
        onDismissEmpty={() => (events.dismissed += 1)}
        onCommittingChange={id => events.committing.push(id)}
        {...props}
      />
      <button type="button">Outside</button>
    </div>
  );
  return { ...result, events };
}

function textarea() {
  return screen.getByLabelText('New objective instruction') as HTMLTextAreaElement;
}

function type(value: string) {
  const input = textarea();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
}

async function pointerDownOutside() {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText('Outside'));
  });
}

/** Lets deferred popup-close bookkeeping and pending promises settle. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

async function chooseResource(label: string) {
  fireEvent.pointerDown(screen.getByLabelText(/Choose resource/));
  fireEvent.click(screen.getByLabelText(/Choose resource/));
  const item = await screen.findByRole('menuitem', { name: new RegExp(label) });
  fireEvent.click(item);
  await settle();
}

async function chooseManualAgent() {
  fireEvent.click(screen.getByTitle('Choose agent and model'));
  const manual = await screen.findByRole('button', { name: /Manual/ });
  fireEvent.click(manual);
  await settle();
  // The chooser stays open for a model choice; close it the keyboard way
  // (happy-dom cannot drive Base UI's outside-click dismissal).
  const before = createCalls.length;
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
  await settle();
  // Only the trigger's own label remains once the popover is gone.
  assert.equal(screen.queryAllByText('Manual').length, 1, 'chooser closed');
  assert.equal(createCalls.length, before, 'closing a popup is not leaving the card');
}

function stageFile(name: string, size = 10) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'.repeat(size)], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

describe('GhostObjective', () => {
  it('does not create while the user clicks the pickers or attachment button after typing', async () => {
    renderGhost();
    type('Write the migration');
    fireEvent.blur(textarea(), { relatedTarget: screen.getByLabelText(/Choose resource/) });
    await chooseResource('docs');
    fireEvent.pointerDown(screen.getByLabelText('Upload objective attachment'));
    fireEvent.click(screen.getByLabelText('Upload objective attachment'));
    await settle();
    assert.equal(createCalls.length, 0);
  });

  it('choosing a resource or an agent with empty text writes nothing', async () => {
    const { events } = renderGhost();
    await chooseResource('docs');
    await chooseManualAgent();
    assert.equal(createCalls.length, 0);
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 0, 'settings alone are not work');
    assert.equal(events.dismissed, 1);
  });

  it('pointerdown outside commits once with the full selection, then uploads and swaps', async () => {
    const { events } = renderGhost();
    type('Write the migration');
    await chooseResource('docs');
    await chooseManualAgent();
    stageFile('notes.txt');
    assert.ok(screen.getByText('notes.txt'), 'staged file shows as a chip');

    await pointerDownOutside();
    await pointerDownOutside();
    await settle();

    assert.equal(createCalls.length, 1);
    assert.deepEqual(createCalls[0], {
      missionId: MISSION_ID,
      instructionText: 'Write the migration',
      state: 'draft',
      resourceKey: 'docs',
      assignedAgent: 'manual',
      model: null,
      reasoningEffort: null
    });
    assert.deepEqual(uploadCalls, [{ objectiveId: 'created-1', name: 'notes.txt' }]);
    assert.deepEqual(events.committing, ['created-1', null]);
    assert.equal(events.materialized, 1);
  });

  it('commits when Tab moves focus to an element outside the card', async () => {
    renderGhost();
    type('Ship it');
    await act(async () => {
      fireEvent.blur(textarea(), { relatedTarget: screen.getByText('Outside') });
    });
    await settle();
    assert.equal(createCalls.length, 1);
  });

  it('ignores a focus loss with no destination (window blur, file dialog)', async () => {
    renderGhost();
    type('Ship it');
    fireEvent.blur(textarea(), { relatedTarget: null });
    await settle();
    assert.equal(createCalls.length, 0);
  });

  it('does not commit while one of its pickers is open', async () => {
    renderGhost();
    type('Ship it');
    fireEvent.click(screen.getByTitle('Choose agent and model'));
    await screen.findByRole('button', { name: /Manual/ });
    await pointerDownOutside();
    fireEvent.blur(textarea(), { relatedTarget: screen.getByText('Outside') });
    await settle();
    assert.equal(createCalls.length, 0);
  });

  it('commits on Cmd/Ctrl+Enter', async () => {
    renderGhost();
    type('Ship it');
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: 'Enter', metaKey: true });
    });
    await settle();
    assert.equal(createCalls.length, 1);
  });

  it('Escape discards the whole buffer and writes nothing', async () => {
    const { events } = renderGhost();
    type('Throw this away');
    await chooseResource('docs');
    stageFile('notes.txt');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await settle();
    assert.equal(textarea().value, '');
    assert.equal(screen.queryAllByText('notes.txt').length, 0);
    assert.equal(events.dismissed, 1);
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 0);
  });

  it('rejects an oversized file when it is added', async () => {
    renderGhost();
    stageFile('huge.bin', 26 * 1024 * 1024);
    await settle();
    assert.ok(screen.getByText(/File too large/));
    assert.equal(screen.queryAllByText('huge.bin').length, 0);
  });

  it('a failed create restores the editable card with its content and the error', async () => {
    createImpl = async () => {
      throw new Error('launchConfigAgent is required');
    };
    const { events } = renderGhost();
    type('Keep me');
    stageFile('notes.txt');
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 1);
    assert.equal(textarea().value, 'Keep me');
    assert.equal(textarea().readOnly, false);
    assert.ok(screen.getByText('notes.txt'));
    assert.ok(screen.getByText('launchConfigAgent is required'));
    assert.equal(events.materialized, 0);
  });

  it('a failed upload keeps the card and retries only the failed file on the same objective', async () => {
    let failNext = true;
    uploadImpl = async () => {
      if (failNext) {
        failNext = false;
        throw new Error('storage offline');
      }
      return {};
    };
    const { events } = renderGhost();
    type('With a file');
    stageFile('notes.txt');
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 1);
    assert.ok(screen.getByText(/storage offline/));
    assert.equal(events.materialized, 0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    });
    await settle();
    assert.equal(createCalls.length, 1, 'retry never creates a second objective');
    assert.deepEqual(
      uploadCalls.map(call => call.objectiveId),
      ['created-1', 'created-1']
    );
    assert.equal(events.materialized, 1);
  });
});

describe('MissionObjectivesSection with a committing composer', () => {
  it('does not render the committing objective while its uploads run', async () => {
    let releaseUpload: () => void = () => undefined;
    uploadImpl = () =>
      new Promise(resolve => {
        releaseUpload = () => resolve({});
      });
    const mission = {
      id: MISSION_ID,
      projectId: PROJECT_ID,
      allowParallelObjectives: false,
      objectives: [],
      executionRequests: []
    } as unknown as MissionDetailDto;
    const evidence = partitionMissionEvidence({ objectives: [] });
    const qc = makeClient();
    const view = (m: MissionDetailDto) => (
      <QueryClientProvider client={qc}>
        <MissionObjectivesSection
          mission={m}
          evidence={evidence}
          evidenceLoading={{ deliveries: false }}
        />
        <button type="button">Outside</button>
      </QueryClientProvider>
    );
    const { rerender } = render(view(mission));

    type('Brand new work');
    stageFile('notes.txt');
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 1);

    // A realtime refetch delivers the new row while the upload is still running.
    rerender(
      view({
        ...mission,
        objectives: [objective({ id: 'created-1', instructionText: 'Brand new work' })]
      })
    );
    await settle();
    assert.equal(screen.getAllByText('Brand new work').length, 1, 'shown once, in the composer');
    assert.ok(screen.getByTestId('ghost-objective'));

    await act(async () => {
      releaseUpload();
    });
    await settle();
    assert.equal(screen.queryAllByTestId('ghost-objective').length, 0, 'swapped exactly once');
  });
});
