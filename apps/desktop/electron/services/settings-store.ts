import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type ExternalTerminalApp =
  | 'default'
  | 'terminal'
  | 'iterm'
  | 'warp'
  | 'tmux'
  | 'ghostty'
  | 'alacritty'
  | 'kitty'
  | 'hyper'
  | 'cmux'
  | 'custom';
export type ExternalTerminalLaunchMode = 'window' | 'tab' | 'custom';

interface StoreData {
  terminalMode?: 'embedded' | 'external';
  externalTerminalApp: ExternalTerminalApp;
  externalTerminalLaunchMode: ExternalTerminalLaunchMode;
  externalTerminalCustomHotkey: string;
  customExternalTerminalApp: string;
  serverExternalTerminalApp: ExternalTerminalApp;
  serverExternalTerminalLaunchMode: ExternalTerminalLaunchMode;
  serverExternalTerminalCustomHotkey: string;
  customServerExternalTerminalApp: string;
  windowBounds: { width: number; height: number; x?: number; y?: number };
  [key: string]: unknown;
}

const defaults: StoreData = {
  externalTerminalApp: 'default',
  externalTerminalLaunchMode: 'tab',
  externalTerminalCustomHotkey: '',
  customExternalTerminalApp: '',
  serverExternalTerminalApp: 'default',
  serverExternalTerminalLaunchMode: 'tab',
  serverExternalTerminalCustomHotkey: '',
  customServerExternalTerminalApp: '',
  windowBounds: { width: 1400, height: 900 }
};

let data: StoreData | null = null;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function migrateLegacySettings(raw: Record<string, unknown>): {
  data: StoreData;
  changed: boolean;
} {
  const next = { ...defaults, ...raw } as StoreData;
  let changed = false;

  if (raw.terminalMode === 'embedded') {
    changed = true;
    next.externalTerminalApp =
      typeof raw.externalTerminalApp === 'string' && raw.externalTerminalApp.length > 0
        ? (raw.externalTerminalApp as ExternalTerminalApp)
        : defaults.externalTerminalApp;
    next.externalTerminalLaunchMode =
      typeof raw.externalTerminalLaunchMode === 'string' &&
      raw.externalTerminalLaunchMode.length > 0
        ? (raw.externalTerminalLaunchMode as ExternalTerminalLaunchMode)
        : defaults.externalTerminalLaunchMode;
  }

  const localTerminalApp =
    typeof next.externalTerminalApp === 'string' && next.externalTerminalApp.length > 0
      ? next.externalTerminalApp
      : defaults.externalTerminalApp;
  const localLaunchMode =
    typeof next.externalTerminalLaunchMode === 'string' &&
    next.externalTerminalLaunchMode.length > 0
      ? next.externalTerminalLaunchMode
      : defaults.externalTerminalLaunchMode;
  const localCustomHotkey =
    typeof next.externalTerminalCustomHotkey === 'string'
      ? next.externalTerminalCustomHotkey
      : defaults.externalTerminalCustomHotkey;
  const localCustomApp =
    typeof next.customExternalTerminalApp === 'string'
      ? next.customExternalTerminalApp
      : defaults.customExternalTerminalApp;

  if (
    typeof raw.serverExternalTerminalApp !== 'string' ||
    raw.serverExternalTerminalApp.length === 0
  ) {
    changed = true;
    next.serverExternalTerminalApp = localTerminalApp;
  }
  if (
    typeof raw.serverExternalTerminalLaunchMode !== 'string' ||
    raw.serverExternalTerminalLaunchMode.length === 0
  ) {
    changed = true;
    next.serverExternalTerminalLaunchMode = localLaunchMode;
  }
  if (typeof raw.serverExternalTerminalCustomHotkey !== 'string') {
    changed = true;
    next.serverExternalTerminalCustomHotkey = localCustomHotkey;
  }
  if (typeof raw.customServerExternalTerminalApp !== 'string') {
    changed = true;
    next.customServerExternalTerminalApp = localCustomApp;
  }

  if ('terminalMode' in next) {
    changed = true;
    delete next.terminalMode;
  }

  return { data: next, changed };
}

function load(): StoreData {
  if (data) return data;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    const migrated = migrateLegacySettings(JSON.parse(raw) as Record<string, unknown>);
    data = migrated.data;
    if (migrated.changed) {
      save();
    }
  } catch {
    data = { ...defaults };
  }
  return data!;
}

function save(): void {
  if (!data) return;
  const dir = path.dirname(getStorePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2));
}

export const store = {
  get(key: string, defaultValue?: unknown): unknown {
    const d = load();
    return key in d ? d[key] : defaultValue;
  },
  set(key: string, value: unknown): void {
    const d = load();
    (d as Record<string, unknown>)[key] = value;
    save();
  }
};
