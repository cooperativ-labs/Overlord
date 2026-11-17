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
import { type ReactNode, useState } from 'react';

import { api } from '../../lib/api.ts';
import { keys } from '../../lib/query-keys.ts';

import { GhostObjective } from './GhostObjective.tsx';
import { MissionObjectivesSection } from './MissionObjectivesSection.tsx';
import { ObjectiveComposer } from './ObjectiveComposer.tsx';

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

/** The mission panel's wiring: the composer reports the objective it holds to the rows. */
function PanelHarness({ mission }: { mission: MissionDetailDto }) {
  const [heldObjectiveId, setHeldObjectiveId] = useState<string | null>(null);
  return (
    <>
      <MissionObjectivesSection
        mission={mission}
        committingObjectiveId={heldObjectiveId}
        onOpenObjective={() => undefined}
      />
      <ObjectiveComposer mission={mission} onHeldObjectiveChange={setHeldObjectiveId} />
      <button type="button">Outside</button>
    </>
  );
}

const EMPTY_MISSION = {
  id: MISSION_ID,
  projectId: PROJECT_ID,
  workspaceId: 'ws-1',
  allowParallelObjectives: false,
  objectives: [],
  executionRequests: []
} as unknown as MissionDetailDto;

function renderPanel(mission: MissionDetailDto = EMPTY_MISSION) {
  const qc = makeClient();
  const view = (m: MissionDetailDto) => (
    <QueryClientProvider client={qc}>
      <PanelHarness mission={m} />
    </QueryClientProvider>
  );
  const result = render(view(mission));
  return { ...result, rerenderMission: (m: MissionDetailDto) => result.rerender(view(m)) };
}

const createdRow = () => document.querySelector('[data-objective-id="created-1"]');
const savedCard = () => screen.queryByTestId('composer-saved-objective');
const saveButton = () => screen.getByTestId('objective-save-button') as HTMLButtonElement;

describe('GhostObjective Save button', () => {
  it('is disabled while the composer is empty and saves the objective when clicked', async () => {
    const { events } = renderGhost();
    assert.equal(saveButton().disabled, true, 'nothing to save yet');
    assert.equal(screen.queryByText('Run'), null, 'the unsaved composer offers Save, not Run');

    type('Write the migration');
    assert.equal(saveButton().disabled, false);
    await act(async () => {
      fireEvent.pointerDown(saveButton());
      fireEvent.click(saveButton());
    });
    await settle();

    assert.equal(createCalls.length, 1, 'Save creates exactly once');
    assert.equal(createCalls[0]?.instructionText, 'Write the migration');
    assert.equal(events.materialized, 1);
  });
});

describe('ObjectiveComposer', () => {
  it('keeps a saved objective in the composer, hidden from the rows, until it is released', async () => {
    let releaseUpload: () => void = () => undefined;
    uploadImpl = () =>
      new Promise(resolve => {
        releaseUpload = () => resolve({});
      });
    const { rerenderMission } = renderPanel();

    type('Brand new work');
    stageFile('notes.txt');
    await pointerDownOutside();
    await settle();
    assert.equal(createCalls.length, 1);

    // A realtime refetch delivers the new row while the upload is still running.
    const withCreated = {
      ...EMPTY_MISSION,
      objectives: [objective({ id: 'created-1', instructionText: 'Brand new work' })]
    } as MissionDetailDto;
    rerenderMission(withCreated);
    await settle();
    assert.equal(createdRow(), null, 'hidden from the rows while the composer commits it');
    assert.equal(screen.queryByText('No objectives yet'), null);

    await act(async () => {
      releaseUpload();
    });
    await settle();
    assert.ok(savedCard(), 'the saved objective stays in the composer');
    assert.equal(createdRow(), null, 'not added to the list yet');
    assert.equal(
      (screen.getByLabelText('Objective instruction') as HTMLTextAreaElement).value,
      'Brand new work'
    );
    assert.ok(screen.getByText('coo:1.created-1'), 'the saved toolbar shows the objective id');
    assert.ok(screen.getByText('Run'), 'saved text offers Run');
    assert.equal(screen.queryByTestId('objective-save-button'), null);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add objective/ }));
    });
    await settle();
    assert.ok(createdRow(), 'Add objective hands the objective to the rows');
    assert.equal(savedCard(), null);
    assert.equal(textarea().value, '', 'a fresh composer is presented');
  });

  it('shows Save while the saved instruction is edited, and Run again once it is saved', async () => {
    const updateCalls: Array<{ id: string; body: unknown }> = [];
    apiRecord.updateObjective = (id: string, body: unknown) => {
      updateCalls.push({ id, body });
      return Promise.resolve(objective({ id }));
    };
    const { rerenderMission } = renderPanel();
    type('First draft');
    await pointerDownOutside();
    await settle();
    rerenderMission({
      ...EMPTY_MISSION,
      objectives: [objective({ id: 'created-1', instructionText: 'First draft' })]
    } as MissionDetailDto);
    await settle();
    assert.ok(savedCard());

    const instruction = screen.getByLabelText('Objective instruction') as HTMLTextAreaElement;
    fireEvent.focus(instruction);
    fireEvent.change(instruction, { target: { value: 'Second draft' } });
    assert.equal(screen.queryByText('Run'), null, 'unsaved edits replace Run with Save');
    assert.equal(saveButton().disabled, false);

    fireEvent.change(instruction, { target: { value: '   ' } });
    assert.equal(saveButton().disabled, true, 'an emptied instruction is never saved');
    fireEvent.change(instruction, { target: { value: 'Second draft' } });

    await pointerDownOutside();
    await settle();
    assert.deepEqual(updateCalls, [{ id: 'created-1', body: { instructionText: 'Second draft' } }]);
    assert.ok(screen.getByText('Run'), 'saved again: Run is back');
    assert.equal(createdRow(), null, 'leaving the card does not move it into the list');
  });
});
