import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  terminal: {
    spawn: (command?: string, cwd?: string) =>
      ipcRenderer.invoke('terminal:spawn', { command, cwd }),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string, data: string) =>
        callback(id, data);
      ipcRenderer.on('terminal:data', handler);
      return () => {
        ipcRenderer.removeListener('terminal:data', handler);
      };
    },
    onExit: (callback: (id: string, code: number) => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string, code: number) =>
        callback(id, code);
      ipcRenderer.on('terminal:exit', handler);
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler);
      };
    },
    openExternal: (command: string, cwd?: string) =>
      ipcRenderer.invoke('terminal:open-external', { command, cwd }),
    launchAgent: (ticketId: string, agent: 'claude' | 'codex', cwd?: string, agentToken?: string) =>
      ipcRenderer.invoke('terminal:launch-agent', { ticketId, agent, cwd, agentToken }),
    chooseDirectory: () => ipcRenderer.invoke('terminal:choose-directory')
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
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', { title, body })
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
  isElectron: true as const
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
