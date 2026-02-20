import { app, BrowserWindow } from 'electron';
import path from 'path';

import { registerAppIpc } from './ipc/app';
import { registerSupabaseIpc } from './ipc/supabase';
import { registerTerminalIpc } from './ipc/terminal';
import { startNextServer, stopNextServer } from './services/next-server';
import { SupabaseManager } from './services/supabase-manager';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
const supabaseManager = new SupabaseManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    center: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL('http://localhost:3000');

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Start local Supabase
  try {
    await supabaseManager.start();
  } catch (err) {
    console.error('Failed to start Supabase:', err);
    // Continue anyway — user may have it running already
  }

  // Start Next.js server in production
  if (!isDev) {
    await startNextServer();
  }

  // Register IPC handlers
  registerTerminalIpc();
  registerSupabaseIpc(supabaseManager);
  registerAppIpc();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  try {
    await supabaseManager.stop();
  } catch {
    // Best-effort cleanup
  }
  if (!isDev) {
    stopNextServer();
  }
});
