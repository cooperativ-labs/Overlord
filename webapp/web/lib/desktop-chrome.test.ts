import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDesktopBridge, getDesktopChrome } from './desktop-chrome.ts';

test('desktop bridge helpers feature-detect an absent preload bridge', () => {
  const originalWindow = globalThis.window;
  delete (globalThis as { window?: Window }).window;

  try {
    assert.equal(getDesktopBridge(), undefined);
    assert.deepEqual(getDesktopChrome(), { isDesktop: false, isMacDesktop: false });
  } finally {
    (globalThis as { window?: Window }).window = originalWindow;
  }
});

test('desktop bridge helpers preserve the Electron bridge and platform chrome state', () => {
  const originalWindow = globalThis.window;
  const bridge = { isDesktop: true, platform: 'darwin' } as OverlordDesktopBridge;
  (globalThis as { window?: Window }).window = { overlord: bridge } as Window;

  try {
    assert.equal(getDesktopBridge(), bridge);
    assert.deepEqual(getDesktopChrome(), { isDesktop: true, isMacDesktop: true });
  } finally {
    (globalThis as { window?: Window }).window = originalWindow;
  }
});
