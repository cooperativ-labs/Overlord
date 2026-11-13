// ---- Everhour extension contract -----------------------------------------
//
// Time tracking via Everhour (https://api.everhour.com). Extension endpoints are
// exposed under `/ext/everhour/`; the caller's personal API key is managed only
// through `/api/connections`, stored server-side as ciphertext and never returned
// to clients.

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  CreateEverhourTimeBody,
  EverhourTimerDto,
  EverhourTimeRecordDto,
  LinkProjectEverhourBody,
  MissionEverhourStateDto,
  ProjectEverhourLinkDto,
  ProjectEverhourStateDto,
  UpdateEverhourTimeBody
} from '../generated/api.js';
