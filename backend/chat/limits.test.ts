import { CHAT_DEFAULT_LIMITS } from '@overlord/contract';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { CHAT_LIMIT_ENV_NAMES, chatLimitsFromEnv } from './limits.ts';

it('chat limits come from the environment only when they are whole numbers in range', () => {
  assert.deepEqual(chatLimitsFromEnv({}), {});
  assert.deepEqual(
    chatLimitsFromEnv({
      CHAT_MAX_CONCURRENT_RUNS_PER_OWNER: '5',
      CHAT_MAX_TOOL_CALLS_PER_RUN: ' 40 ',
      CHAT_MAX_ACTIVE_MS_PER_RUN: '300000',
      CHAT_MAX_TARGET_READS_PER_RUN: '2',
      CHAT_ATTEMPT_LEASE_MS: '10000',
      CHAT_NOTIFICATION_GRACE_MS: '8000',
      CHAT_PRESENCE_TTL_MS: '45000',
      CHAT_EVENT_RETENTION_MS: '86400000',
      CHAT_EVENT_RETENTION_COUNT: '1000'
    }),
    {
      concurrentRunsPerOwner: 5,
      toolCallsPerRun: 40,
      activeProcessingMsPerRun: 300_000,
      concurrentTargetReadsPerRun: 2,
      attemptLeaseMs: 10_000,
      notificationGraceMs: 8000,
      presenceTtlMs: 45_000,
      eventRetentionMs: 86_400_000,
      eventRetentionCount: 1000
    }
  );
  // Malformed, zero, negative, fractional and out-of-range values keep the default.
  assert.deepEqual(
    chatLimitsFromEnv({
      CHAT_MAX_CONCURRENT_RUNS_PER_OWNER: '0',
      CHAT_MAX_TOOL_CALLS_PER_RUN: '-3',
      CHAT_MAX_ACTIVE_MS_PER_RUN: '60000',
      CHAT_MAX_TARGET_READS_PER_RUN: '1.5',
      CHAT_ATTEMPT_LEASE_MS: 'soon',
      CHAT_NOTIFICATION_GRACE_MS: '',
      CHAT_PRESENCE_TTL_MS: '1e9',
      CHAT_EVENT_RETENTION_MS: '5',
      CHAT_EVENT_RETENTION_COUNT: '99999999'
    }),
    {}
  );
});

it('every configurable chat limit names a contracted default', () => {
  assert.equal(CHAT_LIMIT_ENV_NAMES.length, 9);
  const merged = {
    ...CHAT_DEFAULT_LIMITS,
    ...chatLimitsFromEnv({ CHAT_MAX_TOOL_CALLS_PER_RUN: '7' })
  };
  assert.equal(merged.toolCallsPerRun, 7);
  assert.equal(merged.unfinishedRunsPerThread, 1);
  assert.equal(merged.activeProcessingMsPerRun, CHAT_DEFAULT_LIMITS.activeProcessingMsPerRun);
});
