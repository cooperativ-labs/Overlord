import type { ObjectiveDto, TerminalSessionDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { keys } from '../lib/query-keys.ts';

import { MissionLatchChip, MissionLatchSessionProvider } from './ObjectiveTerminalSessions.tsx';

/**
 * coo:1281 plan §10: the header Latch chip and its popover, which replace the mission panel's
 * Terminal sessions section.
 */

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function session(
  overrides: Partial<TerminalSessionDto> & { providerSessionId: string }
): TerminalSessionDto {
  return {
    executionRequestId: `req-${overrides.providerSessionId}`,
    objectiveId: 'obj-1',
    provider: 'latch',
    sessionName: overrides.providerSessionId,
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

const OBJECTIVES = [
  { id: 'obj-1', displayId: 'coo:1.abcd', title: 'Build the chip' }
] as unknown as ObjectiveDto[];

function renderChip(sessions: TerminalSessionDto[], objectives = OBJECTIVES) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } }
  });
  clients.push(qc);
  qc.setQueryData(keys.launchSettings('ws-1'), { executionTargetId: 'target-1' });
  return render(
    <QueryClientProvider client={qc}>
      <div className="@container/mission-panel">
        <MissionLatchSessionProvider missionId="mission-1" workspaceId="ws-1" sessions={sessions}>
          <MissionLatchChip sessions={sessions} objectives={objectives} />
          <button type="button">Outside</button>
        </MissionLatchSessionProvider>
      </div>
    </QueryClientProvider>
  );
}

async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

describe('MissionLatchChip', () => {
  it('is absent when the mission has no session', () => {
    renderChip([]);
    assert.equal(document.querySelector('[data-latch-chip]'), null);
  });

  it('names the current session state and hides its text on a narrow panel', () => {
    renderChip([session({ providerSessionId: 'live' })]);
    const chip = screen.getByRole('button', { name: 'Latch session, running' });
    assert.match(chip.textContent ?? '', /Latch · running/);
    const label = chip.querySelector('[data-latch-chip-label]');
    assert.ok(label?.className.includes('@max-[480px]/mission-panel:hidden'));
  });

  it('opens the current session card and previous sessions in a popover', async () => {
    renderChip([
      session({ providerSessionId: 'live', createdAt: '2026-11-16T12:00:00.000Z' }),
      session({
        providerSessionId: 'old',
        createdAt: '2026-11-15T12:00:00.000Z',
        lastObservedState: 'exited'
      })
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Latch session, running' }));
    await settle();
    assert.ok(
      screen.getByText('Terminal state is independent from mission and agent-session status.')
    );
    assert.ok(screen.getByText('Build the chip'));
    assert.ok(screen.getByRole('button', { name: /Open in iTerm/ }));
    assert.ok(screen.getByRole('button', { name: /Copy attach command/ }));
    assert.ok(screen.getByRole('button', { name: 'End session' }));
    assert.ok(screen.getByText('previous session'));
  });

  it('shows the newest session even when it belongs to another objective', () => {
    renderChip(
      [
        session({
          providerSessionId: 'older-running',
          objectiveId: 'obj-2',
          createdAt: '2026-11-17T12:00:00.000Z'
        }),
        session({
          providerSessionId: 'new-lost',
          objectiveId: 'obj-1',
          createdAt: '2026-11-16T12:00:00.000Z',
          lastObservedState: 'lost'
        })
      ],
      [
        { id: 'obj-1', displayId: 'coo:1.abcd', title: 'Build the chip', state: 'executing' }
      ] as ObjectiveDto[]
    );
    assert.ok(screen.getByRole('button', { name: 'Latch session, running' }));
  });

  it('follows the newest live session when every session has exited', () => {
    renderChip([
      session({ providerSessionId: 'a', lastObservedState: 'exited' }),
      session({
        providerSessionId: 'b',
        createdAt: '2026-11-16T11:00:00.000Z',
        lastObservedState: 'lost'
      })
    ]);
    assert.ok(screen.getByRole('button', { name: 'Latch session, lost' }));
  });

  it('keeps the popover open while the End session confirmation is used', async () => {
    renderChip([session({ providerSessionId: 'live' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Latch session, running' }));
    await settle();
    // Unreachable from this test client, so End session is disabled; the guard is what matters:
    // a press inside a dialog opened from the popover is not an outside press.
    const endSession = screen.getByRole('button', { name: 'End session' }) as HTMLButtonElement;
    assert.equal(endSession.disabled, true);
    const dialog = document.createElement('div');
    dialog.setAttribute('data-slot', 'dialog-content');
    const inner = document.createElement('button');
    dialog.append(inner);
    document.body.append(dialog);
    await act(async () => {
      fireEvent.pointerDown(inner);
      fireEvent.mouseDown(inner);
      fireEvent.click(inner);
    });
    await settle();
    assert.ok(screen.queryByText('Build the chip'), 'still open after a press in a nested dialog');
    dialog.remove();

    await act(async () => {
      fireEvent.pointerDown(screen.getByText('Outside'));
      fireEvent.mouseDown(screen.getByText('Outside'));
      fireEvent.click(screen.getByText('Outside'));
    });
    await settle();
    assert.equal(screen.queryByText('Build the chip'), null, 'an ordinary outside press closes it');
  });
});
