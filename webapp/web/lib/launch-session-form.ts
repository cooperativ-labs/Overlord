/**
 * Pure mapping between the stored launch-session settings and the Session
 * control in Terminal & IDE settings (coo:702).
 *
 * Two rules this module exists to keep honest:
 *  - the terminal choice (`launcher`) is never derived from the provider, so
 *    toggling Direct/Persistent cannot lose it;
 *  - the per-target override is tri-state on the wire — omitted keeps, `null`
 *    clears back to the user default, a value sets it.
 */

import type { LaunchSessionDefaultsDto, TerminalProfileDto } from '../../shared/contract.ts';

import type { LatchDiscoveryView } from './latch-discovery-client.ts';

/** `'inherit'` follows the user-level default; the others override it. */
export type ProviderChoice = 'inherit' | 'direct' | 'latch';

export function providerChoiceFromProfile(profile: TerminalProfileDto): ProviderChoice {
  return profile.executionProvider?.kind ?? 'inherit';
}

/** The provider that actually applies, after inheritance. */
export function effectiveProviderKind({
  providerChoice,
  defaults
}: {
  providerChoice: ProviderChoice;
  defaults: LaunchSessionDefaultsDto | null;
}): 'direct' | 'latch' {
  if (providerChoice !== 'inherit') return providerChoice;
  return defaults?.executionProvider.kind ?? 'direct';
}

/** Whether a viewer opens on launch, after inheritance. */
export function effectiveOpenViewer({
  openViewerOverride,
  defaults
}: {
  openViewerOverride: boolean | null;
  defaults: LaunchSessionDefaultsDto | null;
}): boolean {
  return openViewerOverride ?? defaults?.openViewerOnLaunch ?? true;
}

/**
 * The session half of the terminal-profile update body. `'inherit'` must send
 * an explicit `null`: omitting the field would keep whatever override is stored.
 */
export function sessionOverrideFields({
  providerChoice,
  latchExecutable,
  openViewerOverride
}: {
  providerChoice: ProviderChoice;
  latchExecutable: string;
  openViewerOverride: boolean | null;
}): Pick<TerminalProfileDto, 'executionProvider' | 'openViewerOnLaunch'> {
  return {
    executionProvider:
      providerChoice === 'inherit' ? null : { kind: providerChoice, executable: latchExecutable },
    openViewerOnLaunch: openViewerOverride
  };
}

/**
 * Why Latch cannot be offered, or null when it can. A probe that could not run
 * at all is deliberately *not* a block: the user keeps the choice and the runner
 * falls back to direct with a warning rather than the settings pane guessing.
 */
export function latchBlockedReason(discovery: LatchDiscoveryView | undefined): string | null {
  if (discovery?.state === 'not_installed') return 'Latch is not installed on this machine.';
  if (discovery?.state === 'incompatible') {
    if (discovery.missingCapability === 'protocolVersion') {
      return 'This Latch build uses an unsupported protocol version.';
    }
    return `This Latch build is missing ${discovery.missingCapability}.`;
  }
  return null;
}
