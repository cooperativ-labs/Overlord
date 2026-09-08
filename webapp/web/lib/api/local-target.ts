import type { LocalTargetBridgeCall } from '../../../../packages/core/service/local-target/desktop-bridge.ts';
import type { CapabilityResult } from '../../../../packages/core/service/local-target/types.ts';

import { request } from './request.ts';

export const localTargetApi = {
  /** Dev-only loopback SQLite proxy for checkout-local capabilities in plain browser. */
  invokeLocalTarget: (call: LocalTargetBridgeCall) =>
    request<CapabilityResult<unknown>>('POST', '/api/local-target/invoke', call)
};
