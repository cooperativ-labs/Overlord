/**
 * Read-only webapp facade for the checkout-local bridge contract.
 *
 * Keep imports from `packages/core/service` in this one file. The desktop
 * preload implementation and the webapp bridge caller deliberately share
 * these pure types and helpers, while the webapp remains otherwise independent
 * of the core service layout.
 */
export type {
  BranchObservationResult,
  LocalTargetBridgeCall
} from '../../../packages/core/service/local-target/desktop-bridge.ts';
export {
  detectLatchInvocation,
  latchInvocationWarning
} from '../../../packages/core/service/latch-invocation.ts';
export { isLatchSessionAbsentMessage } from '../../../packages/core/service/latch-session-absent.ts';
export type { ClientDeviceIdentity } from '../../../packages/core/service/device-identity.ts';
export type {
  BranchListResult,
  CapabilityFailure,
  CapabilityResult,
  DiscoverLatchResult,
  InspectLatchSessionResult,
  LocalTargetErrorCode,
  OpenLatchSessionResult,
  RepositoryTreeResult,
  ResourceObservation,
  StopLatchSessionResult
} from '../../../packages/core/service/local-target/types.ts';
