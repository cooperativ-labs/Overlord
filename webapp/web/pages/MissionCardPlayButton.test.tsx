import type {
  ExecutionRequestDto,
  LaunchPreferenceDto,
  MissionDetailDto,
  ObjectiveDto
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';

import { api } from '@/lib/api.ts';

import { MissionCardPlayButton } from './MissionCardPlayButton.tsx';

const label = 'Launch next draft objective';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: Infinity },
    mutations: { gcTime: Infinity }
  }
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

function renderPlayButton(hasPendingObjectiveWithInstructions = true, onCardAction = () => {}) {
  render(
    <QueryClientProvider client={client}>
      <div onClick={onCardAction} onKeyDown={onCardAction} onPointerDown={onCardAction}>
        <MissionCardPlayButton mission={{ id: 'mission', hasPendingObjectiveWithInstructions }} />
      </div>
    </QueryClientProvider>
  );
  return screen.getByRole<HTMLButtonElement>('button', { name: label });
}

function objective(id: string, position: number, fields: Partial<ObjectiveDto> = {}): ObjectiveDto {
  return {
    id,
    position,
    state: 'draft',
    instructionText: 'Do the work',
    assignedAgent: 'codex',
    model: 'gpt-6.2-sol',
    reasoningEffort: 'medium',
    ...fields
  } as ObjectiveDto;
}

it('launches the first runnable draft in queue order without invoking the parent card', async () => {
  const readMission = mock.method(
    api,
    'getMission',
    async () =>
      ({
        objectives: [
          objective('later', 5),
          objective('submitted', 0, { state: 'submitted' }),
          objective('next', 3),
          objective('blank', 2, { instructionText: '  ' })
        ]
      }) as MissionDetailDto
  );
  const launch = mock.method(api, 'launchObjective', async () => ({}) as ExecutionRequestDto);
  const cardAction = mock.fn();
  const button = renderPlayButton(true, cardAction);
  assert.equal(readMission.mock.callCount(), 0);

  fireEvent.pointerDown(button);
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(button);

  await waitFor(() => assert.equal(launch.mock.callCount(), 1));
  assert.equal(cardAction.mock.callCount(), 0);
  assert.deepEqual(launch.mock.calls[0]?.arguments, [
    'next',
    { agent: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'medium' }
  ]);
});

it('shows a disabled play button when the mission has no runnable draft', () => {
  const readMission = mock.method(api, 'getMission');
  const button = renderPlayButton(false);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.title, 'No draft objective with instructions.');
  fireEvent.click(button);
  assert.equal(readMission.mock.callCount(), 0);
});

it('uses the project launch preference for a draft without an assigned agent', async () => {
  mock.method(
    api,
    'getMission',
    async () =>
      ({
        projectId: 'project',
        objectives: [objective('next', 0, { assignedAgent: null })]
      }) as MissionDetailDto
  );
  const readPreference = mock.method(
    api,
    'getLaunchPreference',
    async () =>
      ({
        selectedAgent: 'claude',
        selectedModel: 'opus',
        selectedReasoningEffort: 'high'
      }) as LaunchPreferenceDto
  );
  const launch = mock.method(api, 'launchObjective', async () => ({}) as ExecutionRequestDto);
  fireEvent.click(renderPlayButton());

  await waitFor(() => assert.equal(launch.mock.callCount(), 1));
  assert.deepEqual(readPreference.mock.calls[0]?.arguments, ['project']);
  assert.deepEqual(launch.mock.calls[0]?.arguments, [
    'next',
    { agent: 'claude', model: 'opus', reasoningEffort: 'high' }
  ]);
});

it('reports when the queue has changed since the board loaded', async () => {
  mock.method(api, 'getMission', async () => ({ objectives: [] }) as unknown as MissionDetailDto);
  const launch = mock.method(api, 'launchObjective');
  fireEvent.click(renderPlayButton());

  assert.equal(
    (await screen.findByRole('alert')).textContent,
    'No draft objective with instructions.'
  );
  assert.equal(launch.mock.callCount(), 0);
});
