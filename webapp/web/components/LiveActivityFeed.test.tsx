import type { MissionEventDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { keys } from '../lib/query-keys.ts';

import { LiveActivityFeed } from './LiveActivityFeed.tsx';

afterEach(cleanup);

test('a single execute update is readable only after expanding Execution status', () => {
  const missionId = 'mission-1';
  const progress: MissionEventDto = {
    id: 'progress',
    missionId,
    objectiveId: null,
    type: 'update',
    phase: 'execute',
    summary: 'Running validation',
    source: 'agent',
    actorWorkspaceUserId: null,
    actor: null,
    externalUrl: null,
    createdAt: '2026-08-01T00:00:00.000Z'
  };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } }
  });
  client.setQueryData(keys.missionEvents(missionId), [progress]);
  render(
    <QueryClientProvider client={client}>
      <LiveActivityFeed missionId={missionId} />
    </QueryClientProvider>
  );

  const toggle = screen.getByRole('button', { name: /Execution status/ });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByText('Running validation'), null);

  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('Running validation'));

  fireEvent.click(toggle);
  assert.equal(screen.queryByText('Running validation'), null);
});
