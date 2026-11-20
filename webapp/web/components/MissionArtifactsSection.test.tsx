import type { ArtifactDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { keys } from '../lib/query-keys.ts';

import { MissionArtifactsSection } from './MissionArtifactsSection.tsx';

if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: window });
}

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];
let requests: Array<{ method: string; url: string; body: unknown }> = [];

function artifact(overrides: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: 'artifact-1',
    workspaceId: 'ws-1',
    projectId: 'project-1',
    missionId: 'mission-1',
    objectiveId: null,
    sessionId: null,
    deliveryId: null,
    type: 'note',
    label: 'Release plan',
    contentText: 'Ship it.',
    contentJson: null,
    externalUrl: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    revision: 1,
    ...overrides
  };
}

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url, body });
    if (method === 'POST') {
      return Response.json(
        artifact({ id: 'artifact-new', label: 'Manual note', contentText: 'Hand written.' })
      );
    }
    if (method === 'DELETE') return Response.json({ ok: true });
    return new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});

function renderSection(seed: ArtifactDto[]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      // A finished mutation's gc timer would otherwise hold the test process open.
      mutations: { gcTime: 0 }
    }
  });
  clients.push(client);
  client.setQueryData(keys.missionArtifacts('mission-1'), seed);
  render(
    <QueryClientProvider client={client}>
      <MissionArtifactsSection missionId="mission-1" />
    </QueryClientProvider>
  );
  return client;
}

describe('MissionArtifactsSection', () => {
  it('adds an artifact from the header plus button', async () => {
    const client = renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add artifact' }));
    fireEvent.change(screen.getByPlaceholderText('What is this artifact?'), {
      target: { value: 'Manual note' }
    });
    fireEvent.change(screen.getByPlaceholderText('Write artifact details in Markdown'), {
      target: { value: 'Hand written.' }
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    const post = requests.find(request => request.method === 'POST');
    assert.ok(post, 'POSTs the new artifact');
    assert.match(post.url, /\/api\/missions\/mission-1\/artifacts$/);
    assert.deepEqual(post.body, {
      type: 'note',
      label: 'Manual note',
      contentText: 'Hand written.',
      externalUrl: null
    });
    const cached = client.getQueryData<ArtifactDto[]>(keys.missionArtifacts('mission-1'));
    assert.deepEqual(
      cached?.map(item => item.id),
      ['artifact-new']
    );
    assert.equal(screen.queryByRole('form', { name: 'New artifact' }), null);
  });

  it('deletes an artifact after confirmation', async () => {
    const client = renderSection([artifact()]);

    fireEvent.click(screen.getByRole('button', { name: /Release plan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete artifact' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    });

    const del = requests.find(request => request.method === 'DELETE');
    assert.ok(del, 'DELETEs the artifact');
    assert.match(del.url, /\/api\/missions\/mission-1\/artifacts\/artifact-1$/);
    assert.deepEqual(client.getQueryData(keys.missionArtifacts('mission-1')), []);
  });
});
