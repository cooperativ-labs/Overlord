/**
 * Latch discovery for the Runner/CLI Layer.
 *
 * Probes run on this process's machine — which is the execution target for a
 * local runner (including an AgentPod-adopted runner). Cache lives under
 * OVLD_HOME so launch and settings render share one cheap revalidation path.
 */

import {
  discoverLatchForExecutionTarget,
  LATCH_DISCOVERY_CACHE_FILENAME,
  LATCH_STANDALONE_INSTALL_COMMAND,
  type LatchDiscoveryResult,
  parseLatchCapabilitiesReport,
  probeLatchCapabilities,
  SUPPORTED_LATCH_PROTOCOL_VERSION
} from '@overlord/core/service/latch-discovery';
import { DEFAULT_LATCH_EXECUTABLE } from '@overlord/core/service/terminal-profile-types';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';

export {
  LATCH_DISCOVERY_CACHE_FILENAME,
  LATCH_STANDALONE_INSTALL_COMMAND,
  type LatchDiscoveryResult,
  parseLatchCapabilitiesReport,
  probeLatchCapabilities,
  SUPPORTED_LATCH_PROTOCOL_VERSION
};

export function latchDiscoveryCachePath(dataDir = resolveGlobalDataDir()): string {
  return path.join(dataDir, LATCH_DISCOVERY_CACHE_FILENAME);
}

/**
 * Discover Latch for the given execution target on **this** device. Uses the
 * on-disk cache under ~/.ovld (or OVLD_HOME) with cheap mtime/`which` revalidation.
 */
export function discoverLatchOnThisDevice({
  executionTargetId,
  executable = DEFAULT_LATCH_EXECUTABLE,
  force = false
}: {
  executionTargetId: string;
  executable?: string;
  force?: boolean;
}): LatchDiscoveryResult {
  return discoverLatchForExecutionTarget({
    executionTargetId,
    executable,
    cacheFilePath: latchDiscoveryCachePath(),
    force
  });
}
