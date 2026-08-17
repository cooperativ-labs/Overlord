/**
 * The single decision point for which local processes a backend profile may
 * run.
 *
 * Contract (Desktop Shell): a **Local** profile forks the embedded web/REST
 * server as a `utilityProcess` and loads the SPA from it; a **Remote** profile
 * **does not fork the embedded server** — it serves the bundled SPA shell from
 * a tiny in-process static server and talks to the hosted backend over HTTPS /
 * `wss`. This module encodes exactly that, and it imports nothing from Electron
 * so the rules are unit testable.
 *
 * Every transition reaps before it starts anything:
 *
 * - Activating **Remote** stops and awaits the embedded backend before the
 *   remote shell comes up, then asserts nothing is left running. A Remote
 *   profile therefore never starts, and never inherits, a local backend.
 * - Activating **Local** stops and awaits any prior backend before forking, so
 *   there is always exactly one.
 * - Shutdown stops both and awaits the backend.
 */

export type BackendActivationMode = 'local' | 'remote';

export interface BackendLifecycleEffects {
  /** Fork the embedded web/REST server (Local only). */
  startBackend: (options: { host: string; port: number }) => void;
  /** Terminate the embedded server and resolve once it has actually exited. */
  stopBackend: () => Promise<void>;
  isBackendRunning: () => boolean;
  /** Serve the bundled SPA shell in-process (Remote only). */
  startShellStaticServer: (options: { host: string; port: number }) => void;
  stopShellStaticServer: () => void;
  waitForLocalHealth: (options: { host: string; port: number }) => Promise<boolean>;
  waitForRemoteHealth: (options: { backendUrl: string }) => Promise<boolean>;
  /** Point `~/.ovld/overlord.toml` at the profile that is becoming active. */
  syncProfileConfig: () => void;
}

export interface BackendActivation {
  mode: BackendActivationMode;
  /** Loopback origin the SPA shell is served from. */
  shellOrigin: string;
  /** REST/realtime base URL the SPA calls. */
  apiBaseUrl: string;
  /** Interface the shell/embedded server binds to. */
  host: string;
  /**
   * `OVERLORD_DESKTOP_DEV=1`: an externally run `ovld serve` owns both the
   * shell origin and the API, so the shell supervises no local process at all.
   */
  devConnect: boolean;
}

export interface BackendActivationResult {
  healthy: boolean;
  /** True only when this shell owns a running embedded backend process. */
  backendRunning: boolean;
}

export function shouldRunEmbeddedBackend(activation: {
  mode: BackendActivationMode;
  devConnect: boolean;
}): boolean {
  return activation.mode === 'local' && !activation.devConnect;
}

export async function activateBackendProfile(
  activation: BackendActivation,
  effects: BackendLifecycleEffects
): Promise<BackendActivationResult> {
  effects.syncProfileConfig();

  // Reap first, unconditionally. Whatever we are transitioning *from*, no
  // previously forked backend may outlive this call.
  await effects.stopBackend();

  const port = portOf(activation.shellOrigin);

  if (activation.mode === 'remote') {
    if (effects.isBackendRunning()) {
      throw new Error(
        'Refusing to activate a Remote backend profile while the embedded local backend is still running.'
      );
    }
    if (!activation.devConnect) {
      effects.startShellStaticServer({ host: activation.host, port });
    }
    const healthy = await effects.waitForRemoteHealth({ backendUrl: activation.apiBaseUrl });
    return { healthy, backendRunning: false };
  }

  if (activation.devConnect) {
    const healthy = await effects.waitForLocalHealth({
      host: hostOf(activation.shellOrigin),
      port
    });
    return { healthy, backendRunning: false };
  }

  effects.stopShellStaticServer();
  effects.startBackend({ host: activation.host, port });
  const healthy = await effects.waitForLocalHealth({ host: activation.host, port });
  return { healthy, backendRunning: effects.isBackendRunning() };
}

/** Tear every supervised local process down and wait for the backend to exit. */
export async function shutdownBackendProfile(effects: BackendLifecycleEffects): Promise<void> {
  await effects.stopBackend();
  effects.stopShellStaticServer();
}

export function hostOf(origin: string): string {
  return new URL(origin).hostname;
}

export function portOf(origin: string): number {
  const { port, protocol } = new URL(origin);
  if (port) return Number(port);
  return protocol === 'https:' ? 443 : 80;
}
