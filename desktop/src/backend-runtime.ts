import { session } from 'electron';

import { activeBackendForRenderer, syncOverlordTomlForProfile } from './backend-config.js';
import {
  activateBackendProfile,
  type BackendActivation,
  type BackendLifecycleEffects,
  shutdownBackendProfile
} from './backend-lifecycle.js';
import {
  type ActiveBackend,
  addBackendProfile,
  type BackendProfile,
  getActiveBackendProfileId,
  getBackendProfile,
  listBackendProfiles,
  LOCAL_BACKEND_PROFILE_ID,
  removeBackendProfile,
  resolveActiveBackend,
  sessionPartitionForProfile,
  setActiveBackendProfileId,
  toPublicProfile
} from './backend-profiles.js';
import { clearSessionToken, getSessionToken, setSessionToken } from './backend-token-store.js';
import {
  findFreePort,
  isServerRunning,
  startServer,
  stopServer,
  waitForHealth,
  waitForRemoteHealth
} from './server.js';
import { store } from './settings-store.js';
import { startStaticServer, stopStaticServer } from './static-server.js';

export type BackendRuntimeState = {
  shellOrigin: string;
  active: ActiveBackend;
};

export type BackendRuntimeController = {
  getState: () => BackendRuntimeState;
  /**
   * Persist the selected profile, reap every process the current profile owns,
   * and relaunch the app so the new profile boots from a clean slate.
   */
  switchToProfile: (profileId: string) => Promise<void>;
};

/**
 * Backend profiles are switched across an **app restart boundary** rather than
 * by hot-swapping runtimes inside a live process. Local mode owns a forked
 * web/REST server, a SQLite runtime, and a loopback origin; Remote mode owns
 * none of them. Tearing all of it down and booting once into the chosen profile
 * is the only cheap way to guarantee that a Remote session can never retain the
 * embedded backend, and that returning to Local starts exactly one.
 */
export function createBackendRuntimeController({
  getShellOrigin,
  relaunchApp,
  onBeforeSwitch
}: {
  getShellOrigin: () => string;
  relaunchApp: () => void;
  onBeforeSwitch?: (active: ActiveBackend) => void;
}): BackendRuntimeController {
  return {
    getState: () => {
      const shellOrigin = getShellOrigin();
      return { shellOrigin, active: resolveActiveBackend({ shellOrigin }) };
    },
    switchToProfile: async profileId => {
      const shellOrigin = getShellOrigin();
      const previous = resolveActiveBackend({ shellOrigin });
      if (!getBackendProfile(profileId)) {
        throw new Error(`Unknown backend profile: ${profileId}`);
      }
      onBeforeSwitch?.(previous);

      // Persist the target first so the relaunched process boots into it even
      // if teardown is interrupted. The handoff marker lets the next boot know
      // this profile was just chosen by the user, so a failure to reach it is
      // treated as a failed switch (auth cleared, Local offered) rather than as
      // a transient failure of an already-established profile.
      setActiveBackendProfileId(profileId);
      markPendingProfileSwitch(profileId);
      await shutdownBackendProfile(
        createBackendLifecycleEffects({ profileId: previous.id, shellOrigin })
      );
      relaunchApp();
    }
  };
}

/**
 * Bind the pure lifecycle policy to the shell's real effects. `stopBackend`
 * resolves only once the embedded server process has actually exited.
 */
export function createBackendLifecycleEffects({
  profileId,
  shellOrigin
}: {
  profileId: string;
  shellOrigin: string;
}): BackendLifecycleEffects {
  return {
    startBackend: ({ host: bindHost, port }) => startServer({ host: bindHost, port }),
    stopBackend: () => stopServer(),
    isBackendRunning: () => isServerRunning(),
    startShellStaticServer: ({ host: bindHost, port }) =>
      startStaticServer({ host: bindHost, port }),
    stopShellStaticServer: () => stopStaticServer(),
    waitForLocalHealth: ({ host: pingHost, port }) => waitForHealth({ host: pingHost, port }),
    waitForRemoteHealth: ({ backendUrl }) => waitForRemoteHealth({ backendUrl }),
    syncProfileConfig: () => {
      const profile = getBackendProfile(profileId) ?? getBackendProfile(LOCAL_BACKEND_PROFILE_ID)!;
      syncOverlordTomlForProfile({ profile, shellOrigin });
    }
  };
}

const PENDING_SWITCH_KEY = 'pendingBackendProfileSwitch';

function markPendingProfileSwitch(profileId: string): void {
  store.set(PENDING_SWITCH_KEY, profileId);
}

/**
 * Read and clear the "the user just switched to this profile" marker written
 * before the relaunch. Returns the profile id when this boot is the first one
 * after a switch.
 */
export function consumePendingProfileSwitch(): string | null {
  const pending = store.get(PENDING_SWITCH_KEY, null);
  if (typeof pending !== 'string' || !pending) return null;
  store.delete(PENDING_SWITCH_KEY);
  return pending;
}

export function activationForBackend({
  active,
  host,
  devConnect
}: {
  active: ActiveBackend;
  host: string;
  devConnect: boolean;
}): BackendActivation {
  return {
    mode: active.mode,
    shellOrigin: active.shellOrigin,
    apiBaseUrl: active.apiBaseUrl,
    host,
    devConnect
  };
}

export function listPublicBackends({ shellOrigin }: { shellOrigin: string }) {
  return listBackendProfiles().map(profile => toPublicProfile(profile, { shellOrigin }));
}

export function getPublicActiveBackend({ shellOrigin }: { shellOrigin: string }) {
  const active = resolveActiveBackend({ shellOrigin });
  return activeBackendForRenderer(active);
}

export function addRemoteBackend({
  label,
  backendUrl
}: {
  label: string;
  backendUrl: string;
}): BackendProfile {
  return addBackendProfile({ label, backendUrl });
}

export function removeRemoteBackend(id: string): void {
  removeBackendProfile(id);
}

export function switchActiveBackend({
  id,
  controller
}: {
  id: string;
  controller: BackendRuntimeController;
}): Promise<void> {
  return controller.switchToProfile(id);
}

export function readSessionTokenForProfile(profileId: string): string | null {
  return getSessionToken(profileId);
}

export function writeSessionTokenForProfile({
  profileId,
  token
}: {
  profileId: string;
  token: string;
}): void {
  setSessionToken({ profileId, token });
}

export function clearSessionTokenForProfile(profileId: string): void {
  clearSessionToken(profileId);
}

export function activeProfilePartition(): string {
  return sessionPartitionForProfile(getActiveBackendProfileId());
}

export async function clearDesktopAuthForProfile(profileId: string): Promise<void> {
  clearSessionToken(profileId);
  await session.fromPartition(sessionPartitionForProfile(profileId)).clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb']
  });
}

export async function resolveInitialShellOrigin({
  host,
  preferredPort,
  devConnect,
  devUrl
}: {
  host: string;
  preferredPort: number;
  devConnect: boolean;
  devUrl: string;
}): Promise<string> {
  if (devConnect) return new URL(devUrl).origin;
  return `http://${host}:${await findFreePort(preferredPort, host)}`;
}

export async function bootActiveBackend({
  shellOrigin,
  host,
  devConnect
}: {
  shellOrigin: string;
  host: string;
  devConnect: boolean;
}): Promise<{ active: ActiveBackend; healthy: boolean }> {
  const active = resolveActiveBackend({ shellOrigin });
  const { healthy } = await activateBackendProfile(
    activationForBackend({ active, host, devConnect }),
    createBackendLifecycleEffects({ profileId: active.id, shellOrigin })
  );
  return { active, healthy };
}

/** Reap every local process this shell supervises. Awaited before quitting. */
export function stopAllBackendServers({ shellOrigin }: { shellOrigin: string }): Promise<void> {
  return shutdownBackendProfile(
    createBackendLifecycleEffects({ profileId: getActiveBackendProfileId(), shellOrigin })
  );
}
