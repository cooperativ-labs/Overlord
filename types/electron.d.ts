type AppUpdatePhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface AppUpdateStatus {
  phase: AppUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
}

interface ElectronAPI {
  terminal: {
    spawn: (command?: string, cwd?: string) => Promise<string>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => Promise<void>;
    onData: (callback: (id: string, data: string) => void) => () => void;
    onExit: (callback: (id: string, code: number) => void) => () => void;
    openExternal: (command: string, cwd?: string) => Promise<void>;
    launchAgent: (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini',
      cwd?: string,
      agentToken?: string,
      launchMode?: 'run' | 'ask'
    ) => Promise<string | void>;
    chooseDirectory: () => Promise<string | null>;
  };
  supabase: {
    getStatus: () => Promise<{ running: boolean; url: string }>;
    restart: () => Promise<void>;
  };
  settings: {
    get: <T = unknown>(key: string) => Promise<T>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  app: {
    getPlatformUrl: () => Promise<string>;
    notify: (title: string, body: string) => Promise<boolean>;
  };
  cli?: {
    getInstallStatus: () => Promise<{
      installed: boolean;
      installPath?: string;
      isStale?: boolean;
      version: string;
    }>;
    install: () => Promise<
      { ok: true; installPath: string; pathInstruction: string } | { ok: false; error: string }
    >;
  };
  appUpdate: {
    getStatus: () => Promise<AppUpdateStatus>;
    checkForUpdates: () => Promise<boolean>;
    downloadUpdate: () => Promise<boolean>;
    quitAndInstall: () => Promise<boolean>;
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void;
  };
  auth: {
    login: () => Promise<{ ok: true; session: { access_token: string; refresh_token: string } }>;
    logout: () => Promise<{ ok: true }>;
    getStatus: () => Promise<{ isAuthenticated: boolean; platformUrl: string | null }>;
  };
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
