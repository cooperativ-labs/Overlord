import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { useQuickTaskBar } from './use-quick-task-bar.ts';

const originalFetch = globalThis.fetch;
let requests: Array<{ url: string; method: string; body: unknown }> = [];
let queryClient: QueryClient | null = null;

// Every read fails (no workspaces, so no projects) and every inbox create is
// rejected, which leaves the hook in its "no project" state with a
// deterministic submit failure.
function stubFetch() {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    });
    return new Response(JSON.stringify({ error: 'Inbox unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
}

function renderQuickTaskBar() {
  // gcTime: Infinity schedules no garbage-collection timers, which would
  // otherwise keep the test process alive after the last test finishes.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  queryClient = client;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useQuickTaskBar(null), { wrapper });
}

function fileList(...names: string[]): FileList {
  return names.map(name => new File(['x'], name)) as unknown as FileList;
}

beforeEach(stubFetch);
afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = null;
  globalThis.fetch = originalFetch;
});

describe('useQuickTaskBar staged files', () => {
  it('adds selected files and removes them by id', async () => {
    const { result } = renderQuickTaskBar();
    await waitFor(() => assert.equal(result.current.isLoadingProjects, false));

    act(() => result.current.handleFilesSelected(fileList('a.txt', 'b.txt')));
    assert.deepEqual(
      result.current.stagedFiles.map(staged => staged.file.name),
      ['a.txt', 'b.txt']
    );

    const [first] = result.current.stagedFiles;
    act(() => result.current.handleRemoveFile(first.id));
    assert.deepEqual(
      result.current.stagedFiles.map(staged => staged.file.name),
      ['b.txt']
    );
  });

  it('ignores an empty or missing selection', async () => {
    const { result } = renderQuickTaskBar();
    await waitFor(() => assert.equal(result.current.isLoadingProjects, false));

    act(() => result.current.handleFilesSelected(null));
    act(() => result.current.handleFilesSelected(fileList()));
    assert.equal(result.current.stagedFiles.length, 0);
  });
});

describe('useQuickTaskBar submit errors', () => {
  it('surfaces a failed inbox capture and keeps the objective text', async () => {
    const { result } = renderQuickTaskBar();
    await waitFor(() => assert.equal(result.current.isLoadingProjects, false));
    assert.equal(result.current.selectedProject, null);

    act(() => result.current.setObjective('  Capture this  '));
    assert.equal(result.current.canSubmit, true);

    await act(() => result.current.handleSubmit());

    assert.equal(result.current.submitError, 'Inbox unavailable');
    assert.equal(result.current.isSubmitting, false);
    assert.equal(result.current.objective, '  Capture this  ');
    const inboxPost = requests.find(request => request.method === 'POST');
    assert.deepEqual(inboxPost?.body, { title: 'Capture this', objectives: ['Capture this'] });
  });

  it('refuses to launch without a project', async () => {
    const { result } = renderQuickTaskBar();
    await waitFor(() => assert.equal(result.current.isLoadingProjects, false));

    act(() => result.current.setObjective('Run this'));
    await act(() => result.current.handleSubmit(true));

    assert.equal(result.current.submitError, 'Assign a project before running this task');
    assert.equal(requests.filter(request => request.method === 'POST').length, 0);
  });

  it('does not submit blank objectives', async () => {
    const { result } = renderQuickTaskBar();
    await waitFor(() => assert.equal(result.current.isLoadingProjects, false));

    act(() => result.current.setObjective('   '));
    assert.equal(result.current.canSubmit, false);
    await act(() => result.current.handleSubmit());

    assert.equal(result.current.submitError, null);
    assert.equal(requests.filter(request => request.method === 'POST').length, 0);
  });
});
