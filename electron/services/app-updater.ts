import { BrowserWindow } from 'electron';
import { AppUpdater, autoUpdater, UpdateDownloadedEvent } from 'electron-updater';

type UpdatePhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type AppUpdateStatus = {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
};
type AppUpdateStatusListener = (status: AppUpdateStatus) => void;

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export class AppUpdaterService {
  private readonly updater: AppUpdater;
  private readonly isPackaged: boolean;
  private readonly checkIntervalMs: number;
  private checkTimer: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private status: AppUpdateStatus;
  private checkInFlight = false;
  private downloadInFlight = false;
  private enabled = false;
  private readonly statusListeners = new Set<AppUpdateStatusListener>();

  constructor(options: { isPackaged: boolean; currentVersion: string }) {
    this.updater = autoUpdater;
    this.isPackaged = options.isPackaged;
    this.checkIntervalMs = getCheckIntervalMs();
    this.status = {
      phase: 'idle',
      currentVersion: options.currentVersion
    };
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
    this.emitStatus();
  }

  initialize(): void {
    if (!this.isPackaged) {
      this.updateStatus({
        phase: 'unsupported',
        message: 'App updates are available in packaged builds only.'
      });
      return;
    }

    const feedUrl = resolveFeedUrl();
    if (!feedUrl) {
      this.updateStatus({
        phase: 'unsupported',
        message:
          'Set ELECTRON_UPDATE_URL or SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL to enable app update checks.'
      });
      return;
    }

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.setFeedURL({
      provider: 'generic',
      url: feedUrl
    });
    this.registerUpdaterEvents();

    this.enabled = true;
    this.schedulePeriodicChecks();
  }

  getStatus(): AppUpdateStatus {
    return this.status;
  }

  onStatusChange(listener: AppUpdateStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async checkForUpdates(): Promise<boolean> {
    if (!this.enabled || this.checkInFlight) return false;

    this.checkInFlight = true;
    try {
      const result = await this.updater.checkForUpdates();
      return Boolean(result);
    } catch (error) {
      this.handleError(error);
      return false;
    } finally {
      this.checkInFlight = false;
    }
  }

  async downloadUpdate(): Promise<boolean> {
    if (!this.enabled || this.downloadInFlight) return false;
    if (this.status.phase !== 'available') return false;

    this.downloadInFlight = true;
    try {
      await this.updater.downloadUpdate();
      return true;
    } catch (error) {
      this.handleError(error);
      return false;
    } finally {
      this.downloadInFlight = false;
    }
  }

  quitAndInstall(): boolean {
    if (!this.enabled) return false;
    if (this.status.phase !== 'downloaded') return false;

    setImmediate(() => this.updater.quitAndInstall(false, true));
    return true;
  }

  private schedulePeriodicChecks(): void {
    if (!this.enabled) return;

    // Trigger an initial check shortly after app start and then repeat.
    setTimeout(() => {
      void this.checkForUpdates();
    }, 30_000).unref();

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates();
    }, this.checkIntervalMs);
    this.checkTimer.unref();
  }

  private registerUpdaterEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.updateStatus({
        phase: 'checking',
        message: 'Checking for updates...'
      });
    });

    this.updater.on('update-available', info => {
      this.updateStatus({
        phase: 'available',
        availableVersion: info.version,
        progressPercent: 0,
        message: `Version ${info.version} is available.`
      });
    });

    this.updater.on('update-not-available', info => {
      this.updateStatus({
        phase: 'not-available',
        availableVersion: info.version,
        progressPercent: undefined,
        message: `You are up to date (${this.status.currentVersion}).`
      });
    });

    this.updater.on('download-progress', progress => {
      this.updateStatus({
        phase: 'downloading',
        progressPercent: Math.round(progress.percent),
        message: `Downloading update (${Math.round(progress.percent)}%).`
      });
    });

    this.updater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      this.updateStatus({
        phase: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        message: `Version ${info.version} is ready. Restart to install.`
      });
    });

    this.updater.on('error', error => {
      this.handleError(error);
    });
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown updater error.';
    this.updateStatus({
      phase: 'error',
      progressPercent: undefined,
      message
    });
  }

  private updateStatus(next: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...next };
    this.emitStatus();
  }

  private emitStatus(): void {
    this.mainWindow?.webContents.send('app-update:status', this.status);
    for (const listener of this.statusListeners) {
      listener(this.status);
    }
  }
}

function getCheckIntervalMs(): number {
  const rawMinutes = process.env.ELECTRON_UPDATE_CHECK_INTERVAL_MINUTES;
  const minutes = rawMinutes ? Number(rawMinutes) : NaN;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_CHECK_INTERVAL_MS;
  }
  return Math.round(minutes * 60_000);
}

function resolveFeedUrl(): string | null {
  const explicit = process.env.ELECTRON_UPDATE_URL?.trim();
  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;

  const bucket = (process.env.ELECTRON_UPDATE_BUCKET?.trim() || 'app-downloads').replace(
    /^\/+|\/+$/g,
    ''
  );
  const prefix = (process.env.ELECTRON_UPDATE_PREFIX?.trim() || 'electron').replace(
    /^\/+|\/+$/g,
    ''
  );
  return `${trimTrailingSlash(supabaseUrl)}/storage/v1/object/public/${bucket}/${prefix}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}
