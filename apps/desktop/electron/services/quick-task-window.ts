import { BrowserWindow, globalShortcut, screen, session } from 'electron';
import path from 'path';

import { store } from './settings-store';

const SETTINGS_KEY = 'quickTaskHotkey';
export const DEFAULT_QUICK_TASK_HOTKEY = 'Alt+Command+O';

const WINDOW_WIDTH = 620;
const INITIAL_WINDOW_HEIGHT = 150;

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

  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = workArea.x + Math.round((workArea.width - WINDOW_WIDTH) / 2);
  const y = workArea.y + Math.round(workArea.height * 0.18);

  quickWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: INITIAL_WINDOW_HEIGHT,
    x,
    y,
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  quickWindow.setAlwaysOnTop(true, 'floating');
  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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
