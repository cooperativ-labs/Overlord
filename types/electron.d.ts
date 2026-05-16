import type { LaunchAgentType } from '@/lib/helpers/agent-types';

type RepoWorkspaceManager = 'yarn' | 'npm' | 'pnpm' | 'bun';
type RepoDeployableKind =
  | 'nextjs-app'
  | 'expo-app'
  | 'electron-app'
  | 'edge-function'
  | 'vercel-project'
  | 'cloudflare-worker'
  | 'static-site'
  | 'cli'
  | 'library';
type RepoDeployTarget = 'vercel' | 'supabase' | 'eas' | 'testflight' | 'cloudflare';

interface RepoOperationsProfile {
  schema_version: 1;
  workspaces: Array<{
    path: string;
    name: string;
    manager: RepoWorkspaceManager | null;
    has_lockfile: boolean;
  }>;
  deployables: Array<{
    kind: RepoDeployableKind;
    path: string;
    name: string;
    deploy_target?: RepoDeployTarget;
  }>;
  migrations: {
    system: 'supabase' | 'prisma' | 'drizzle' | 'knex' | 'flyway' | null;
    migrations_dir: string | null;
    types_output: string | null;
    seed_files: string[];
    generate_command: string | null;
    seed_sync_command: string | null;
  } | null;
  codegen: Array<{
    name: string;
    triggers: string[];
    outputs: string[];
    command: string | null;
  }>;
  tests: {
    runner: 'jest' | 'vitest' | 'playwright' | 'cypress' | 'detox' | null;
    config_files: string[];
    test_dirs: string[];
    script: string | null;
  } | null;
  manifests: Array<{ path: string; lockfile: string | null }>;
  scripts_by_workspace: Record<string, Record<string, string>>;
  signals: {
    has_dockerfile: boolean;
    has_docker_compose: boolean;
    has_github_actions: boolean;
    has_eas_json: boolean;
    has_app_store_config: boolean;
    has_env_example: boolean;
    env_example_paths: string[];
  };
}

interface WorkspacePayload {
  directory?: string;
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

export type LaunchTerminalAgentParams = {
  ticketId: string;
  agent: LaunchAgentType;
  organizationId?: number;
  cwd?: string;
  launchMode?: 'run' | 'ask';
  flags?: string[];
  model?: string;
  thinking?: string;
  projectId?: string | null;
  feedPostId?: string;
  initialQuestion?: string;
};

interface ElectronAPI {
  terminal: {
    launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
    openHomebrewJjInstall: () => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  filesystem: {
    getGitBranches: (options?: WorkspacePayload) => Promise<{
      branches: Array<{
        current: boolean;
        name: string;
        upstream: string | null;
      }>;
      currentBranch: string | null;
      defaultBranch: string | null;
      repoRoot: string | null;
      error?: string;
    }>;
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
    getAggregateDiff: (options?: WorkspacePayload) => Promise<{
      branch: string | null;
      diff: string;
      filesChanged: number;
      repoRoot: string | null;
      status: string;
      error?: string;
    }>;
    createCheckpoint: (options: { directory: string; objectiveId: string }) => Promise<
      | {
          ok: true;
          workspacePath: string;
          objectiveId: string;
          ref: string;
          gitCommitId: string;
          headSha: string;
          diffStat: string | null;
        }
      | { ok: false; error: string }
    >;
    restoreCheckpoint: (options: { directory: string; objectiveId: string }) => Promise<
      | {
          ok: true;
          ref: string;
          gitCommitId: string;
          safetyRef: string | null;
          safetySha: string | null;
        }
      | { ok: false; error: string }
    >;
    diffCheckpoint: (options: {
      directory: string;
      objectiveId?: string;
      gitCommitId?: string;
    }) => Promise<
      | {
          ok: true;
          ref: string | null;
          gitCommitId: string;
          parentSha: string | null;
          headSha: string;
          diff: string;
          diffStat: string | null;
        }
      | { ok: false; error: string }
    >;
    pruneCheckpoints: (options: {
      directory: string;
      keepObjectiveIds?: string[];
      objectiveIds?: string[];
    }) => Promise<
      | {
          ok: true;
          pruned: string[];
        }
      | { ok: false; error: string }
    >;
    listSafetyRefs: (options: { directory: string }) => Promise<
      | {
          ok: true;
          refs: Array<{
            ref: string;
            gitCommitId: string;
            createdAt: string | null;
          }>;
        }
      | { ok: false; error: string }
    >;
    restoreSafetyRef: (options: { directory: string; ref: string }) => Promise<
      | {
          ok: true;
          ref: string;
          gitCommitId: string;
          safetyRef: string | null;
          safetySha: string | null;
        }
      | { ok: false; error: string }
    >;
    gitCheckoutBranch: (
      options: WorkspacePayload & {
        options: { name: string };
      }
    ) => Promise<{
      ok: boolean;
      branch: string | null;
      error?: string;
    }>;
    gitCreateBranch: (
      options: WorkspacePayload & {
        options: { name: string };
      }
    ) => Promise<{
      ok: boolean;
      branch: string | null;
      error?: string;
    }>;
    gitPull: (options?: WorkspacePayload) => Promise<{
      ok: boolean;
      branch: string | null;
      output: string;
      error?: string;
    }>;
    gitPush: (options?: WorkspacePayload) => Promise<{
      ok: boolean;
      branch: string | null;
      pushed: boolean;
      output: string;
      error?: string;
    }>;
    gitCommitAndPush: (options: WorkspacePayload & { message: string }) => Promise<{
      ok: boolean;
      branch: string | null;
      commitSha: string | null;
      pushed: boolean;
      error?: string;
    }>;
    gitCreatePullRequest: (
      options: WorkspacePayload & {
        options: {
          baseBranch?: string;
          body: string;
          title: string;
        };
      }
    ) => Promise<{
      ok: boolean;
      branch: string | null;
      number: number | null;
      url: string | null;
      error?: string;
    }>;
    readFile: (options: WorkspacePayload & { path: string; maxBytes?: number }) => Promise<{
      content: string;
      path: string;
      truncated: boolean;
      error?: string;
    }>;
    rebuildOperationsProfile: (options: {
      directory: string;
      currentFingerprint?: string | null;
    }) => Promise<
      | { ok: true; rebuilt: boolean; fingerprint: string; profile: RepoOperationsProfile }
      | { ok: false; error: string }
    >;
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
  feedWindow: {
    open: () => Promise<boolean>;
  };
  quickTask: {
    getHotkey: () => Promise<{ accelerator: string; defaultAccelerator: string }>;
    setHotkey: (
      accelerator: string
    ) => Promise<{ ok: boolean; accelerator: string; error?: string }>;
    close: () => Promise<unknown>;
    setHeight: (height: number) => Promise<unknown>;
    setBounds: (args: { height: number; barOffsetTop: number }) => Promise<unknown>;
    onShown: (cb: () => void) => () => void;
  };
  app: {
    getConnectorUrl: () => Promise<string>;
    getPlatformUrl: () => Promise<string>;
    getHostMetadata: () => Promise<{ hostname: string; platform: string }>;
    getDeviceIdentity: () => Promise<{
      deviceFingerprint: string;
      hostname: string;
      platform: string;
    }>;
    notify: (title: string, body: string) => Promise<boolean>;
    openExternal: (url: string) => Promise<boolean>;
    revealFile: (filePath: string) => Promise<string>;
    reload: () => Promise<boolean>;
    navigateMain: (targetPath: string) => Promise<boolean>;
    onNavigate: (callback: (path: string) => void) => () => void;
    captureSentryTestEvent: () => Promise<{
      ok: boolean;
      eventId?: string;
    }>;
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
    login: () => Promise<{ ok: true; session: { access_token: string } }>;
    logout: () => Promise<{ ok: true }>;
    getStatus: () => Promise<{
      isAuthenticated: boolean;
      platformUrl: string | null;
    }>;
    getAccessToken: () => Promise<{
      ok: boolean;
      accessToken?: string;
      accessTokenExpiresAt?: string | null;
      error?: string;
    }>;
    forceRefresh: () => Promise<{
      ok: boolean;
      accessToken?: string;
      accessTokenExpiresAt?: string | null;
      error?: string;
    }>;
    refreshSession: () => Promise<{
      ok: boolean;
      session?: { access_token: string };
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
