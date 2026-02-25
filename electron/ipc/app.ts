import { ipcMain, Notification } from 'electron';

import { AppUpdaterService } from '../services/app-updater';
import {
  getCliInstallStatus,
  installCli,
  type CliInstallResult
} from '../services/cli-installer';
import { store } from '../services/settings-store';

type RegisterAppIpcOptions = {
  appUpdater: AppUpdaterService;
  platformUrl: string;
};

export function registerAppIpc({ appUpdater, platformUrl }: RegisterAppIpcOptions): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('app:get-platform-url', () => platformUrl);

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
}
