import { config as loadDotenv } from 'dotenv';
import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import fs from 'fs';
import path from 'path';

import { registerAppIpc } from './ipc/app';
import { registerAuthIpc } from './ipc/auth';
import { registerFilesystemIpc } from './ipc/filesystem';
import { registerSupabaseIpc } from './ipc/supabase';
import { registerTerminalIpc } from './ipc/terminal';
import { registerAppMenu } from './services/app-menu';
import { AppUpdaterService } from './services/app-updater';
import {
  clearLocalRuntime,
  generateLocalSecret,
  writeLocalRuntime
} from './services/local-runtime';
import { SupabaseManager } from './services/supabase-manager';
import { killAllTerminals } from './services/terminal-manager';

// Baked-in production runtime vars (generated from an explicit allowlist before build).
// In dev mode, the committed default file exports an empty object.
import { PROD_ENV } from './_prod-env.generated';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let unsubscribeAppMenu: (() => void) | null = null;
let platformUrl = '';
const supabaseManager = new SupabaseManager();
const appUpdater = new AppUpdaterService({
  isPackaged: app.isPackaged,
  currentVersion: app.getVersion()
});

function getRendererCsp(targetUrl: string): string {
  const targetOrigin = (() => {
    try {
      return new URL(targetUrl).origin;
    } catch {
      return '';
    }
  })();

  // Dev: allow ws: broadly so the local Supabase realtime endpoint
  //      (ws://localhost:54321 / ws://127.0.0.1:54321) can connect alongside the
  //      Next.js HMR WebSocket on the app port.
  // Prod: add wss: so Supabase Cloud realtime (wss://…supabase.co) can connect.
  //      Without wss: the Supabase realtime subscription is silently blocked,
  //      preventing cross-column drag-and-drop updates from appearing without
  //      a full page refresh.
  const connectSources = isDev
    ? [
        "'self'",
        targetOrigin,
        targetOrigin.replace(/^http:/, 'ws:'),
        'http://localhost:54321',
        'http://127.0.0.1:54321',
        'https:',
        'wss:',
        'ws:'
      ].join(' ')
    : ["'self'", 'https:', 'wss:'].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`
  ].join('; ');
}

function applyRendererCsp(window: BrowserWindow, targetUrl: string): void {
  const csp = getRendererCsp(targetUrl);
  const session = window.webContents.session;

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
}

function loadLocalEnvForPackagedRuns() {
  if (isDev) return;

  // 1. Apply baked-in production vars first (lowest precedence — anything
  //    already in process.env or loaded by a file below will win).
  for (const [key, value] of Object.entries(PROD_ENV)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  // 2. Allow per-machine overrides via a .env file in the userData directory
  //    (~/Library/Application Support/Overlord/ on macOS).
  //    This lets operators override individual keys without rebuilding.
  const userDataDir = app.getPath('userData');
  const envFiles = ['.env.local', '.env'];

  for (const envFile of envFiles) {
    const envPath = path.join(userDataDir, envFile);
    if (!fs.existsSync(envPath)) continue;

    const result = loadDotenv({ path: envPath, override: false });
    if (result.error) {
      console.error(`[env] Failed to load ${envFile}:`, result.error);
    } else {
      console.warn(`[env] Loaded ${envFile} from ${envPath}`);
    }
  }
}

function resolveProductionPlatformUrl(): string {
  const configuredUrl =
    process.env.OVERLORD_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configuredUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_SITE_URL (or OVERLORD_URL override) for packaged Electron startup.'
    );
  }

  const parsed = new URL(configuredUrl);
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  ) {
    throw new Error(`Packaged Electron requires an https platform URL. Received: ${configuredUrl}`);
  }

  return parsed.toString().replace(/\/$/, '');
}

function createWindow(targetUrl: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    center: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  applyRendererCsp(mainWindow, targetUrl);
  registerNativeContextMenu(mainWindow);
  mainWindow.loadURL(targetUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    appUpdater.setMainWindow(null);
  });

  appUpdater.setMainWindow(mainWindow);
}

function registerNativeContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    const hasSelection = Boolean(params.selectionText?.trim());

    if (params.isEditable) {
      if (params.misspelledWord) {
        const suggestions = params.dictionarySuggestions.slice(0, 6);
        if (suggestions.length > 0) {
          template.push(
            ...suggestions.map(suggestion => ({
              label: suggestion,
              click: () => window.webContents.replaceMisspelling(suggestion)
            }))
          );
        } else {
          template.push({
            label: 'No spelling suggestions',
            enabled: false
          });
        }
        template.push({ type: 'separator' });
      }

      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      );
    } else if (hasSelection) {
      template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }

    if (template.length === 0) return;

    Menu.buildFromTemplate(template).popup({ window });
  });
}

app.whenReady().then(async () => {
  loadLocalEnvForPackagedRuns();

  // Start local Supabase only in dev — production uses Supabase Cloud
  if (isDev) {
    try {
      await supabaseManager.start();
    } catch (err) {
      console.error('Failed to start Supabase:', err);
      // Continue anyway — user may have it running already
    }
  }

  let localSecret = '';

  if (isDev) {
    platformUrl = 'http://localhost:3000';
    localSecret = generateLocalSecret();
  } else {
    platformUrl = resolveProductionPlatformUrl();
  }

  // Always open to /u — the middleware will redirect to /electron-login if not authenticated.
  const windowUrl = `${platformUrl}/u`;

  if (localSecret) {
    process.env.OVERLORD_LOCAL_SECRET = localSecret;
  } else {
    delete process.env.OVERLORD_LOCAL_SECRET;
  }
  process.env.OVERLORD_URL = platformUrl;

  writeLocalRuntime(platformUrl, localSecret);

  // Register IPC handlers
  registerTerminalIpc();
  registerFilesystemIpc();
  registerSupabaseIpc(supabaseManager);
  registerAppIpc({ appUpdater, platformUrl });
  registerAuthIpc({ getPlatformUrl: () => platformUrl });

  createWindow(windowUrl);
  appUpdater.initialize();
  unsubscribeAppMenu = registerAppMenu({ appUpdater, isDev });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(windowUrl);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  killAllTerminals();
  unsubscribeAppMenu?.();
  unsubscribeAppMenu = null;
  clearLocalRuntime(platformUrl);

  if (isDev) {
    try {
      await supabaseManager.stop();
    } catch {
      // Best-effort cleanup
    }
  }
});
