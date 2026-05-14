import { BrowserWindow, screen } from 'electron';
import path from 'path';

import { store } from './settings-store';

const POSITION_SETTINGS_KEY = 'feedWindowBounds';

const WINDOW_WIDTH = 820;
const WINDOW_HEIGHT = 900;

type SavedBounds = { x: number; y: number; width: number; height: number };

function readSavedBounds(): SavedBounds | null {
  const raw = store.get(POSITION_SETTINGS_KEY);
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as SavedBounds).x === 'number' &&
    typeof (raw as SavedBounds).y === 'number' &&
    typeof (raw as SavedBounds).width === 'number' &&
    typeof (raw as SavedBounds).height === 'number'
  ) {
    return raw as SavedBounds;
  }
  return null;
}

function writeSavedBounds(bounds: SavedBounds): void {
  store.set(POSITION_SETTINGS_KEY, bounds);
}

function getValidatedSavedBounds(): SavedBounds | null {
  const saved = readSavedBounds();
  if (!saved) return null;
  const displays = screen.getAllDisplays();
  const fits = displays.some(display => {
    const { x, y, width: dw, height: dh } = display.workArea;
    return (
      saved.x + saved.width > x &&
      saved.x < x + dw &&
      saved.y + saved.height > y &&
      saved.y < y + dh
    );
  });
  return fits ? saved : null;
}

function getCenteredBounds(width: number, height: number): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { workArea } = display;
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2)
  };
}

let feedWindow: BrowserWindow | null = null;
let baseUrl = '';

function getFeedWindowUrl(): string {
  return `${baseUrl.replace(/\/$/, '')}/feed-window`;
}

function ensureWindow(): BrowserWindow {
  if (feedWindow && !feedWindow.isDestroyed()) return feedWindow;

  const saved = getValidatedSavedBounds();
  const position = saved ?? getCenteredBounds(WINDOW_WIDTH, WINDOW_HEIGHT);
  const width = saved?.width ?? WINDOW_WIDTH;
  const height = saved?.height ?? WINDOW_HEIGHT;

  feedWindow = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    minWidth: 480,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'Feed',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  feedWindow.loadURL(getFeedWindowUrl());

  feedWindow.once('ready-to-show', () => {
    feedWindow?.show();
    feedWindow?.focus();
  });

  feedWindow.on('moved', () => {
    const win = feedWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    writeSavedBounds({ x, y, width: w, height: h });
  });

  feedWindow.on('resized', () => {
    const win = feedWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    writeSavedBounds({ x, y, width: w, height: h });
  });

  feedWindow.on('closed', () => {
    feedWindow = null;
  });

  return feedWindow;
}

export function openFeedWindow(): void {
  const win = ensureWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function initFeedWindow(options: { platformUrl: string }): void {
  baseUrl = options.platformUrl;
}
