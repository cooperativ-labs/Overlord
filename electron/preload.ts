import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  terminal: {
    launchAgent: (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini',
      cwd?: string,
      agentToken?: string,
      launchMode?: 'run' | 'ask',
      flags?: string[]
    ) =>
      ipcRenderer.invoke('terminal:launch-agent', {
        ticketId,
        agent,
        cwd,
        agentToken,
        launchMode,
        flags
      }),
    chooseDirectory: () => ipcRenderer.invoke('terminal:choose-directory')
  },
  filesystem: {
    directoryExists: (directory?: string) =>
      ipcRenderer.invoke('filesystem:directory-exists', directory),
    listProjectFiles: (options?: {
      directory?: string;
      maxDepth?: number;
      maxEntriesPerDirectory?: number;
      maxFiles?: number;
    }) => ipcRenderer.invoke('filesystem:list-project-files', options),
    getGitStatus: (options?: { directory?: string }) =>
      ipcRenderer.invoke('filesystem:get-git-status', options),
    getGitDiff: (options?: {
      directory?: string;
      originalPath?: string;
      path?: string;
      status?: string;
    }) => ipcRenderer.invoke('filesystem:get-git-diff', options)
  },
  supabase: {
    getStatus: () => ipcRenderer.invoke('supabase:status'),
    restart: () => ipcRenderer.invoke('supabase:restart')
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  app: {
    getPlatformUrl: () => ipcRenderer.invoke('app:get-platform-url'),
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', { title, body })
  },
  cli: {
    getInstallStatus: () => ipcRenderer.invoke('cli:get-install-status'),
    install: () => ipcRenderer.invoke('cli:install')
  },
  appUpdate: {
    getStatus: () => ipcRenderer.invoke('app-update:get-status'),
    checkForUpdates: () => ipcRenderer.invoke('app-update:check'),
    downloadUpdate: () => ipcRenderer.invoke('app-update:download'),
    quitAndInstall: () => ipcRenderer.invoke('app-update:quit-and-install'),
    onStatus: (callback: (status: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on('app-update:status', handler);
      return () => {
        ipcRenderer.removeListener('app-update:status', handler);
      };
    }
  },
  auth: {
    login: () =>
      ipcRenderer.invoke('auth:login') as Promise<{
        ok: true;
        session: { access_token: string; refresh_token: string };
      }>,
    logout: () => ipcRenderer.invoke('auth:logout'),
    getStatus: () =>
      ipcRenderer.invoke('auth:getStatus') as Promise<{
        isAuthenticated: boolean;
        platformUrl: string | null;
        supabaseRefreshToken: string | null;
      }>,
    saveRefreshToken: (token: string) =>
      ipcRenderer.invoke('auth:saveRefreshToken', token) as Promise<{ ok: true }>,
    // Refresh session via the OAuth token endpoint (not the standard GoTrue endpoint).
    // Required because OAuth-issued refresh tokens are not accepted by /auth/v1/token.
    refreshSession: () =>
      ipcRenderer.invoke('auth:refreshSession') as Promise<{
        ok: boolean;
        session?: { access_token: string; refresh_token: string };
        error?: string;
      }>
  },
  isElectron: true as const
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
