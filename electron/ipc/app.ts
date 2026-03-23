import { BrowserWindow, ipcMain, Notification, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';

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
import { store } from '../services/settings-store';

type RegisterAppIpcOptions = {
  appUpdater: AppUpdaterService;
  connectorUrl: string;
  platformUrl: string;
};

export function registerAppIpc({
  appUpdater,
  connectorUrl,
  platformUrl
}: RegisterAppIpcOptions): void {
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

  ipcMain.handle('app:notify', (_event, payload: { title?: string; body?: string }) => {
    const title = payload.title?.trim();
    const body = payload.body?.trim();

    if (!title || !body) return false;
    if (!Notification.isSupported()) return false;

    const notification = new Notification({
      title: title.slice(0, 160),
      body: body.slice(0, 1_000)
    });
    notification.show();
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
