import type { ChatOptions } from '../../packages/core/service/chat/store.ts';

type ChatLimits = NonNullable<ChatOptions['limits']>;

/**
 * Operator-tunable conversation limits (contract v152 §Continue and §Conversation
 * notifications). Each setting is a whole number inside its accepted range; an unset,
 * malformed, or out-of-range value keeps the contracted default, so a typo can never
 * disable a bound. A run records the limits in force when it was submitted, so a change
 * applies to new runs only.
 */
const SETTINGS: readonly {
  env: string;
  limit: keyof ChatLimits;
  min: number;
  max: number;
}[] = [
  { env: 'CHAT_MAX_CONCURRENT_RUNS_PER_OWNER', limit: 'concurrentRunsPerOwner', min: 1, max: 50 },
  { env: 'CHAT_MAX_TOOL_CALLS_PER_RUN', limit: 'toolCallsPerRun', min: 1, max: 500 },
  // The runtime reserves the last minute for the closing summary, so less than two minutes
  // would leave no research time.
  {
    env: 'CHAT_MAX_ACTIVE_MS_PER_RUN',
    limit: 'activeProcessingMsPerRun',
    min: 2 * 60 * 1000,
    max: 60 * 60 * 1000
  },
  // The repository-read service admits four reads per run regardless, so this can only lower it.
  { env: 'CHAT_MAX_TARGET_READS_PER_RUN', limit: 'concurrentTargetReadsPerRun', min: 1, max: 4 },
  { env: 'CHAT_ATTEMPT_LEASE_MS', limit: 'attemptLeaseMs', min: 5 * 1000, max: 10 * 60 * 1000 },
  { env: 'CHAT_NOTIFICATION_GRACE_MS', limit: 'notificationGraceMs', min: 1, max: 10 * 60 * 1000 },
  { env: 'CHAT_PRESENCE_TTL_MS', limit: 'presenceTtlMs', min: 1, max: 10 * 60 * 1000 },
  {
    env: 'CHAT_EVENT_RETENTION_MS',
    limit: 'eventRetentionMs',
    min: 60 * 1000,
    max: 90 * 24 * 60 * 60 * 1000
  },
  { env: 'CHAT_EVENT_RETENTION_COUNT', limit: 'eventRetentionCount', min: 100, max: 100_000 }
];

export const CHAT_LIMIT_ENV_NAMES = SETTINGS.map(setting => setting.env);

export function chatLimitsFromEnv(env: NodeJS.ProcessEnv): ChatLimits {
  const limits: Partial<Record<keyof ChatLimits, number>> = {};
  for (const { env: name, limit, min, max } of SETTINGS) {
    const raw = env[name]?.trim();
    if (!raw || !/^\d+$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= min && value <= max) limits[limit] = value;
  }
  return limits;
}
