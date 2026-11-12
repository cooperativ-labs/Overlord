// Types for the parts of scripts/release-gate.mjs that the TypeScript publish
// scripts import.

export const SKIP_GATE_FLAG: '--skip-release-gate';
export const SKIP_GATE_ENV: 'OVERLORD_SKIP_RELEASE_GATE';

export function enforceReleaseGate(options: {
  step: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  root?: string;
  log?: (message: string) => void;
}): { args: string[]; skipped: boolean; refusal: string | null };
