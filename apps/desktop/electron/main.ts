import * as Sentry from '@sentry/electron/main';
import { config as loadDotenv } from 'dotenv';
import { app, BrowserWindow, Menu, MenuItemConstructorOptions, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';

import { registerAppIpc } from './ipc/app';
import { registerAuthIpc } from './ipc/auth';
import { registerFilesystemIpc, teardownFilesystemIpc } from './ipc/filesystem';
import { registerRemoteInstallIpc } from './ipc/remote-install';
import { registerSupabaseIpc } from './ipc/supabase';
import { registerTailscaleIpc } from './ipc/tailscale';
import { registerTerminalIpc } from './ipc/terminal';
import { registerAppMenu } from './services/app-menu';
import { AppUpdaterService } from './services/app-updater';
import {
  installAuthHeaderInjector,
  installRendererResponseHeaders
} from './services/header-injector';
import {
  clearLocalRuntime,
  generateLocalSecret,
  writeLocalRuntime
} from './services/local-runtime';
import {
  computeAccessTokenExpiresAt,
  getSupabaseOrigin,
  refreshOAuthTokens
} from './services/oauth-tokens';
import { createRefreshController } from './services/refresh-controller';
import { createElectronSessionStore } from './services/session-store';
import { SupabaseManager } from './services/supabase-manager';
// Baked-in production runtime vars (generated from an explicit allowlist before build).
// In dev mode, the committed default file exports an empty object.
import { PROD_ENV } from './_prod-env.generated';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let unsubscribeAppMenu: (() => void) | null = null;
let platformUrl = '';
let connectorUrl = '';
const supabaseManager = new SupabaseManager();
const sessionStore = createElectronSessionStore();
const refreshController = createRefreshController({
  store: sessionStore,
  refreshTokens: async ({ platformUrl: currentPlatformUrl, refreshToken }) => {
    const sessionToken = await refreshOAuthTokens(currentPlatformUrl, refreshToken);
    return {
      accessToken: sessionToken.access_token,
      refreshToken: sessionToken.refresh_token,
      accessTokenExpiresAt: computeAccessTokenExpiresAt(sessionToken)
    };
  }
});
const appUpdater = new AppUpdaterService({
  isPackaged: app.isPackaged,
  currentVersion: app.getVersion()
});

Sentry.init({
  dsn: 'https://4217dfda3fcd82c64dab291ea1d15aef@o4508852831977472.ingest.us.sentry.io/4511274027450368'
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

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

function getUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function openUrlInDefaultBrowser(url: string): Promise<boolean> {
  const parsed = getUrlOrigin(url);
  if (!parsed) return false;

  const protocol = new URL(url).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return false;

  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
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

function normalizeConfiguredUrl(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is missing.`);
  }

  const parsed = new URL(trimmed);
  const isLoopbackHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost)) {
    throw new Error(`${label} must use https:// or a localhost http:// URL. Received: ${value}`);
  }

  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function resolveProductionPlatformUrl(): string {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.OVERLORD_PLATFORM_URL?.trim() ||
    process.env.OVERLORD_URL?.trim();
  if (!configuredUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_SITE_URL (or OVERLORD_PLATFORM_URL / OVERLORD_URL override) for packaged Electron startup.'
    );
  }

  return normalizeConfiguredUrl(configuredUrl, 'Packaged Electron platform URL');
}

function resolveConnectorUrl(fallbackUrl: string): string {
  const explicitConnectorUrl = process.env.OVERLORD_CONNECTOR_URL?.trim();
  if (explicitConnectorUrl) {
    return normalizeConfiguredUrl(explicitConnectorUrl, 'Electron connector URL');
  }

  const legacyOverlordUrl = process.env.OVERLORD_URL?.trim();
  const configuredUrl =
    legacyOverlordUrl && isLoopbackUrl(legacyOverlordUrl) ? legacyOverlordUrl : fallbackUrl;
  return normalizeConfiguredUrl(configuredUrl, 'Electron connector URL');
}

function createWindow(targetUrl: string) {
  const targetOrigin = getUrlOrigin(targetUrl);
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
      sandbox: true,
      spellcheck: true
    }
  });

  registerNativeContextMenu(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (targetOrigin && getUrlOrigin(url) !== targetOrigin) {
      void openUrlInDefaultBrowser(url);
    }

    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!targetOrigin) return;

    const nextOrigin = getUrlOrigin(url);
    if (!nextOrigin || nextOrigin === targetOrigin) return;

    event.preventDefault();
    void openUrlInDefaultBrowser(url);
  });
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

function focusMainWindow(): void {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
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
  if (!hasSingleInstanceLock) return;

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

  let localSecret = process.env.OVERLORD_LOCAL_SECRET?.trim() || '';

  if (isDev) {
    platformUrl = 'http://localhost:3000';
  } else {
    platformUrl = resolveProductionPlatformUrl();
  }
  connectorUrl = resolveConnectorUrl(platformUrl);
  if (!localSecret && isLoopbackUrl(connectorUrl)) {
    localSecret = generateLocalSecret();
  }

  // Always open to /u — the middleware will redirect to /electron-login if not authenticated.
  const windowUrl = `${platformUrl}/u`;
  const platformOrigin = new URL(platformUrl).origin;

  if (localSecret) {
    process.env.OVERLORD_LOCAL_SECRET = localSecret;
  } else {
    delete process.env.OVERLORD_LOCAL_SECRET;
  }
  process.env.OVERLORD_PLATFORM_URL = platformUrl;
  process.env.OVERLORD_CONNECTOR_URL = connectorUrl;

  writeLocalRuntime(connectorUrl, localSecret);

  installRendererResponseHeaders(session.defaultSession, getRendererCsp(windowUrl), platformOrigin);
  installAuthHeaderInjector({
    session: session.defaultSession,
    platformOrigin,
    supabaseOrigin: getSupabaseOrigin(),
    refreshController
  });

  // Register IPC handlers
  registerTerminalIpc();
  registerFilesystemIpc();
  registerRemoteInstallIpc();
  registerTailscaleIpc();
  registerSupabaseIpc(supabaseManager);
  registerAppIpc({ appUpdater, platformUrl, connectorUrl });
  registerAuthIpc({
    getPlatformUrl: () => platformUrl,
    sessionStore,
    refreshController
  });

  createWindow(windowUrl);
  appUpdater.initialize();
  unsubscribeAppMenu = registerAppMenu({ appUpdater, isDev });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(windowUrl);
    }
  });
});

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    focusMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  unsubscribeAppMenu?.();
  unsubscribeAppMenu = null;
  clearLocalRuntime(connectorUrl);

  try {
    await teardownFilesystemIpc();
  } catch {
    // best effort — shutting down anyway
  }

  if (isDev) {
    try {
      await supabaseManager.stop();
    } catch {
      // Best-effort cleanup
    }
  }
});
