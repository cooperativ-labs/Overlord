import * as Sentry from '@sentry/electron/main';
import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';

import { readOrCreateCanonicalDeviceFingerprint } from '../../../../lib/overlord/device-identity.mjs';
import {
  type AgentBundleAgent,
  getAgentBundleStatus,
  getAllBundleStatuses,
  getAllSlashCommandStatuses,
  getSlashCommandStatus,
  installAgentBundle,
  installAllBundles,
  installSlashCommands,
  repairAgentBundle,
  type SlashCommandAgent,
  uninstallAgentBundle,
  uninstallSlashCommands
} from '../services/agent-bundle';
import { configureAgentPermissions } from '../services/agent-permissions';
import { AppUpdaterService } from '../services/app-updater';
import { type CliInstallResult, getCliInstallStatus, installCli } from '../services/cli-installer';
import { openFeedWindow } from '../services/feed-window';
import {
  getOverlordPluginStatus,
  installOverlordPlugin,
  repairOverlordPlugin,
  uninstallOverlordPlugin
} from '../services/overlord-plugin';
import {
  DEFAULT_QUICK_TASK_HOTKEY,
  getStoredQuickTaskHotkey,
  hideQuickTaskWindow,
  registerQuickTaskHotkey,
  setQuickTaskWindowBounds,
  setQuickTaskWindowSize
} from '../services/quick-task-window';
import { store } from '../services/settings-store';

type RegisterAppIpcOptions = {
  appUpdater: AppUpdaterService;
  connectorUrl: string;
  platformUrl: string;
  getMainWindow: () => BrowserWindow | null;
};

export function registerAppIpc({
  appUpdater,
  connectorUrl,
  platformUrl,
  getMainWindow
}: RegisterAppIpcOptions): void {
  const allowedExternalProtocols = new Set([
    'http:',
    'https:',
    'vscode:',
    'cursor:',
    'windsurf:',
    'zed:',
    'subl:',
    'txmt:',
    'antigravity:',
    'idea:'
  ]);

  function resolveUserPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }

    if (filePath === '~') {
      return os.homedir();
    }

    return path.resolve(filePath);
  }

  ipcMain.handle('settings:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('app:get-platform-url', () => platformUrl);
  ipcMain.handle('app:get-connector-url', () => connectorUrl);
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('app:get-host-metadata', () => {
    return { hostname: os.hostname(), platform: process.platform };
  });

  ipcMain.handle('app:get-device-identity', async () => {
    const deviceFingerprint = await readOrCreateCanonicalDeviceFingerprint({
      legacyDesktopUserDataPath: app.getPath('userData')
    });
    return {
      deviceFingerprint,
      hostname: os.hostname(),
      platform: process.platform
    };
  });

  ipcMain.handle('app:notify', (_event, payload: { title?: string; body?: string }) => {
    const title = payload.title?.trim();
    const body = payload.body?.trim();

    if (!title || !body) return false;
    if (!Notification.isSupported()) return false;
    if (process.platform === 'darwin' && !app.isPackaged) {
      console.warn(
        '[app:notify] Skipping macOS notification in unsigned dev build because Electron 42 uses UNNotification and requires a signed app bundle.'
      );
      return false;
    }

    const notification = new Notification({
      title: title.slice(0, 160),
      body: body.slice(0, 1_000)
    });
    notification.on('failed', (_failedEvent, error) => {
      Sentry.captureException(new Error(`Failed to show desktop notification: ${error}`), {
        tags: {
          source: 'electron-notification',
          target: 'electron-main'
        },
        extra: {
          platform: process.platform,
          title: title.slice(0, 160),
          bodyLength: body.length
        }
      });
    });
    notification.show();
    return true;
  });

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return false;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }

    if (!allowedExternalProtocols.has(parsed.protocol)) {
      return false;
    }

    await shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle('app:reveal-file', (_event, filePath: string) => {
    const resolvedPath = resolveUserPath(filePath);
    shell.showItemInFolder(resolvedPath);
    return resolvedPath;
  });

  ipcMain.handle('app:reload', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    window.webContents.reloadIgnoringCache();
    return true;
  });

  ipcMain.handle('app:capture-sentry-test-event', async () => {
    const error = new Error(`Electron main Sentry test event at ${new Date().toISOString()}`);
    const eventId = Sentry.captureException(error, {
      tags: {
        source: 'admin-sentry-test',
        target: 'electron-main'
      }
    });

    await Sentry.flush(2_000);

    return { ok: true, eventId };
  });

  ipcMain.handle('feed-window:open', () => {
    openFeedWindow();
    return true;
  });

  ipcMain.handle('app:navigate-main', (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath.startsWith('/')) return false;

    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;

    win.webContents.send('app:navigate', targetPath);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  });

  ipcMain.handle('quick-task:get-hotkey', () => {
    return {
      accelerator: getStoredQuickTaskHotkey(),
      defaultAccelerator: DEFAULT_QUICK_TASK_HOTKEY
    };
  });

  ipcMain.handle('quick-task:set-hotkey', (_event, accelerator: string) => {
    return registerQuickTaskHotkey(accelerator);
  });

  ipcMain.handle('quick-task:close', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.hide();
    } else {
      hideQuickTaskWindow();
    }
    return true;
  });

  ipcMain.handle('quick-task:set-height', (_event, height: number) => {
    if (typeof height === 'number' && Number.isFinite(height)) {
      setQuickTaskWindowSize(height);
    }
    return true;
  });

  ipcMain.handle(
    'quick-task:set-bounds',
    (_event, args: { height: number; barOffsetTop: number }) => {
      if (
        args &&
        typeof args.height === 'number' &&
        Number.isFinite(args.height) &&
        typeof args.barOffsetTop === 'number' &&
        Number.isFinite(args.barOffsetTop)
      ) {
        setQuickTaskWindowBounds({
          height: args.height,
          barOffsetTop: args.barOffsetTop
        });
      }
      return true;
    }
  );

  ipcMain.handle('app-update:get-status', () => {
    return appUpdater.getStatus();
  });

  ipcMain.handle('app-update:check', async () => {
    return appUpdater.checkForUpdates();
  });

  ipcMain.handle('app-update:download', async () => {
    return appUpdater.downloadUpdate();
  });

  ipcMain.handle('app-update:quit-and-install', () => {
    return appUpdater.quitAndInstall();
  });

  ipcMain.handle('cli:get-install-status', () => {
    return getCliInstallStatus();
  });

  ipcMain.handle('cli:install', async (): Promise<CliInstallResult> => {
    return installCli();
  });

  ipcMain.handle('overlord-plugin:get-status', () => {
    return getOverlordPluginStatus();
  });

  ipcMain.handle('overlord-plugin:install', () => {
    return installOverlordPlugin();
  });

  ipcMain.handle('overlord-plugin:repair', () => {
    return repairOverlordPlugin();
  });

  ipcMain.handle('overlord-plugin:uninstall', () => {
    return uninstallOverlordPlugin();
  });

  // --- Agent Bundle IPC ---

  ipcMain.handle('agent-bundle:get-all-statuses', () => {
    return getAllBundleStatuses();
  });

  ipcMain.handle('agent-bundle:get-status', (_event, agent: AgentBundleAgent) => {
    return getAgentBundleStatus(agent);
  });

  ipcMain.handle('agent-bundle:install', (_event, agent: AgentBundleAgent) => {
    return installAgentBundle(agent);
  });

  ipcMain.handle('agent-bundle:install-all', () => {
    return installAllBundles();
  });

  ipcMain.handle('agent-bundle:repair', (_event, agent: AgentBundleAgent) => {
    return repairAgentBundle(agent);
  });

  ipcMain.handle('agent-bundle:uninstall', (_event, agent: AgentBundleAgent) => {
    return uninstallAgentBundle(agent);
  });

  // --- Agent Slash Command IPC ---
  ipcMain.handle('agent-slash:get-all-statuses', () => {
    return getAllSlashCommandStatuses();
  });

  ipcMain.handle('agent-slash:get-status', (_event, agent: SlashCommandAgent) => {
    return getSlashCommandStatus(agent);
  });

  ipcMain.handle('agent-slash:install', (_event, agent: SlashCommandAgent) => {
    return installSlashCommands(agent);
  });

  ipcMain.handle('agent-slash:uninstall', (_event, agent: SlashCommandAgent) => {
    return uninstallSlashCommands(agent);
  });

  // --- Agent Permission Setup IPC ---
  ipcMain.handle(
    'agent-permissions:configure',
    (_event, options?: { projectDirectory?: string }) => {
      return configureAgentPermissions(options ?? {});
    }
  );
}
