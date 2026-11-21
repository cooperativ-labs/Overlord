import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { BackendPage } from './BackendPage.tsx';

afterEach(() => { cleanup(); delete window.overlord; });

test('local key settings save and remove without displaying the saved credential', async () => {
  let saved = '';
  window.overlord = {
    isDesktop: true,
    switchBackend: async () => ({}),
    listBackends: async () => [{ id: 'local', label: 'Local', mode: 'local', backendUrl: 'http://127.0.0.1:4310' }],
    getActiveBackend: async () => ({ id: 'local', mode: 'local' }),
    localOpenRouter: {
      status: async () => ({ configured: false }),
      set: async (key: string) => { saved = key; return true; },
      clear: async () => { saved = ''; return true; }
    }
  } as unknown as OverlordDesktopBridge;
  render(<BackendPage />);
  const input = await screen.findByLabelText('OpenRouter API key') as HTMLInputElement;
  assert.equal(input.type, 'password');
  fireEvent.change(input, { target: { value: 'test-user-key' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await waitFor(() => assert.equal(saved, 'test-user-key'));
  await waitFor(() => assert.equal(input.value, ''));
  assert.ok(screen.getByText('Key saved. Restart Overlord to apply it.'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
  await waitFor(() => assert.equal(saved, ''));
  assert.ok(screen.getByText('Key removed. Restart Overlord to apply the change.'));
});

test('remote backend does not expose local key settings', async () => {
  window.overlord = {
    isDesktop: true,
    switchBackend: async () => ({}),
    listBackends: async () => [{ id: 'cloud', label: 'Cloud', mode: 'remote', backendUrl: 'https://example.test' }],
    getActiveBackend: async () => ({ id: 'cloud', mode: 'remote' }),
    localOpenRouter: { status: async () => ({ configured: false }), set: async () => true, clear: async () => true }
  } as unknown as OverlordDesktopBridge;
  render(<BackendPage />);
  await screen.findByText('Cloud');
  await waitFor(() => assert.equal(screen.queryByLabelText('OpenRouter API key'), null));
});
