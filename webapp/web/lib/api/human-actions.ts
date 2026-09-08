import type {
  HumanActionItemDto,
  HumanActionsDto,
  ResolveHumanActionBody
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const humanActionsApi = {
  /** Human follow-up actions from recent deliveries across every readable workspace (coo:963). */
  listHumanActions: (includeResolved: boolean) =>
    request<HumanActionsDto>(
      'GET',
      `/api/human-actions${includeResolved ? '?includeResolved=1' : ''}`
    ),
  resolveHumanAction: (deliveryId: string, actionId: string, body: ResolveHumanActionBody) =>
    request<HumanActionItemDto>(
      'PUT',
      `/api/human-actions/${deliveryId}/${encodeURIComponent(actionId)}/resolution`,
      body
    ),
  reopenHumanAction: (deliveryId: string, actionId: string) =>
    request<HumanActionItemDto>(
      'DELETE',
      `/api/human-actions/${deliveryId}/${encodeURIComponent(actionId)}/resolution`
    )
};
