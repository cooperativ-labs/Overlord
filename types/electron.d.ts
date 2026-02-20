interface ElectronAPI {
  terminal: {
    spawn: (command?: string, cwd?: string) => Promise<string>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => Promise<void>;
    onData: (callback: (id: string, data: string) => void) => () => void;
    onExit: (callback: (id: string, code: number) => void) => () => void;
    openExternal: (command: string, cwd?: string) => Promise<void>;
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
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
