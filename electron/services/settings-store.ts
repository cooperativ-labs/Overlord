import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type TerminalMode = 'embedded' | 'external';
export type ExternalTerminalApp = 'default' | 'terminal' | 'iterm' | 'warp';
export type ExternalTerminalLaunchMode = 'window' | 'tab';

interface StoreData {
  terminalMode: TerminalMode;
  externalTerminalApp: ExternalTerminalApp;
  externalTerminalLaunchMode: ExternalTerminalLaunchMode;
  windowBounds: { width: number; height: number; x?: number; y?: number };
  [key: string]: unknown;
}

const defaults: StoreData = {
  terminalMode: 'embedded',
  externalTerminalApp: 'default',
  externalTerminalLaunchMode: 'window',
  windowBounds: { width: 1400, height: 900 }
};

let data: StoreData | null = null;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load(): StoreData {
  if (data) return data;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    data = { ...defaults, ...JSON.parse(raw) };
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
