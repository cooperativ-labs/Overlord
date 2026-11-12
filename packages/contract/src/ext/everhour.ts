// ---- Everhour extension contract -----------------------------------------
//
// Time tracking via Everhour (https://api.everhour.com). Extension endpoints are
// exposed under `/ext/everhour/`; the caller's personal API key is stored
// server-side as ciphertext and never returned to clients.
import type { EverhourUserConnectionDto } from '../generated/api.js';

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  CreateEverhourTimeBody,
  EverhourTimerDto,
  EverhourTimeRecordDto,
  EverhourUserConnectionDto,
  LinkProjectEverhourBody,
  MissionEverhourStateDto,
  ProjectEverhourLinkDto,
  ProjectEverhourStateDto,
  UpdateEverhourIntegrationBody,
  UpdateEverhourTimeBody
} from '../generated/api.js';

/**
 * @deprecated Use `EverhourUserConnectionDto`. Kept as an alias so existing
 * `/ext/everhour/integration` clients keep compiling during the transition.
 */
export type EverhourIntegrationDto = EverhourUserConnectionDto;
