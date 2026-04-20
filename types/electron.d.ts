type SshAuthMethod = 'agent' | 'key' | 'tailscale';

interface SshConnectionConfig {
  host: string;
  port?: number;
  user: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  passphrase?: string;
}

interface WorkspacePayload {
  mode?: 'local' | 'remote';
  directory?: string;
  remoteDirectory?: string;
  ssh?: SshConnectionConfig;
  projectId?: string;
}

interface TailscaleStatusResult {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  selfName: string | null;
  tailnet: string | null;
  error?: string;
}

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
      agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
      cwd?: string,
      agentToken?: string,
      launchMode?: 'run' | 'ask',
      flags?: string[],
      model?: string,
      thinking?: string,
      sshCommand?: string,
      remoteWorkingDirectory?: string
    ) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  filesystem: {
    getGitDiff: (
      options?: WorkspacePayload & {
        originalPath?: string;
        path?: string;
        status?: string;
      }
    ) => Promise<{
      diff: string;
      error?: string;
      path: string | null;
      repoRoot: string | null;
      status: string | null;
    }>;
    getGitStatus: (options?: WorkspacePayload) => Promise<{
      branch: string | null;
      error?: string;
      files: Array<{
        linesAdded?: number | null;
        linesRemoved?: number | null;
        originalPath?: string | null;
        path: string;
        stagedStatus: string;
        status: string;
        unstagedStatus: string;
      }>;
      linkedDirectory: string | null;
      repoRoot: string | null;
    }>;
    directoryExists: (options?: WorkspacePayload) => Promise<boolean>;
    listProjectFiles: (
      options?: WorkspacePayload & {
        options?: {
          maxDepth?: number;
          maxEntriesPerDirectory?: number;
          maxFiles?: number;
        };
      }
    ) => Promise<{
      files: string[];
      linkedDirectory: string | null;
      truncated: boolean;
      error?: string;
    }>;
    checkSshConnection: (options: WorkspacePayload) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    getAggregateDiff: (options?: WorkspacePayload) => Promise<{
      branch: string | null;
      diff: string;
      filesChanged: number;
      repoRoot: string | null;
      status: string;
      error?: string;
    }>;
    gitCommitAndPush: (options: WorkspacePayload & { message: string }) => Promise<{
      ok: boolean;
      branch: string | null;
      commitSha: string | null;
      pushed: boolean;
      error?: string;
    }>;
    readFile: (options: WorkspacePayload & { path: string; maxBytes?: number }) => Promise<{
      content: string;
      path: string;
      truncated: boolean;
      error?: string;
    }>;
  };
  remoteHelper: {
    install: (payload: {
      projectId: string;
      ssh: SshConnectionConfig;
    }) => Promise<{
      ok: boolean;
      token?: string;
      serverPath?: string;
      nodeBin?: string;
      error?: string;
    }>;
    status: (payload: { projectId: string }) => Promise<{ installed: boolean }>;
  };
  tailscale: {
    getStatus: () => Promise<TailscaleStatusResult>;
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
    getConnectorUrl: () => Promise<string>;
    getPlatformUrl: () => Promise<string>;
    notify: (title: string, body: string) => Promise<boolean>;
    openExternal: (url: string) => Promise<boolean>;
    revealFile: (filePath: string) => Promise<string>;
    reload: () => Promise<boolean>;
  };
  cli?: {
    getInstallStatus: () => Promise<{
      installed: boolean;
      installPath?: string;
      isStale?: boolean;
      version: string;
      installedVersion?: string | null;
      latestVersion?: string | null;
      updateAvailable?: boolean;
    }>;
    install: () => Promise<
      { ok: true; installPath: string; pathInstruction: string } | { ok: false; error: string }
    >;
  };
  overlordPlugin?: {
    getStatus: () => Promise<{
      status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
      version: string | null;
      installedVersion: string | null;
      details: string;
      currentContentHash: string;
      managedFiles: string[];
      existingManagedFiles: string[];
      missingManagedFiles: string[];
    }>;
    install: () => Promise<{ ok: boolean; installedFiles: string[]; error?: string }>;
    repair: () => Promise<{ ok: boolean; installedFiles: string[]; error?: string }>;
    uninstall: () => Promise<{ ok: boolean; removedFiles: string[]; error?: string }>;
  };
  agentBundle?: {
    getAllStatuses: () => Promise<
      Array<{
        agent: 'claude' | 'cursor' | 'opencode';
        status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
        version: string | null;
        installedVersion: string | null;
        details: string;
        currentContentHash: string;
      }>
    >;
    getStatus: (agent: 'claude' | 'cursor' | 'opencode') => Promise<{
      agent: 'claude' | 'cursor' | 'opencode';
      status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
      version: string | null;
      installedVersion: string | null;
      details: string;
      currentContentHash: string;
    }>;
    install: (agent: 'claude' | 'cursor' | 'opencode') => Promise<{
      ok: boolean;
      agent: 'claude' | 'cursor' | 'opencode';
      backups: string[];
      error?: string;
    }>;
    installAll: () => Promise<
      Array<{
        ok: boolean;
        agent: 'claude' | 'cursor' | 'opencode';
        backups: string[];
        error?: string;
      }>
    >;
    repair: (agent: 'claude' | 'cursor' | 'opencode') => Promise<{
      ok: boolean;
      agent: 'claude' | 'cursor' | 'opencode';
      backups: string[];
      error?: string;
    }>;
    uninstall: (
      agent: 'claude' | 'cursor' | 'opencode'
    ) => Promise<{ ok: boolean; error?: string }>;
  };
  agentSlash?: {
    getAllStatuses: () => Promise<
      Array<{
        agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
        status: 'installed' | 'partial' | 'not_installed';
        details: string;
        managedFiles: string[];
        existingManagedFiles: string[];
        missingManagedFiles: string[];
      }>
    >;
    getStatus: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') => Promise<{
      agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
      status: 'installed' | 'partial' | 'not_installed';
      details: string;
      managedFiles: string[];
      existingManagedFiles: string[];
      missingManagedFiles: string[];
    }>;
    install: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') => Promise<{
      ok: boolean;
      agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
      managedFiles: string[];
      backups: string[];
      error?: string;
    }>;
    uninstall: (agent: 'claude' | 'cursor' | 'gemini' | 'opencode') => Promise<{
      ok: boolean;
      agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
      removedFiles: string[];
      error?: string;
    }>;
  };
  agentPermissions?: {
    configure: (options?: { projectDirectory?: string }) => Promise<{
      ok: boolean;
      results: Array<{
        agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
        ok: boolean;
        filePath: string;
        details: string;
        backups: string[];
        error?: string;
      }>;
    }>;
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
    checkAgentToken: () => Promise<{
      valid: boolean;
      reason?: string;
    }>;
    refreshAgentToken: () => Promise<{
      ok: boolean;
      agentToken?: string;
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
