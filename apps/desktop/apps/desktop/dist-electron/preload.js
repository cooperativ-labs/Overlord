"use strict";

// electron/preload.ts
var import_electron = require("electron");
var electronAPI = {
  terminal: {
    launchAgent: (params) => import_electron.ipcRenderer.invoke("terminal:launch-agent", params),
    chooseDirectory: () => import_electron.ipcRenderer.invoke("terminal:choose-directory"),
    openHomebrewJjInstall: () => import_electron.ipcRenderer.invoke("terminal:open-homebrew-jj-install")
  },
  filesystem: {
    directoryExists: (options) => import_electron.ipcRenderer.invoke("filesystem:directory-exists", options),
    listProjectFiles: (options) => import_electron.ipcRenderer.invoke("filesystem:list-project-files", options),
    checkSshConnection: (options) => import_electron.ipcRenderer.invoke("filesystem:check-ssh-connection", options),
    getGitStatus: (options) => import_electron.ipcRenderer.invoke("filesystem:get-git-status", options),
    getGitDiff: (options) => import_electron.ipcRenderer.invoke("filesystem:get-git-diff", options),
    getAggregateDiff: (options) => import_electron.ipcRenderer.invoke("filesystem:get-aggregate-diff", options),
    createCheckpoint: (options) => import_electron.ipcRenderer.invoke("filesystem:create-checkpoint", options),
    restoreCheckpoint: (options) => import_electron.ipcRenderer.invoke("filesystem:restore-checkpoint", options),
    getGitBranches: (options) => import_electron.ipcRenderer.invoke("filesystem:get-git-branches", options),
    gitCheckoutBranch: (options) => import_electron.ipcRenderer.invoke("filesystem:git-checkout-branch", options),
    gitCreateBranch: (options) => import_electron.ipcRenderer.invoke("filesystem:git-create-branch", options),
    gitPull: (options) => import_electron.ipcRenderer.invoke("filesystem:git-pull", options),
    gitPush: (options) => import_electron.ipcRenderer.invoke("filesystem:git-push", options),
    gitCommitAndPush: (options) => import_electron.ipcRenderer.invoke("filesystem:git-commit-and-push", options),
    gitCreatePullRequest: (options) => import_electron.ipcRenderer.invoke("filesystem:git-create-pull-request", options),
    readFile: (options) => import_electron.ipcRenderer.invoke("filesystem:read-file", options),
    rebuildOperationsProfile: (options) => import_electron.ipcRenderer.invoke("filesystem:rebuild-operations-profile", options)
  },
  remoteHelper: {
    install: (payload) => import_electron.ipcRenderer.invoke("remote-install:install", payload),
    status: (payload) => import_electron.ipcRenderer.invoke("remote-install:status", payload)
  },
  tailscale: {
    getStatus: () => import_electron.ipcRenderer.invoke("tailscale:status")
  },
  supabase: {
    getStatus: () => import_electron.ipcRenderer.invoke("supabase:status"),
    restart: () => import_electron.ipcRenderer.invoke("supabase:restart")
  },
  settings: {
    get: (key) => import_electron.ipcRenderer.invoke("settings:get", key),
    set: (key, value) => import_electron.ipcRenderer.invoke("settings:set", key, value)
  },
  app: {
    getConnectorUrl: () => import_electron.ipcRenderer.invoke("app:get-connector-url"),
    getPlatformUrl: () => import_electron.ipcRenderer.invoke("app:get-platform-url"),
    notify: (title, body) => import_electron.ipcRenderer.invoke("app:notify", { title, body }),
    openExternal: (url) => import_electron.ipcRenderer.invoke("app:open-external", url),
    revealFile: (filePath) => import_electron.ipcRenderer.invoke("app:reveal-file", filePath),
    reload: () => import_electron.ipcRenderer.invoke("app:reload"),
    navigateMain: (targetPath) => import_electron.ipcRenderer.invoke("app:navigate-main", targetPath),
    onNavigate: (callback) => {
      const handler = (_, path) => callback(path);
      import_electron.ipcRenderer.on("app:navigate", handler);
      return () => {
        import_electron.ipcRenderer.removeListener("app:navigate", handler);
      };
    },
    captureSentryTestEvent: () => import_electron.ipcRenderer.invoke("app:capture-sentry-test-event")
  },
  cli: {
    getInstallStatus: () => import_electron.ipcRenderer.invoke("cli:get-install-status"),
    install: () => import_electron.ipcRenderer.invoke("cli:install")
  },
  overlordPlugin: {
    getStatus: () => import_electron.ipcRenderer.invoke("overlord-plugin:get-status"),
    install: () => import_electron.ipcRenderer.invoke("overlord-plugin:install"),
    repair: () => import_electron.ipcRenderer.invoke("overlord-plugin:repair"),
    uninstall: () => import_electron.ipcRenderer.invoke("overlord-plugin:uninstall")
  },
  agentBundle: {
    getAllStatuses: () => import_electron.ipcRenderer.invoke("agent-bundle:get-all-statuses"),
    getStatus: (agent) => import_electron.ipcRenderer.invoke("agent-bundle:get-status", agent),
    install: (agent) => import_electron.ipcRenderer.invoke("agent-bundle:install", agent),
    installAll: () => import_electron.ipcRenderer.invoke("agent-bundle:install-all"),
    repair: (agent) => import_electron.ipcRenderer.invoke("agent-bundle:repair", agent),
    uninstall: (agent) => import_electron.ipcRenderer.invoke("agent-bundle:uninstall", agent)
  },
  agentSlash: {
    getAllStatuses: () => import_electron.ipcRenderer.invoke("agent-slash:get-all-statuses"),
    getStatus: (agent) => import_electron.ipcRenderer.invoke("agent-slash:get-status", agent),
    install: (agent) => import_electron.ipcRenderer.invoke("agent-slash:install", agent),
    uninstall: (agent) => import_electron.ipcRenderer.invoke("agent-slash:uninstall", agent)
  },
  agentPermissions: {
    configure: (options) => import_electron.ipcRenderer.invoke("agent-permissions:configure", options)
  },
  feedWindow: {
    open: () => import_electron.ipcRenderer.invoke("feed-window:open")
  },
  quickTask: {
    getHotkey: () => import_electron.ipcRenderer.invoke("quick-task:get-hotkey"),
    setHotkey: (accelerator) => import_electron.ipcRenderer.invoke("quick-task:set-hotkey", accelerator),
    close: () => import_electron.ipcRenderer.invoke("quick-task:close"),
    setHeight: (height) => import_electron.ipcRenderer.invoke("quick-task:set-height", height),
    setBounds: (args) => import_electron.ipcRenderer.invoke("quick-task:set-bounds", args),
    onShown: (callback) => {
      const handler = () => callback();
      import_electron.ipcRenderer.on("quick-task:shown", handler);
      return () => {
        import_electron.ipcRenderer.removeListener("quick-task:shown", handler);
      };
    }
  },
  appUpdate: {
    getStatus: () => import_electron.ipcRenderer.invoke("app-update:get-status"),
    checkForUpdates: () => import_electron.ipcRenderer.invoke("app-update:check"),
    downloadUpdate: () => import_electron.ipcRenderer.invoke("app-update:download"),
    quitAndInstall: () => import_electron.ipcRenderer.invoke("app-update:quit-and-install"),
    onStatus: (callback) => {
      const handler = (_, status) => callback(status);
      import_electron.ipcRenderer.on("app-update:status", handler);
      return () => {
        import_electron.ipcRenderer.removeListener("app-update:status", handler);
      };
    }
  },
  auth: {
    login: () => import_electron.ipcRenderer.invoke("auth:login"),
    logout: () => import_electron.ipcRenderer.invoke("auth:logout"),
    getStatus: () => import_electron.ipcRenderer.invoke("auth:getStatus"),
    getAccessToken: () => import_electron.ipcRenderer.invoke("auth:getAccessToken"),
    forceRefresh: () => import_electron.ipcRenderer.invoke("auth:forceRefresh"),
    // Refresh session via the OAuth token endpoint (not the standard GoTrue endpoint).
    // Required because OAuth-issued refresh tokens are not accepted by /auth/v1/token.
    refreshSession: () => import_electron.ipcRenderer.invoke("auth:refreshSession")
  },
  isElectron: true
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
//# sourceMappingURL=preload.js.map
