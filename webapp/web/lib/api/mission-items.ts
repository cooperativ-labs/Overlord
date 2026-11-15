import type { MissionItemDto, ResolveMissionItemBody } from '@overlord/contract';

import { request } from './request.ts';

export const missionItemsApi = {
  /** Close a risk, human action or suggestion as a person (contract v173, ADR 0060). */
  resolveMissionItem: (id: string, body: ResolveMissionItemBody) =>
    request<MissionItemDto>('PUT', `/api/mission-items/${encodeURIComponent(id)}/resolution`, body),
  /** Set a done or dismissed item back to open; a superseded item answers 409. */
  restoreMissionItem: (id: string) =>
    request<MissionItemDto>('DELETE', `/api/mission-items/${encodeURIComponent(id)}/resolution`)
};
