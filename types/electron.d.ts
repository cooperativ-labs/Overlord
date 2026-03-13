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
    launchAgent: (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini',
      cwd?: string,
      agentToken?: string,
      launchMode?: 'run' | 'ask',
      flags?: string[]
    ) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  filesystem: {
    getGitDiff: (options?: {
      directory?: string;
      originalPath?: string;
      path?: string;
      status?: string;
    }) => Promise<{
      diff: string;
      error?: string;
      path: string | null;
      repoRoot: string | null;
      status: string | null;
    }>;
    getGitStatus: (options?: { directory?: string }) => Promise<{
      branch: string | null;
      error?: string;
      files: Array<{
        originalPath?: string | null;
        path: string;
        stagedStatus: string;
        status: string;
        unstagedStatus: string;
      }>;
      linkedDirectory: string | null;
      repoRoot: string | null;
    }>;
    directoryExists: (directory?: string) => Promise<boolean>;
    listProjectFiles: (options?: {
      directory?: string;
      maxDepth?: number;
      maxEntriesPerDirectory?: number;
      maxFiles?: number;
    }) => Promise<{
      files: string[];
      linkedDirectory: string | null;
      truncated: boolean;
      error?: string;
    }>;
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
    getStatus: () => Promise<{
      isAuthenticated: boolean;
      platformUrl: string | null;
      supabaseRefreshToken: string | null;
    }>;
    saveRefreshToken: (token: string) => Promise<{ ok: true }>;
    refreshSession: () => Promise<{
      ok: boolean;
      session?: { access_token: string; refresh_token: string };
      error?: string;
    }>;
  };
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
