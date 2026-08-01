import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  AGENT_SESSION_CAPABILITY_IDS,
  type AgentSessionCapabilityId,
  findHarnessDescriptor,
  HARNESS_CAPABILITY_TIER_NAMES,
  HARNESS_CATALOG_DIGEST,
  HARNESS_DESCRIPTORS,
  type HarnessDescriptor
} from './catalog.generated.js';

/**
 * Harness descriptor access for the agent-session runtime.
 *
 * The runtime reads the COMPILED catalog (`catalog.generated.ts`), never the YAML: parsing
 * YAML from disk on a hook path would violate the latency invariant, and the installed
 * adapter may be older than the CLI. The only YAML read here is the *installed* descriptor,
 * and only so `ovld doctor` can report drift between what a connector installed and what this
 * CLI compiled — which turns "your connector is stale" from an invisible failure into a
 * diagnosable one.
 *
 * Everything in this module is local and offline. It performs no network I/O, which is what
 * makes it safe to call from `doctor` for an unbound session.
 */

export {
  AGENT_SESSION_CAPABILITY_IDS,
  findHarnessDescriptor,
  HARNESS_CAPABILITY_TIER_NAMES,
  HARNESS_CATALOG_DIGEST,
  HARNESS_DESCRIPTORS
};
export type { AgentSessionCapabilityId, HarnessDescriptor };

export const INSTALLED_DESCRIPTOR_FILENAME = 'harness-capabilities.yaml';

export type InstalledDescriptorReport = {
  agentKey: string;
  installed: boolean;
  installedDigest: string | null;
  compiledDigest: string | null;
  compiledSchemaVersion: number | null;
  compiledTier: number | null;
  drift: boolean;
  detail: string;
};

/**
 * Compare the descriptor an adapter has installed on this machine with the one compiled into
 * this CLI. A digest mismatch means the connector files are older (or newer) than the runtime
 * that reads them, so the capabilities the UI would gate on are not the capabilities that are
 * actually installed.
 */
export function inspectInstalledDescriptor({
  agentKey,
  installPath
}: {
  agentKey: string;
  installPath: string | null;
}): InstalledDescriptorReport {
  const compiled = findHarnessDescriptor(agentKey) ?? null;
  const base: InstalledDescriptorReport = {
    agentKey,
    installed: false,
    installedDigest: null,
    compiledDigest: compiled?.descriptorDigest ?? null,
    compiledSchemaVersion: compiled?.descriptorSchemaVersion ?? null,
    compiledTier: compiled?.capabilityTier ?? null,
    drift: false,
    detail: ''
  };

  if (!compiled) {
    return {
      ...base,
      detail: `no harness descriptor is compiled into this CLI for ${agentKey}`
    };
  }
  if (!installPath) {
    return { ...base, detail: 'connector not installed — nothing to compare' };
  }

  const descriptorPath = path.join(installPath, INSTALLED_DESCRIPTOR_FILENAME);
  if (!existsSync(descriptorPath)) {
    return {
      ...base,
      drift: true,
      detail:
        `installed connector has no ${INSTALLED_DESCRIPTOR_FILENAME} (installed before descriptors shipped). ` +
        `Re-run \`ovld agent-setup ${agentKey}\`.`
    };
  }

  const installedDigest = createHash('sha256').update(readFileSync(descriptorPath)).digest('hex');
  const drift = installedDigest !== compiled.descriptorDigest;
  return {
    ...base,
    installed: true,
    installedDigest,
    drift,
    detail: drift
      ? `installed descriptor ${installedDigest.slice(0, 12)} differs from compiled ` +
        `${compiled.descriptorDigest.slice(0, 12)}. Re-run \`ovld agent-setup ${agentKey}\`.`
      : `descriptor ${installedDigest.slice(0, 12)} matches the compiled catalog ` +
        `(schema v${compiled.descriptorSchemaVersion}, tier ${compiled.capabilityTier})`
  };
}
