import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from '../context.js';
import { createProject } from '../projects.js';
import { attachSession, protocolCreate } from '../protocol.js';
import { createSeededServiceContext } from '../test-helpers.js';
import { newId, nowIso } from '../util.js';

import {
  authenticateChannelCredential,
  bindChannelToSession,
  createSessionChannel,
  endChannel,
  expireLostChannels,
  findBindableChannelForMission,
  heartbeatChannel
} from './channels.js';
import { appendSessionEvent } from './events.js';
import {
  cancelSessionInput,
  enqueueSessionInput,
  getInput,
  leaseNextInput,
  markInputEmitted
} from './inputs.js';
import {
  acquireWaiterLease,
  createRequest,
  markRequestResolvedElsewhere,
  releaseExpiredRequests,
  releaseRequestToTerminal,
  resolveDecisionWindow,
  resolveRequest
} from './requests.js';

async function seedMission(): Promise<{
  ctx: ServiceContext;
  db: Awaited<ReturnType<typeof createSeededServiceContext>>['db'];
  missionId: string;
  projectId: string;
}> {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: 'Exchange', slug: 'exchange' });
  const created = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Do the thing' }]
  });
  return { ctx, db, missionId: created.mission.id, projectId: project.id };
}

describe('session channel credential', () => {
  it('authenticates only its own channel and never returns the raw secret again', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();

    const first = await createSessionChannel({ ctx, missionId, projectId });
    const second = await createSessionChannel({ ctx, missionId, projectId });

    const resolved = await authenticateChannelCredential({
      db,
      rawToken: first.bootstrap.token
    });
    assert.equal(resolved?.id, first.channel.id);

    // A credential is scoped to exactly one channel: the second channel's token resolves to
    // the second channel and nothing else, and neither token can name the other.
    const other = await authenticateChannelCredential({ db, rawToken: second.bootstrap.token });
    assert.equal(other?.id, second.channel.id);
    assert.notEqual(other?.id, first.channel.id);

    // Only the hash is stored. Nothing in the row can reconstruct the secret.
    const stored = await db.get<{ credential_hash: string; credential_prefix: string }>(
      `SELECT credential_hash, credential_prefix FROM agent_session_channels WHERE id = ?`,
      [first.channel.id]
    );
    assert.ok(stored);
    assert.notEqual(stored.credential_hash, first.bootstrap.token);
    assert.ok(first.bootstrap.token.startsWith(stored.credential_prefix));

    await db.close();
  });

  it('rejects an unknown, ended, or revoked credential identically', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel, bootstrap } = await createSessionChannel({ ctx, missionId, projectId });

    assert.equal(await authenticateChannelCredential({ db, rawToken: 'osc_nope' }), null);

    await endChannel({ ctx, channelId: channel.id, reason: 'session_ended' });
    assert.equal(await authenticateChannelCredential({ db, rawToken: bootstrap.token }), null);

    await db.close();
  });

  it('renews the credential with the channel lease but never past the absolute ceiling', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });

    const renewed = await heartbeatChannel({ ctx, channelId: channel.id });
    assert.ok(new Date(renewed.credentialExpiresAt) > new Date(nowIso()));

    // The ceiling is measured from channel creation, so a healthy long-running session keeps
    // renewing but can never renew forever.
    const ceiling = new Date(new Date(channel.created_at).getTime() + 24 * 60 * 60 * 1000);
    assert.ok(new Date(renewed.credentialExpiresAt) <= ceiling);

    await db.close();
  });
});

describe('channel binding at attach', () => {
  it('binds a prepared channel and backfills pre-attach events', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({
      ctx,
      missionId,
      projectId,
      launchKind: 'queued'
    });

    // An event published before the agent attached: it has a channel but no session, because
    // no session exists yet.
    const preAttach = await appendSessionEvent({
      ctx,
      channel,
      event: { producerEventId: 'evt-1', kind: 'session.started' }
    });
    const beforeBind = await db.get<{ session_id: string | null }>(
      `SELECT session_id FROM agent_session_events WHERE id = ?`,
      [preAttach.id]
    );
    assert.equal(beforeBind?.session_id, null);

    const attached = await attachSession({
      ctx,
      missionId,
      agentIdentifier: 'claude-code',
      sessionChannelId: channel.id,
      externalSessionId: 'native-abc'
    });

    const bound = await db.get<{ session_id: string; native_session_id: string; state: string }>(
      `SELECT session_id, native_session_id, state FROM agent_session_channels WHERE id = ?`,
      [channel.id]
    );
    assert.equal(bound?.session_id, attached.session.id);
    assert.equal(bound?.native_session_id, 'native-abc');
    assert.equal(bound?.state, 'online');

    const afterBind = await db.get<{ session_id: string | null }>(
      `SELECT session_id FROM agent_session_events WHERE id = ?`,
      [preAttach.id]
    );
    assert.equal(afterBind?.session_id, attached.session.id);

    await db.close();
  });

  it('refuses to rebind a channel already bound to another session', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const attached = await attachSession({
      ctx,
      missionId,
      agentIdentifier: 'claude-code',
      sessionChannelId: channel.id
    });

    await assert.rejects(
      () =>
        bindChannelToSession({
          ctx,
          channelId: channel.id,
          sessionId: newId(),
          missionId,
          objectiveId: attached.objective.id,
          projectId
        }),
      /already bound/i
    );

    await db.close();
  });

  it('binds the mission preparing channel when attach omits sessionChannelId', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({
      ctx,
      missionId,
      projectId,
      launchKind: 'queued'
    });

    const attached = await attachSession({
      ctx,
      missionId,
      agentIdentifier: 'cursor'
    });

    const bound = await db.get<{ session_id: string; state: string }>(
      `SELECT session_id, state FROM agent_session_channels WHERE id = ?`,
      [channel.id]
    );
    assert.equal(bound?.session_id, attached.session.id);
    assert.equal(bound?.state, 'online');
    assert.equal(await findBindableChannelForMission({ ctx, missionId }), null);

    await db.close();
  });
});

describe('normalized event append', () => {
  it('is idempotent for a replayed producer id', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({
      ctx,
      missionId,
      projectId,
      adapterKey: 'claude'
    });

    const first = await appendSessionEvent({
      ctx,
      channel,
      event: { producerEventId: 'dup-1', kind: 'user.prompt', producerSequence: 1 }
    });
    const replay = await appendSessionEvent({
      ctx,
      channel,
      event: { producerEventId: 'dup-1', kind: 'user.prompt', producerSequence: 1 }
    });

    assert.equal(replay.duplicate, true);
    assert.equal(replay.id, first.id);
    assert.equal(replay.channelSequence, first.channelSequence);

    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM agent_session_events WHERE channel_id = ?`,
      [channel.id]
    );
    assert.equal(count?.n, 1);

    await db.close();
  });

  it('rejects an oversize payload rather than storing a truncated one', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });

    await assert.rejects(
      () =>
        appendSessionEvent({
          ctx,
          channel,
          event: {
            producerEventId: 'big',
            kind: 'tool.started',
            payload: { blob: 'x'.repeat(9000) }
          }
        }),
      /too.large|exceeds/i
    );

    await db.close();
  });
});

describe('answerable requests', () => {
  it('releases to the terminal when the waiter lease expires', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const request = await createRequest({
      ctx,
      channel,
      kind: 'permission',
      summary: 'Run the project test command'
    });

    const lease = await acquireWaiterLease({ ctx, requestId: request.id, leaseSeconds: 1 });
    assert.equal(lease.request.status, 'open');

    // Simulate the waiter being killed: nothing renews, the lease lapses, and the server —
    // not the dead process — is what releases the decision back to the terminal.
    const future = new Date(Date.now() + 60_000).toISOString();
    const released = await releaseExpiredRequests({ ctx, now: future });
    assert.equal(released, 1);

    const after = await db.get<{ status: string; released_reason: string }>(
      `SELECT status, released_reason FROM agent_requests WHERE id = ?`,
      [request.id]
    );
    assert.equal(after?.status, 'released_to_terminal');
    assert.equal(after?.released_reason, 'timeout');

    await db.close();
  });

  it('lets exactly one of resolve and release win a race', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const request = await createRequest({
      ctx,
      channel,
      kind: 'permission',
      summary: 'Delete the branch'
    });

    const resolved = await resolveRequest({
      ctx,
      requestId: request.id,
      resolution: { optionId: 'deny' }
    });
    assert.equal(resolved.resolved, true);

    // The adapter's release loses, re-reads, and finds the human's decision — so it emits that
    // rather than a contradictory one.
    const release = await releaseRequestToTerminal({
      ctx,
      requestId: request.id,
      reason: 'timeout'
    });
    assert.equal(release.released, false);
    assert.equal(release.request.status, 'resolved');

    await db.close();
  });

  it('refuses an adapter-originated resolution, which has no human actor', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const request = await createRequest({
      ctx,
      channel,
      kind: 'permission',
      summary: 'Run rm -rf'
    });

    // This is the shape the adapter route family produces: a valid context with no actor.
    const adapterCtx: ServiceContext = { ...ctx, actorWorkspaceUserId: null };
    await assert.rejects(
      () => resolveRequest({ ctx: adapterCtx, requestId: request.id, resolution: { ok: true } }),
      /human actor/i
    );

    await db.close();
  });

  it('sizes the remote window from presence and clamps below the harness timeout', () => {
    const now = '2026-08-01T00:00:00.000Z';

    const active = resolveDecisionWindow({
      now,
      presence: 'active',
      harnessTimeoutSeconds: null
    });
    assert.equal(active.windowExpiresAt, '2026-08-01T00:00:30.000Z');
    assert.equal(active.windowBasis, 'presence_active');

    const away = resolveDecisionWindow({ now, presence: 'away', harnessTimeoutSeconds: null });
    assert.equal(away.windowExpiresAt, '2026-08-01T00:30:00.000Z');

    // A 60s harness timeout must win over a 30-minute away window, or the harness aborts the
    // hook before Overlord ever releases the decision.
    const clamped = resolveDecisionWindow({ now, presence: 'away', harnessTimeoutSeconds: 60 });
    assert.equal(clamped.windowExpiresAt, '2026-08-01T00:00:48.000Z');
    assert.match(clamped.windowBasis, /clamped_to_harness/);

    // Project policy may set the window to zero: never hold a decision remotely.
    const zero = resolveDecisionWindow({
      now,
      presence: 'away',
      harnessTimeoutSeconds: 60,
      projectWindowSeconds: 0
    });
    assert.equal(zero.windowExpiresAt, now);
  });

  it('marks a control-plane TUI winner as resolved elsewhere exactly once', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({
      ctx,
      missionId,
      projectId,
      adapterKey: 'opencode'
    });
    const request = await createRequest({
      ctx,
      channel,
      kind: 'permission',
      nativeRequestId: 'opencode-permission-1',
      summary: 'OpenCode permission request'
    });
    const first = await markRequestResolvedElsewhere({ ctx, requestId: request.id });
    const replay = await markRequestResolvedElsewhere({ ctx, requestId: request.id });
    assert.equal(first.changed, true);
    assert.equal(first.request.released_reason, 'resolved_elsewhere');
    assert.equal(replay.changed, false);
    await db.close();
  });
});

describe('inbound session inputs', () => {
  it('never re-leases an emitted input, however long its lease lapsed', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const attached = await attachSession({
      ctx,
      missionId,
      agentIdentifier: 'claude-code',
      sessionChannelId: channel.id
    });
    const bound = await db.get<{ session_id: string }>(
      `SELECT session_id FROM agent_session_channels WHERE id = ?`,
      [channel.id]
    );
    assert.equal(bound?.session_id, attached.session.id);

    const liveChannel = { ...channel, session_id: attached.session.id, state: 'online' as const };
    const input = await enqueueSessionInput({
      ctx,
      channel: liveChannel,
      kind: 'instruction',
      body: 'Also update the changelog'
    });

    const leased = await leaseNextInput({ ctx, channelId: channel.id, leaseSeconds: 1 });
    assert.equal(leased?.input.id, input.id);
    assert.equal(
      (
        await markInputEmitted({
          ctx,
          inputId: input.id,
          leaseId: leased!.leaseId,
          deliveryOutcome: 'queued_turn_boundary'
        })
      ).emitted,
      true
    );
    const afterEmit = await getInput({ ctx, inputId: input.id });
    assert.equal(afterEmit.delivery_outcome, 'queued_turn_boundary');
    assert.equal(afterEmit.status, 'emitted');

    // The lease is long gone, but an emitted instruction is never handed out again: a duplicate
    // model instruction is worse than an honest unknown.
    const again = await leaseNextInput({ ctx, channelId: channel.id });
    assert.equal(again, null);

    // And it can no longer be cancelled, because it has already reached the agent.
    assert.equal((await cancelSessionInput({ ctx, inputId: input.id })).cancelled, false);

    await db.close();
  });

  it('rejects input for an ended channel instead of silently queueing it', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });
    const attached = await attachSession({
      ctx,
      missionId,
      agentIdentifier: 'claude-code',
      sessionChannelId: channel.id
    });

    await assert.rejects(
      () =>
        enqueueSessionInput({
          ctx,
          channel: { ...channel, session_id: attached.session.id, state: 'ended' },
          kind: 'instruction',
          body: 'too late'
        }),
      /has ended/i
    );

    await db.close();
  });
});

describe('channel end and loss', () => {
  it('revokes the credential and closes open requests in one transition', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel, bootstrap } = await createSessionChannel({ ctx, missionId, projectId });
    const request = await createRequest({
      ctx,
      channel,
      kind: 'permission',
      summary: 'Push to main'
    });

    await endChannel({ ctx, channelId: channel.id, reason: 'session_ended', exitCode: 0 });

    assert.equal(await authenticateChannelCredential({ db, rawToken: bootstrap.token }), null);
    const after = await db.get<{ status: string }>(
      `SELECT status FROM agent_requests WHERE id = ?`,
      [request.id]
    );
    // A card that stays clickable after its session is gone promises an effect that can no
    // longer happen.
    assert.equal(after?.status, 'released_to_terminal');

    await db.close();
  });

  it('marks a channel lost when its lease expires without a clean end', async () => {
    const { ctx, db, missionId, projectId } = await seedMission();
    const { channel } = await createSessionChannel({ ctx, missionId, projectId });

    const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    assert.equal(await expireLostChannels({ ctx, now: future }), 1);

    const after = await db.get<{ state: string; end_reason: string }>(
      `SELECT state, end_reason FROM agent_session_channels WHERE id = ?`,
      [channel.id]
    );
    assert.equal(after?.state, 'lost');
    assert.equal(after?.end_reason, 'lease_expired');

    await db.close();
  });
});
