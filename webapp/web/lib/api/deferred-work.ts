import type {
  DeliveryDeferredWorkItemDto,
  ResolveHumanActionBody
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const deferredWorkApi = {
  /** Record the operator's decision on one deferred-work item of a delivery (coo:1045). */
  resolveDeferredWork: (deliveryId: string, actionId: string, body: ResolveHumanActionBody) =>
    request<DeliveryDeferredWorkItemDto>(
      'PUT',
      `/api/deliveries/${deliveryId}/deferred-work/${encodeURIComponent(actionId)}/resolution`,
      body
    ),
  reopenDeferredWork: (deliveryId: string, actionId: string) =>
    request<DeliveryDeferredWorkItemDto>(
      'DELETE',
      `/api/deliveries/${deliveryId}/deferred-work/${encodeURIComponent(actionId)}/resolution`
    )
};
