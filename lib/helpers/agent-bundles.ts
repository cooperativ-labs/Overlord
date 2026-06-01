/**
 * Shared types describing the Electron agent-bundle install contract.
 *
 * These are consumed both by the CLI settings page
 * (`components/modals/settings/cli/`) and the onboarding bundle step
 * (`components/features/onboarding/steps/InstallAgentBundlesStep.tsx`), which
 * previously re-declared identical copies and risked drifting apart.
 */

/** Agents that ship a full Overlord plugin bundle. */
export type BundleAgent = 'claude' | 'cursor' | 'antigravity' | 'opencode';

export type BundleStatus = 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';

export type BundleStatusEntry = {
  agent: BundleAgent;
  status: BundleStatus;
  version: string | null;
  installedVersion: string | null;
  details: string;
};
