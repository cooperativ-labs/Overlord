import Store from 'electron-store';

export type TerminalMode = 'embedded' | 'external';
export type ExternalTerminalApp = 'terminal' | 'iterm' | 'warp';

interface StoreSchema {
  terminalMode: TerminalMode;
  externalTerminalApp: ExternalTerminalApp;
  windowBounds: { width: number; height: number; x?: number; y?: number };
}

const store = new Store<StoreSchema>({
  defaults: {
    terminalMode: 'embedded',
    externalTerminalApp: 'terminal',
    windowBounds: { width: 1400, height: 900 }
  }
});

export { store };
