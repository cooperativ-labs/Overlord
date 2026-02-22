import { ipcMain, Notification } from 'electron';

import { store } from '../services/settings-store';

export function registerAppIpc(): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

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
}
