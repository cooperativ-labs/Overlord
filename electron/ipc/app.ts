import { ipcMain } from 'electron';

import { store } from '../services/settings-store';

export function registerAppIpc(): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });
}
