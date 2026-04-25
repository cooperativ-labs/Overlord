import { contextBridge, ipcRenderer } from 'electron';

type SshAuthMethod = 'agent' | 'key' | 'tailscale';
type SshConnectionConfig = {
  host: string;
  port?: number;
  user: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  passphrase?: string;
};

type WorkspacePayload = {
  mode?: 'local' | 'remote';
  directory?: string;
  remoteDirectory?: string;
  ssh?: SshConnectionConfig;
  projectId?: string;
};

type ListFilesOptions = {
  maxDepth?: number;
  maxEntriesPerDirectory?: number;
  maxFiles?: number;
};

const electronAPI = {
  terminal: {
    launchAgent: (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
      cwd?: string,
      launchMode?: 'run' | 'ask',
      flags?: string[],
      model?: string,
      thinking?: string,
      sshCommand?: string,
      remoteWorkingDirectory?: string
    ) =>
      ipcRenderer.invoke('terminal:launch-agent', {
        ticketId,
        agent,
        cwd,
        launchMode,
        flags,
        model,
        thinking,
        sshCommand,
        remoteWorkingDirectory
      }),
    chooseDirectory: () => ipcRenderer.invoke('terminal:choose-directory')
  },
  filesystem: {
    directoryExists: (options?: WorkspacePayload) =>
      ipcRenderer.invoke('filesystem:directory-exists', options),
    listProjectFiles: (options?: WorkspacePayload & { options?: ListFilesOptions }) =>
      ipcRenderer.invoke('filesystem:list-project-files', options),
    checkSshConnection: (options: WorkspacePayload) =>
      ipcRenderer.invoke('filesystem:check-ssh-connection', options),
    getGitStatus: (options?: WorkspacePayload) =>
      ipcRenderer.invoke('filesystem:get-git-status', options),
    getGitDiff: (
      options?: WorkspacePayload & {
        originalPath?: string;
        path?: string;
        status?: string;
      }
    ) => ipcRenderer.invoke('filesystem:get-git-diff', options),
    getAggregateDiff: (options?: WorkspacePayload) =>
      ipcRenderer.invoke('filesystem:get-aggregate-diff', options),
    getGitBranches: (options?: WorkspacePayload) =>
      ipcRenderer.invoke('filesystem:get-git-branches', options),
    gitCheckoutBranch: (options: WorkspacePayload & { options: { name: string } }) =>
      ipcRenderer.invoke('filesystem:git-checkout-branch', options),
    gitCreateBranch: (options: WorkspacePayload & { options: { name: string } }) =>
      ipcRenderer.invoke('filesystem:git-create-branch', options),
    gitPull: (options?: WorkspacePayload) => ipcRenderer.invoke('filesystem:git-pull', options),
    gitPush: (options?: WorkspacePayload) => ipcRenderer.invoke('filesystem:git-push', options),
    gitCommitAndPush: (options: WorkspacePayload & { message: string }) =>
      ipcRenderer.invoke('filesystem:git-commit-and-push', options),
    gitCreatePullRequest: (
      options: WorkspacePayload & {
        options: {
          baseBranch?: string;
          body: string;
          title: string;
        };
      }
    ) => ipcRenderer.invoke('filesystem:git-create-pull-request', options),
    readFile: (options: WorkspacePayload & { path: string; maxBytes?: number }) =>
      ipcRenderer.invoke('filesystem:read-file', options)
  },
  remoteHelper: {
    install: (payload: { projectId: string; ssh: SshConnectionConfig }) =>
      ipcRenderer.invoke('remote-install:install', payload),
    status: (payload: { projectId: string }) => ipcRenderer.invoke('remote-install:status', payload)
  },
  tailscale: {
    getStatus: () => ipcRenderer.invoke('tailscale:status')
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
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', { title, body }),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    revealFile: (filePath: string) => ipcRenderer.invoke('app:reveal-file', filePath),
    reload: () => ipcRenderer.invoke('app:reload'),
    captureSentryTestEvent: () => ipcRenderer.invoke('app:capture-sentry-test-event')
  },
  cli: {
    getInstallStatus: () => ipcRenderer.invoke('cli:get-install-status'),
    install: () => ipcRenderer.invoke('cli:install')
  },
  overlordPlugin: {
    getStatus: () => ipcRenderer.invoke('overlord-plugin:get-status'),
    install: () => ipcRenderer.invoke('overlord-plugin:install'),
    repair: () => ipcRenderer.invoke('overlord-plugin:repair'),
    uninstall: () => ipcRenderer.invoke('overlord-plugin:uninstall')
  },
  agentBundle: {
    getAllStatuses: () => ipcRenderer.invoke('agent-bundle:get-all-statuses'),
    getStatus: (agent: 'claude' | 'cursor' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:get-status', agent),
    install: (agent: 'claude' | 'cursor' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:install', agent),
    installAll: () => ipcRenderer.invoke('agent-bundle:install-all'),
    repair: (agent: 'claude' | 'cursor' | 'opencode') =>
      ipcRenderer.invoke('agent-bundle:repair', agent),
    uninstall: (agent: 'claude' | 'cursor' | 'opencode') =>
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
        session: { access_token: string };
      }>,
    logout: () => ipcRenderer.invoke('auth:logout'),
    getStatus: () =>
      ipcRenderer.invoke('auth:getStatus') as Promise<{
        isAuthenticated: boolean;
        platformUrl: string | null;
      }>,
    getAccessToken: () =>
      ipcRenderer.invoke('auth:getAccessToken') as Promise<{
        ok: boolean;
        accessToken?: string;
        accessTokenExpiresAt?: string | null;
        error?: string;
      }>,
    forceRefresh: () =>
      ipcRenderer.invoke('auth:forceRefresh') as Promise<{
        ok: boolean;
        accessToken?: string;
        accessTokenExpiresAt?: string | null;
        error?: string;
      }>,
    // Refresh session via the OAuth token endpoint (not the standard GoTrue endpoint).
    // Required because OAuth-issued refresh tokens are not accepted by /auth/v1/token.
    refreshSession: () =>
      ipcRenderer.invoke('auth:refreshSession') as Promise<{
        ok: boolean;
        session?: { access_token: string };
        error?: string;
      }>
  },
  isElectron: true as const
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
