import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { DiagnosticsPage } from './DiagnosticsPage.tsx';

afterEach(() => {
  cleanup();
  delete window.overlord;
});

test('older desktop builds show an unavailable capture action', () => {
  render(<DiagnosticsPage />);
  assert.equal(
    (screen.getByRole('button', { name: 'Record 15 seconds' }) as HTMLButtonElement).disabled,
    true
  );
  assert.ok(screen.getByText('Update the desktop app to enable recording.'));
});

test('recording remains active after settings is closed and reopened', async () => {
  let status: DesktopPerformanceCaptureStatus = { state: 'idle', endsAt: null, message: null };
  let recordings = 0;
  let reveals = 0;
  window.overlord = {
    isDesktop: true,
    diagnostics: {
      getStatus: async () => status,
      record: async () => {
        recordings++;
        status = { state: 'recording', endsAt: null, message: 'Recording for 15 seconds…' };
        return status;
      },
      reveal: async () => {
        reveals++;
        return true;
      }
    }
  } as OverlordDesktopBridge;
  const first = render(<DiagnosticsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Record 15 seconds' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Recording…' })));
  assert.equal(recordings, 1);
  first.unmount();
  const second = render(<DiagnosticsPage />);
  await waitFor(() =>
    assert.equal(
      (screen.getByRole('button', { name: 'Recording…' }) as HTMLButtonElement).disabled,
      true
    )
  );
  second.unmount();
  status = { state: 'ready', endsAt: null, message: 'Capture saved on this computer.' };
  render(<DiagnosticsPage />);
  await waitFor(() =>
    assert.equal(
      (screen.getByRole('button', { name: 'Show capture files' }) as HTMLButtonElement).disabled,
      false
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show capture files' }));
  await waitFor(() => assert.equal(reveals, 1));
});
