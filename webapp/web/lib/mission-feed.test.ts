import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  AgentRequestDto,
  AgentSessionChannelSnapshotDto,
  MissionEventDto
} from '../../shared/contract.ts';

import {
  type AgentSessionFeedItem,
  formatCountdown,
  groupMissionFeedItems,
  isChannelLive,
  isRequestAnswerable,
  resolveFollowUpPresentation
} from './mission-feed.ts';

function event(overrides: Partial<MissionEventDto> & { id: string }): MissionEventDto {
  return {
    missionId: 'mission-1',
    objectiveId: null,
    type: 'update',
    phase: 'execute',
    summary: 'summary',
    source: 'agent',
    actorWorkspaceUserId: null,
    actor: null,
    externalUrl: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

function channel(state: string): AgentSessionChannelSnapshotDto {
  return {
    id: 'channel-1',
    state,
    agentIdentifier: 'claude-code',
    adapterKey: 'claude',
    capabilities: {},
    lastHeartbeatAt: null,
    endedAt: null,
    endReason: null
  };
}

function request(overrides: Partial<AgentRequestDto> = {}): AgentRequestDto {
  return {
    id: 'request-1',
    channelId: 'channel-1',
    missionId: 'mission-1',
    objectiveId: null,
    kind: 'permission',
    summary: 'Run git push',
    options: [],
    allowsFreeText: false,
    status: 'open',
    resolution: null,
    revision: 1,
    windowExpiresAt: null,
    releasedReason: null,
    applicationState: 'unknown',
    resolvedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

describe('groupMissionFeedItems', () => {
  it('routes every status event to the execution-status list, contiguous or not', () => {
    const { midFeed, executionStatus } = groupMissionFeedItems(
      [
        event({ id: 'e1', type: 'status_change', createdAt: '2026-08-01T00:05:00.000Z' }),
        event({ id: 'e2', type: 'update', createdAt: '2026-08-01T00:04:00.000Z' }),
        event({ id: 'e3', type: 'execution_requested', createdAt: '2026-08-01T00:03:00.000Z' })
      ],
      []
    );
    assert.deepEqual(
      executionStatus.map(item => item.id),
      ['e1', 'e3']
    );
    assert.deepEqual(
      midFeed.map(item => item.id),
      ['e2']
    );
  });

  it('omits delivery events, which render under Artifacts', () => {
    const { midFeed, executionStatus } = groupMissionFeedItems(
      [event({ id: 'e1', type: 'delivery' })],
      []
    );
    assert.equal(midFeed.length, 0);
    assert.equal(executionStatus.length, 0);
  });

  it('interleaves agent-session cards with narrative rows, newest first', () => {
    const agentSessionItems: AgentSessionFeedItem[] = [
      {
        kind: 'agent_request',
        id: 'agent-request-r1',
        createdAt: '2026-08-01T00:04:30.000Z',
        request: request()
      }
    ];
    const { midFeed } = groupMissionFeedItems(
      [
        event({ id: 'e1', createdAt: '2026-08-01T00:04:00.000Z' }),
        event({ id: 'e2', createdAt: '2026-08-01T00:06:00.000Z' })
      ],
      agentSessionItems
    );
    assert.deepEqual(
      midFeed.map(item => item.id),
      ['e2', 'agent-request-r1', 'e1']
    );
  });
});

describe('isRequestAnswerable', () => {
  const now = Date.parse('2026-08-01T00:00:00.000Z');

  it('allows an open request on a live channel with no window', () => {
    assert.equal(isRequestAnswerable(request(), channel('online'), now), true);
    assert.equal(isRequestAnswerable(request(), channel('degraded'), now), true);
  });

  it('refuses once the request left the open state', () => {
    for (const status of ['resolved', 'released_to_terminal', 'expired', 'cancelled']) {
      assert.equal(isRequestAnswerable(request({ status }), channel('online'), now), false);
    }
  });

  it('refuses when the channel is gone, so no control outlives its session', () => {
    assert.equal(isRequestAnswerable(request(), channel('ended'), now), false);
    assert.equal(isRequestAnswerable(request(), channel('lost'), now), false);
    assert.equal(isRequestAnswerable(request(), null, now), false);
  });

  it('refuses once the remote decision window has closed', () => {
    const expired = request({ windowExpiresAt: '2026-07-31T23:59:59.000Z' });
    const open = request({ windowExpiresAt: '2026-08-01T00:00:30.000Z' });
    assert.equal(isRequestAnswerable(expired, channel('online'), now), false);
    assert.equal(isRequestAnswerable(open, channel('online'), now), true);
  });
});

describe('isChannelLive', () => {
  it('treats only preparing/online/degraded as addressable', () => {
    assert.equal(isChannelLive(channel('preparing')), true);
    assert.equal(isChannelLive(channel('ended')), false);
    assert.equal(isChannelLive(null), false);
  });
});

describe('formatCountdown', () => {
  it('never shows a negative remainder', () => {
    assert.equal(formatCountdown(-5_000), '0s left');
  });

  it('switches to minutes past a minute', () => {
    assert.equal(formatCountdown(29_000), '29s left');
    assert.equal(formatCountdown(90_000), '1m left');
  });
});

describe('resolveFollowUpPresentation', () => {
  it('presents a hook-posted follow-up as the user speaking', () => {
    const result = resolveFollowUpPresentation(
      event({ id: 'e1', type: 'user_follow_up', summary: 'move the selector above the input' })
    );
    assert.deepEqual(result, {
      isFollowUp: true,
      summary: 'move the selector above the input'
    });
  });

  it('recognizes an agent-relayed follow-up and strips the marker', () => {
    for (const summary of ['Follow-up: do X', 'follow up: do X', 'Followup:do X']) {
      assert.deepEqual(resolveFollowUpPresentation(event({ id: 'e2', summary })), {
        isFollowUp: true,
        summary: 'do X'
      });
    }
  });

  it('leaves ordinary updates alone', () => {
    assert.deepEqual(
      resolveFollowUpPresentation(event({ id: 'e3', summary: 'Ran the suite; all green.' })),
      { isFollowUp: false, summary: 'Ran the suite; all green.' }
    );
  });

  it('does not reinterpret other event types that happen to use the marker', () => {
    const decision = event({ id: 'e4', type: 'decision', summary: 'Follow-up: ship it' });
    assert.deepEqual(resolveFollowUpPresentation(decision), {
      isFollowUp: false,
      summary: 'Follow-up: ship it'
    });
  });

  it('keeps a marker-only update as an update, since it carries no user message', () => {
    assert.deepEqual(resolveFollowUpPresentation(event({ id: 'e5', summary: 'Follow-up:  ' })), {
      isFollowUp: false,
      summary: 'Follow-up:  '
    });
  });
});
