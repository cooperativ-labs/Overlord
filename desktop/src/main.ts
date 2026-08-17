import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  session
} from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LOCAL_BACKEND_PROFILE_ID,
  resolveActiveBackend,
  sessionPartitionForProfile,
  setActiveBackendProfileId
} from './backend-profiles.js';
import {
  type BackendRuntimeController,
  bootActiveBackend,
  clearDesktopAuthForProfile,
  consumePendingProfileSwitch,
  createBackendRuntimeController,
  resolveInitialShellOrigin,
  stopAllBackendServers,
  writeSessionTokenForProfile
} from './backend-runtime.js';
import {
  hydrateLocalDesktopSessionFromCliAuth,
  syncSessionTokenToCliAuth
} from './cli-auth-sync.js';
import { CliUpdater } from './cli-updater.js';
import { registerIpc } from './ipc.js';
import { parseDesktopOAuthHandoffUrl, parseMissionDeepLink } from './oauth-handoff.js';
import { recordProcessInventory } from './process-inventory.js';
import {
  hideQuickTaskWindow,
  initQuickTaskWindow,
  setQuickTaskBackend,
  unregisterQuickTaskHotkey
} from './quick-task-window.js';
import { DesktopUpdater } from './updater.js';
import { applyCsp, createWindow, guardNavigation } from './window.js';

loadDesktopEnvDefaults();

const PRELOAD = path.join(__dirname, 'preload.cjs');
const SPLASH = path.join(__dirname, 'splash.html');

const HOST = process.env.OVERLORD_WEB_HOST ?? '127.0.0.1';
const PREFERRED_PORT = parsePort(process.env.OVERLORD_WEB_PORT, 4310, 'OVERLORD_WEB_PORT');

const DEV_CONNECT = process.env.OVERLORD_DESKTOP_DEV === '1';
const DEV_URL = process.env.OVERLORD_DESKTOP_URL ?? `http://${HOST}:${PREFERRED_PORT}`;

let mainWindow: BrowserWindow | null = null;
let shellOrigin = `http://${HOST}:${PREFERRED_PORT}`;
let backendController: BackendRuntimeController | null = null;
let updater: DesktopUpdater | null = null;
let cliUpdater: CliUpdater | null = null;
let shuttingDown = false;
let relaunchAfterQuit = false;
const pendingOAuthCallbackUrls: string[] = [];
const pendingMissionRoutes: string[] = [];

process.env.OVERLORD_DESKTOP_VERSION = app.getVersion();
registerOAuthProtocol();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    queueDeepLink(commandLine.find(argument => argument.startsWith('overlord://')));
    showOrCreateMainWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    queueDeepLink(url);
  });

  app
    .whenReady()
    .then(boot)
    .catch(error => {
      dialog.showErrorBox('Overlord failed to start', describe(error));
      app.quit();
    });
}

async function boot(): Promise<void> {
  ensurePackagedConfig();
  shellOrigin = await resolveInitialShellOrigin({
    host: HOST,
    preferredPort: PREFERRED_PORT,
    devConnect: DEV_CONNECT,
    devUrl: DEV_URL
  });

  backendController = createBackendRuntimeController({
    getShellOrigin: () => shellOrigin,
    relaunchApp: () => quitApp({ relaunch: true }),
    onBeforeSwitch: active => {
      recordProcessInventory({ tag: 'before-profile-switch', backendMode: active.mode });
    }
  });

  updater = new DesktopUpdater(
    () => mainWindow,
    () => installApplicationMenu(updater!)
  );
  cliUpdater = new CliUpdater(() => mainWindow);
  installApplicationMenu(updater);
  registerIpc({
    getWindow: () => mainWindow,
    updater,
    cliUpdater,
    preloadPath: PRELOAD,
    getShellOrigin: () => shellOrigin,
    getBackendController: () => backendController
  });

  const switchedToProfileId = consumePendingProfileSwitch();
  const { active, healthy } = await bootActiveBackend({
    shellOrigin,
    host: HOST,
    devConnect: DEV_CONNECT
  });
  configureSessionPolicy(active);
  recordProcessInventory({
    tag: healthy ? 'after-boot' : 'after-failed-boot',
    backendMode: active.mode
  });
  if (active.mode === 'local') {
    hydrateLocalDesktopSessionFromCliAuth({ backendUrl: active.apiBaseUrl });
  }

  if (!healthy) {
    await handleStartupFailure({ active, wasJustSwitchedTo: switchedToProfileId === active.id });
    return;
  }

  await openMainWindow();
  await consumePendingOAuthCallbacks();
  await consumePendingMissionDeepLinks();
  initQuickTaskWindow({
    appOrigin: shellOrigin,
    preloadPath: PRELOAD,
    partition: sessionPartitionForProfile(active.id)
  });
  updater.startAutomaticChecks();
  cliUpdater.startAutomaticChecks();

  app.on('activate', () => {
    showOrCreateMainWindow();
  });
}

function registerOAuthProtocol(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('overlord', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('overlord');
  }
  queueDeepLink(process.argv.find(argument => argument.startsWith('overlord://')));
}

function queueDeepLink(url: string | undefined): void {
  if (!url) return;
  if (parseDesktopOAuthHandoffUrl(url)) {
    pendingOAuthCallbackUrls.push(url);
    void consumePendingOAuthCallbacks();
    return;
  }
  const target = parseMissionDeepLink(url);
  if (!target) return;
  // The objective travels as a search param on the mission route: the panel is
  // still the mission, with the named objective as the thing to focus.
  pendingMissionRoutes.push(
    target.objectiveDisplayId
      ? `/user/missions/${target.missionId}?objective=${target.objectiveDisplayId}`
      : `/user/missions/${target.missionId}`
  );
  if (backendController) showOrCreateMainWindow();
  void consumePendingMissionDeepLinks();
}

async function consumePendingOAuthCallbacks(): Promise<void> {
  while (pendingOAuthCallbackUrls.length > 0 && backendController) {
    const url = pendingOAuthCallbackUrls.shift();
    const ticket = url ? parseDesktopOAuthHandoffUrl(url) : null;
    if (!ticket) continue;

    try {
      const active = resolveActiveBackend({ shellOrigin });
      if (active.mode !== 'remote') continue;
      const response = await fetch(`${active.apiBaseUrl}/api/auth/desktop/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket })
      });
      const payload = (await response.json().catch(() => null)) as {
        token?: unknown;
        message?: unknown;
      } | null;
      if (!response.ok || typeof payload?.token !== 'string' || !payload.token.trim()) {
        throw new Error(
          typeof payload?.message === 'string'
            ? payload.message
            : 'Desktop sign-in could not be completed.'
        );
      }
      writeSessionTokenForProfile({ profileId: active.id, token: payload.token });
      syncSessionTokenToCliAuth({
        profileId: active.id,
        token: payload.token,
        backendUrl: active.apiBaseUrl
      });
      mainWindow?.webContents.reload();
    } catch (error) {
      dialog.showErrorBox('GitHub sign-in failed', describe(error));
    }
  }
}

async function consumePendingMissionDeepLinks(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const active = resolveActiveBackend({ shellOrigin });
  if (!mainWindow.webContents.getURL().startsWith(active.shellOrigin)) return;

  while (pendingMissionRoutes.length > 0) {
    const route = pendingMissionRoutes.shift();
    if (route) mainWindow.webContents.send('overlord:navigate', route);
  }
}

function showOrCreateMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void openMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function configureSessionPolicy(active: ReturnType<typeof resolveActiveBackend>): void {
  const partition = session.fromPartition(sessionPartitionForProfile(active.id));
  applyCsp({
    session: partition,
    shellOrigin: active.shellOrigin,
    apiOrigin: active.apiBaseUrl
  });
}

/**
 * The window is only ever created for the profile this process booted into —
 * a profile change relaunches the app rather than re-pointing a live window at
 * a different backend.
 */
async function openMainWindow(): Promise<BrowserWindow | null> {
  const active = resolveActiveBackend({ shellOrigin });
  const partition = sessionPartitionForProfile(active.id);

  mainWindow = createWindow({ preloadPath: PRELOAD, partition });
  guardNavigation(mainWindow, active.shellOrigin);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadFile(SPLASH);

  if (!mainWindow) return null;

  await mainWindow.loadURL(`${active.shellOrigin}/`);
  await consumePendingMissionDeepLinks();
  setQuickTaskBackend({
    appOrigin: active.shellOrigin,
    partition: sessionPartitionForProfile(active.id)
  });
  return mainWindow;
}

/**
 * A profile that cannot be reached never leaves a half-started runtime behind:
 * every recovery path reaps the supervised processes and boots the app once
 * more from scratch, instead of re-entering `boot()` in a process that already
 * owns servers, IPC handlers, and updater timers.
 */
async function handleStartupFailure({
  active,
  wasJustSwitchedTo
}: {
  active: ReturnType<typeof resolveActiveBackend>;
  wasJustSwitchedTo: boolean;
}): Promise<void> {
  const canFallBackToLocal = active.id !== LOCAL_BACKEND_PROFILE_ID;
  if (wasJustSwitchedTo && active.mode === 'remote') {
    // Preserves the previous switch-failure behaviour: a backend we could not
    // reach right after the user selected it drops that profile's stored
    // session so the next attempt starts from a clean login.
    await clearDesktopAuthForProfile(active.id);
  }

  const buttons = canFallBackToLocal ? ['Retry', 'Switch to Local', 'Quit'] : ['Retry', 'Quit'];
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Overlord',
    message: 'Overlord could not start',
    detail: startupFailureMessage(active),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1
  });

  if (response === 0) {
    quitApp({ relaunch: true });
    return;
  }
  if (canFallBackToLocal && response === 1) {
    setActiveBackendProfileId(LOCAL_BACKEND_PROFILE_ID);
    quitApp({ relaunch: true });
    return;
  }
  quitApp({ relaunch: false });
}

/**
 * Single exit path. Quitting always reaps the supervised backend first, so no
 * embedded server, SQLite runtime, or utility process outlives the app — and a
 * relaunch (profile switch or startup retry) starts from zero of them.
 */
function quitApp({ relaunch }: { relaunch: boolean }): void {
  relaunchAfterQuit = relaunchAfterQuit || relaunch;
  app.quit();
}

function startupFailureMessage(active: ReturnType<typeof resolveActiveBackend>): string {
  if (active.mode === 'remote') {
    return `Could not reach ${active.label} at ${active.apiBaseUrl}.\nCheck the URL and your network connection, then retry or switch back to Local.`;
  }
  if (DEV_CONNECT) {
    return `Could not reach the Overlord dev server at ${shellOrigin}.\nStart it with \`ovld serve\` (or \`yarn start\`) and retry.`;
  }
  return `The Overlord server did not become ready at ${shellOrigin}.`;
}

function loadDesktopEnvDefaults(): void {
  const envDir = app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), '..');
  const fileName = app.isPackaged ? '.env.prod' : '.env.local';
  loadEnvFile(path.join(envDir, fileName));
}

function ensurePackagedConfig(): void {
  if (!app.isPackaged) return;
  const targetPath = globalConfigPath();
  if (existsSync(targetPath)) return;

  const webHost = process.env.OVERLORD_WEB_HOST?.trim() || HOST;
  const webPort = parsePort(process.env.OVERLORD_WEB_PORT, PREFERRED_PORT, 'OVERLORD_WEB_PORT');
  const sqlStudioHost = process.env.OVERLORD_SQL_STUDIO_HOST?.trim() || '127.0.0.1';
  const sqlStudioPort = parsePort(
    process.env.OVERLORD_SQL_STUDIO_PORT,
    4311,
    'OVERLORD_SQL_STUDIO_PORT'
  );
  const sqlStudioBinary = process.env.OVERLORD_SQL_STUDIO_BINARY?.trim() || 'sql-studio';

  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(
    targetPath,
    `# Overlord local instance configuration
instance_name = "Local Overlord"
backend_mode = "local"
backend_url = ${tomlString(`http://${webHost === '0.0.0.0' ? '127.0.0.1' : webHost}:${webPort}`)}
web_host = ${tomlString(webHost)}
web_port = ${webPort}
sql_studio_enabled = false
sql_studio_host = ${tomlString(sqlStudioHost)}
sql_studio_port = ${sqlStudioPort}
sql_studio_binary = ${tomlString(sqlStudioBinary)}
default_agent = "claude"
`
  );
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = parseEnvValue(trimmed.slice(eq + 1));
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

function parseEnvValue(rawValue: string): string {
  let value = rawValue.trim();
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
      quote = quote === char ? null : (quote ?? char);
      continue;
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      value = value.slice(0, i).trim();
      break;
    }
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

function parsePort(value: string | undefined, fallback: number, name: string): number {
  const raw = value?.trim();
  if (!raw) return fallback;

  const port = Number(raw);
  if (Number.isInteger(port) && port >= 0 && port < 65536) return port;

  console.warn(`[desktop] ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}`);
  return fallback;
}

function globalConfigPath(): string {
  return path.join(
    process.env.OVLD_HOME?.trim() || path.join(os.homedir(), '.ovld'),
    'overlord.toml'
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

app.on('before-quit', event => {
  updater?.stopAutomaticChecks();
  cliUpdater?.stopAutomaticChecks();
  unregisterQuickTaskHotkey();
  hideQuickTaskWindow();
  if (shuttingDown) return;

  // Reaping the embedded backend is asynchronous, so hold the quit until the
  // process has actually exited rather than firing a kill and racing teardown.
  shuttingDown = true;
  event.preventDefault();
  void (async () => {
    try {
      recordProcessInventory({
        tag: 'before-quit',
        backendMode: resolveActiveBackend({ shellOrigin }).mode
      });
      await stopAllBackendServers({ shellOrigin });
    } catch (error) {
      process.stderr.write(`[desktop] shutdown cleanup failed: ${describe(error)}\n`);
    }
    if (relaunchAfterQuit) app.relaunch();
    app.exit(0);
  })();
});

app.on('window-all-closed', () => {
  app.quit();
});

function installApplicationMenu(updater: DesktopUpdater): void {
  const isMac = process.platform === 'darwin';
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates...',
    click: () => {
      void updater.checkForUpdatesWithDialog();
    }
  };
  const installUpdateItem: MenuItemConstructorOptions[] = updater.isUpdateReadyToInstall()
    ? [
        {
          label: 'Install Update and Relaunch',
          click: () => {
            void updater.showInstallDialog();
          }
        }
      ]
    : [];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              checkForUpdatesItem,
              ...installUpdateItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : ([] as MenuItemConstructorOptions[])),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    ...(!isMac
      ? ([
          {
            role: 'help',
            submenu: [checkForUpdatesItem, ...installUpdateItem]
          }
        ] as MenuItemConstructorOptions[])
      : ([] as MenuItemConstructorOptions[]))
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
