import type { RunQueueDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { api } from '../../lib/api.ts';

import { RunQueuePanel } from './RunQueuePanel.tsx';

const originalGet = api.getProjectRunQueues;
const originalDelete = api.deleteRunQueue;
const projectId = 'project';
const defaultQueue: RunQueueDto = {
  id: 'legacy',
  projectId,
  name: 'Run Queue',
  isDefault: true,
  missionId: null,
  missionDisplayId: null,
  paused: true,
  position: 1000,
  entries: [],
  running: null
};

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: Infinity },
    mutations: { retry: false, gcTime: Infinity }
  }
});

afterEach(() => {
  cleanup();
  client.clear();
  api.getProjectRunQueues = originalGet;
  api.deleteRunQueue = originalDelete;
});

test('deletes the last legacy default queue and keeps queue creation available', async () => {
  let queues = [defaultQueue];
  api.getProjectRunQueues = async () => ({ projectId, queues });
  api.deleteRunQueue = async (queueId, body) => {
    assert.equal(queueId, defaultQueue.id);
    assert.deepEqual(body, {});
    queues = [];
    return { removed: true, projectId };
  };

  render(
    <QueryClientProvider client={client}>
      <RunQueuePanel projectId={projectId} />
    </QueryClientProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Delete queue Run Queue' }));
  const confirmation = await screen.findByRole('dialog', { name: 'Delete Run Queue?' });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete queue' }));

  assert.ok(await screen.findByText('No Run Queues'));
  fireEvent.click(screen.getByRole('button', { name: 'New queue' }));
  assert.ok(await screen.findByRole('dialog', { name: 'Create Run Queue' }));
});
