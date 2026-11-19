import type { TerminalSessionDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { keys } from '../lib/query-keys.ts';

import { LatchSessionActions } from './LatchSessionActions.tsx';
import {
  MissionLatchSessionProvider,
  ObjectiveTerminalSessions
} from './ObjectiveTerminalSessions.tsx';

/** coo:1303: one shared set of Latch session controls, in the layout each surface needs. */

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function session(overrides: Partial<TerminalSessionDto> = {}): TerminalSessionDto {
  return {
    executionRequestId: 'req-live',
    providerSessionId: 'live',
    objectiveId: 'obj-1',
    provider: 'latch',
    sessionName: 'live-session',
    executionTargetId: 'target-1',
    deviceLabel: 'Mac',
    agentSessionId: null,
    executable: 'latch',
    viewerKind: 'iterm',
    viewerOpenAs: 'window',
    createdAt: '2026-11-16T10:00:00.000Z',
    lastObservedState: 'running',
    ...overrides
  };
}

function client() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } }
  });
  clients.push(qc);
  qc.setQueryData(keys.launchSettings('ws-1'), { executionTargetId: 'target-1' });
  return qc;
}

describe('ObjectiveTerminalSessions', () => {
  it('draws the minimal layout: Open over Copy command and End session', () => {
    const sessions = [session()];
    render(
      <QueryClientProvider client={client()}>
        <MissionLatchSessionProvider missionId="mission-1" workspaceId="ws-1" sessions={sessions}>
          <ObjectiveTerminalSessions sessions={sessions} />
        </MissionLatchSessionProvider>
      </QueryClientProvider>
    );
    const actions = document.querySelector('[data-latch-actions="minimal"]');
    assert.ok(actions, 'the objective detail uses the minimal layout');
    const open = screen.getByRole('button', { name: /Open in iTerm/ });
    const copy = screen.getByRole('button', { name: 'Copy command' });
    const end = screen.getByRole('button', { name: 'End session' }) as HTMLButtonElement;
    assert.equal(open.parentElement, actions, 'Open is the full-width first row');
    assert.equal(copy.parentElement, end.parentElement, 'Copy and End sit side by side beneath');
    assert.ok(copy.parentElement?.className.includes('grid-cols-2'));
    assert.equal(end.disabled, true, 'End session needs a reachable running session');
    assert.ok(screen.getByText('running'));
  });
});

describe('LatchSessionActions', () => {
  function renderActions(layout: 'card' | 'minimal' | 'inline', reachable = true) {
    return render(
      <QueryClientProvider client={client()}>
        <LatchSessionActions
          session={session()}
          name="live-session"
          state="running"
          reachable={reachable}
          layout={layout}
        />
      </QueryClientProvider>
    );
  }

  it('gives the card a filled primary button and labelled secondary actions', () => {
    renderActions('card');
    const open = screen.getByRole('button', { name: /Open in iTerm/ }) as HTMLButtonElement;
    assert.equal(open.disabled, false);
    assert.equal(open.getAttribute('data-slot'), 'button');
    assert.ok(screen.getByRole('button', { name: 'Copy command' }));
    const end = screen.getByRole('button', { name: 'End session' }) as HTMLButtonElement;
    assert.equal(end.disabled, false);
  });

  it('keeps the inline layout icon-only with all three controls', () => {
    renderActions('inline', false);
    const open = screen.getByRole('button', {
      name: 'Open live-session in iTerm'
    }) as HTMLButtonElement;
    assert.equal(open.disabled, true, 'an unreachable device cannot open');
    assert.ok(screen.getByRole('button', { name: 'Copy Latch attach command' }));
    assert.ok(screen.getByRole('button', { name: 'End session' }));
    assert.equal(screen.queryByText('Copy command'), null);
  });
});
