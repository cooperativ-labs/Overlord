import { BrowserWindow, globalShortcut, screen, session } from 'electron';
import path from 'path';

import { store } from './settings-store';

const SETTINGS_KEY = 'quickTaskHotkey';
const POSITION_SETTINGS_KEY = 'quickTaskWindowPosition';
export const DEFAULT_QUICK_TASK_HOTKEY = 'Alt+Command+O';

const WINDOW_WIDTH = 620;
const INITIAL_WINDOW_HEIGHT = 150;

type SavedPosition = { x: number; y: number };

function readSavedPosition(): SavedPosition | null {
  const raw = store.get(POSITION_SETTINGS_KEY);
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as SavedPosition).x === 'number' &&
    typeof (raw as SavedPosition).y === 'number'
  ) {
    return { x: (raw as SavedPosition).x, y: (raw as SavedPosition).y };
  }
  return null;
}

function writeSavedPosition(position: SavedPosition): void {
  store.set(POSITION_SETTINGS_KEY, position);
}

/**
 * Returns saved x,y if it still lands on a connected display; otherwise null.
 * Guards against monitors being unplugged since the position was stored.
 */
function getValidatedSavedPosition(width: number, height: number): SavedPosition | null {
  const saved = readSavedPosition();
  if (!saved) return null;
  const displays = screen.getAllDisplays();
  const fits = displays.some(display => {
    const { x, y, width: dw, height: dh } = display.workArea;
    return saved.x + width > x && saved.x < x + dw && saved.y + height > y && saved.y < y + dh;
  });
  return fits ? saved : null;
}

function getCursorDisplayPosition(width: number): SavedPosition {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { workArea } = display;
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round(workArea.height * 0.18)
  };
}

let quickWindow: BrowserWindow | null = null;
let registeredAccelerator: string | null = null;
let baseUrl = '';
let isDevMode = false;
/** Cleared on focus; avoids hiding when blur is transient (e.g. setSize after popover open). */
let quickTaskBlurHideTimer: ReturnType<typeof setTimeout> | null = null;

const QUICK_TASK_BLUR_HIDE_MS = 180;

function isReservedAccelerator(accel: string): boolean {
  // Disallow obvious system-level chords. Electron's globalShortcut.register
  // returns false anyway, but we do a light pre-check.
  return accel.trim().length === 0;
}

export function getStoredQuickTaskHotkey(): string {
  const value = store.get(SETTINGS_KEY);
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_QUICK_TASK_HOTKEY;
}

export function setStoredQuickTaskHotkey(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const next = trimmed.length > 0 ? trimmed : DEFAULT_QUICK_TASK_HOTKEY;
  store.set(SETTINGS_KEY, next);
  return next;
}

function getQuickTaskUrl(): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}/quick-task`;
}

function ensureWindow(): BrowserWindow {
  if (quickWindow && !quickWindow.isDestroyed()) return quickWindow;

  const initial =
    getValidatedSavedPosition(WINDOW_WIDTH, INITIAL_WINDOW_HEIGHT) ??
    getCursorDisplayPosition(WINDOW_WIDTH);

  quickWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: INITIAL_WINDOW_HEIGHT,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    title: 'Quick Task',
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  // 'screen-saver' level + visibleOnFullScreen lets the window float above
  // full-screen apps (e.g. fullscreen browser, Xcode) on macOS.
  quickWindow.setAlwaysOnTop(true, 'screen-saver');
  quickWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });

  quickWindow.loadURL(getQuickTaskUrl());

  if (isDevMode) {
    // Don't auto-open devtools — keeps the window small.
  }

  quickWindow.on('blur', () => {
    const win = quickWindow;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (quickTaskBlurHideTimer) {
      clearTimeout(quickTaskBlurHideTimer);
      quickTaskBlurHideTimer = null;
    }
    quickTaskBlurHideTimer = setTimeout(() => {
      quickTaskBlurHideTimer = null;
      if (!win.isDestroyed() && win.isVisible() && !win.isFocused()) {
        win.hide();
      }
    }, QUICK_TASK_BLUR_HIDE_MS);
  });

  quickWindow.on('focus', () => {
    if (quickTaskBlurHideTimer) {
      clearTimeout(quickTaskBlurHideTimer);
      quickTaskBlurHideTimer = null;
    }
  });

  quickWindow.on('moved', () => {
    const win = quickWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    writeSavedPosition({ x, y });
  });

  quickWindow.on('closed', () => {
    if (quickTaskBlurHideTimer) {
      clearTimeout(quickTaskBlurHideTimer);
      quickTaskBlurHideTimer = null;
    }
    quickWindow = null;
  });

  // Allow renderer to ask the window to close itself / resize
  return quickWindow;
}

function showQuickTaskWindow(): void {
  const window = ensureWindow();
  if (window.isVisible()) {
    window.focus();
    return;
  }

  // Choose where to show: respect the user's last-dragged position when valid;
  // otherwise center on the display under the cursor (so the bar follows the
  // user across monitors instead of always returning to the primary display).
  const [, currentHeight] = window.getSize();
  const target =
    getValidatedSavedPosition(WINDOW_WIDTH, currentHeight) ??
    getCursorDisplayPosition(WINDOW_WIDTH);
  window.setPosition(target.x, target.y, false);

  // Reload to ensure a fresh state each invocation. The page is light.
  if (window.webContents.getURL() !== getQuickTaskUrl()) {
    window.loadURL(getQuickTaskUrl());
  }
  window.show();
  window.focus();
  window.webContents.send('quick-task:shown');
}

export function hideQuickTaskWindow(): void {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) {
    quickWindow.hide();
  }
}

export function toggleQuickTaskWindow(): void {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) {
    quickWindow.hide();
    return;
  }
  showQuickTaskWindow();
}

export function setQuickTaskWindowSize(height: number): void {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const clamped = Math.max(120, Math.min(600, Math.round(height)));
  const [width] = quickWindow.getSize();
  quickWindow.setSize(width ?? WINDOW_WIDTH, clamped, false);
}

export function registerQuickTaskHotkey(accelerator?: string): {
  ok: boolean;
  accelerator: string;
  error?: string;
} {
  const target = (accelerator ?? getStoredQuickTaskHotkey()).trim();

  if (registeredAccelerator) {
    try {
      globalShortcut.unregister(registeredAccelerator);
    } catch {
      // ignore
    }
    registeredAccelerator = null;
  }

  if (isReservedAccelerator(target)) {
    return { ok: false, accelerator: target, error: 'Empty accelerator' };
  }

  let ok: boolean;
  try {
    ok = globalShortcut.register(target, () => {
      toggleQuickTaskWindow();
    });
  } catch (error) {
    return {
      ok: false,
      accelerator: target,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (!ok) {
    return {
      ok: false,
      accelerator: target,
      error: 'Failed to register accelerator (already in use?)'
    };
  }

  registeredAccelerator = target;
  setStoredQuickTaskHotkey(target);
  return { ok: true, accelerator: target };
}

export function unregisterQuickTaskHotkey(): void {
  if (registeredAccelerator) {
    try {
      globalShortcut.unregister(registeredAccelerator);
    } catch {
      // ignore
    }
    registeredAccelerator = null;
  }
}

export function initQuickTaskWindow(options: { platformUrl: string; isDev: boolean }): void {
  baseUrl = options.platformUrl;
  isDevMode = options.isDev;

  // Touch the default session so cookies are shared with main window.
  void session.defaultSession;

  registerQuickTaskHotkey();
}
