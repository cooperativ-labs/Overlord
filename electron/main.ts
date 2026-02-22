import { app, BrowserWindow } from 'electron';
import { config as loadDotenv } from 'dotenv';
import fs from 'fs';
import path from 'path';

import { registerAppIpc } from './ipc/app';
import { registerSupabaseIpc } from './ipc/supabase';
import { registerTerminalIpc } from './ipc/terminal';
import { startNextServer, stopNextServer } from './services/next-server';
import { SupabaseManager } from './services/supabase-manager';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
const supabaseManager = new SupabaseManager();

function loadLocalEnvForPackagedRuns() {
  if (isDev) return;

  const cwd = process.cwd();
  const envFiles = ['.env.local', '.env'];

  for (const envFile of envFiles) {
    const envPath = path.join(cwd, envFile);
    if (!fs.existsSync(envPath)) continue;

    const result = loadDotenv({ path: envPath, override: false });
    if (result.error) {
      console.error(`[env] Failed to load ${envFile}:`, result.error);
    } else {
      console.log(`[env] Loaded ${envFile} from ${envPath}`);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    center: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
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
  loadLocalEnvForPackagedRuns();

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
