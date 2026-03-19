import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  terminal: {
    launchAgent: (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
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
    getConnectorUrl: () => ipcRenderer.invoke('app:get-connector-url'),
    getPlatformUrl: () => ipcRenderer.invoke('app:get-platform-url'),
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', { title, body })
  },
  cli: {
    getInstallStatus: () => ipcRenderer.invoke('cli:get-install-status'),
    install: () => ipcRenderer.invoke('cli:install')
  },
  agentBundle: {
    getAllStatuses: () => ipcRenderer.invoke('agent-bundle:get-all-statuses'),
    getStatus: (agent: 'claude' | 'codex' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:get-status', agent),
    install: (agent: 'claude' | 'codex' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:install', agent),
    installAll: () => ipcRenderer.invoke('agent-bundle:install-all'),
    repair: (agent: 'claude' | 'codex' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:repair', agent),
    uninstall: (agent: 'claude' | 'codex' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:uninstall', agent)
  },
  agentSlash: {
    getAllStatuses: () => ipcRenderer.invoke('agent-slash:get-all-statuses'),
    getStatus: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') =>
      ipcRenderer.invoke('agent-slash:get-status', agent),
    install: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') =>
      ipcRenderer.invoke('agent-slash:install', agent),
    uninstall: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') =>
      ipcRenderer.invoke('agent-slash:uninstall', agent)
  },
  agentPermissions: {
    configure: (options?: { projectDirectory?: string }) =>
      ipcRenderer.invoke('agent-permissions:configure', options)
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
      }>,
    // Check if the stored agent token is still valid (not revoked/expired).
    checkAgentToken: () =>
      ipcRenderer.invoke('auth:checkAgentToken') as Promise<{
        valid: boolean;
        reason?: string;
      }>,
    // Re-exchange Supabase session for a fresh agent token when the current one is stale.
    refreshAgentToken: () =>
      ipcRenderer.invoke('auth:refreshAgentToken') as Promise<{
        ok: boolean;
        agentToken?: string;
        error?: string;
      }>
  },
  isElectron: true as const
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
