import { ipcMain } from 'electron';

import { SupabaseManager } from '../services/supabase-manager';

export function registerSupabaseIpc(manager: SupabaseManager): void {
  ipcMain.handle('supabase:status', () => manager.getStatus());
  ipcMain.handle('supabase:restart', () => manager.restart());
}
