import type { CodecSpec } from '@overlord/core/service/agent-session/pure/codec';
import { setTimeout as defaultSleep } from 'node:timers/promises';

import type { ChannelClient } from '../client.js';

import { type ApprovalPolicy, DecisionRouter } from './decisions.js';
import {
  createThreadTracker,
  normalizeProjectedFrame,
  type ProjectedFrame,
  projectNotification,
  trackNotification
} from './events.js';
import { importSessionHistory } from './history.js';
import { type ClaimedInput, injectClaimedInput, interruptActiveTurn } from './inject.js';
import {
  buildInitializeParams,
  buildThreadStartParams,
  isSupportedVersion,
  parseServerVersion,
  textInput
} from './protocol.js';
import { JsonRpcPeer, NoResponse, type RpcId } from './rpc.js';
import { threadIdOf, ThreadTree } from './threads.js';
import type { MessageTransport } from './transport.js';

/**
 * The Codex app-server supervisor: one Overlord session ↔ one Codex thread.
 *
 * It is a JSON-RPC client of a private app server. Every Codex notification is projected and
 * normalized through the connector-owned codec and posted to the session channel; approvals and
 * questions become channel requests (`decisions.ts`); claimed inbox inputs become `turn/steer` or
 * `turn/start` (`inject.ts`); and Overlord can stop a running turn (`turn/interrupt`).
 *
 * It holds no credential of its own and decides nothing about scope: the entry point
 * (`./index.ts`) runs the scope gate and hands in a channel client. That split is also what lets
 * the recorded-frame fixtures run this exact module against a fake server and a fake channel.
 *
 * ## Child threads
 * Subagents the agent spawns, and forks a person makes from an attached TUI, are work for the
 * same objective. Codex attaches the Overlord connection to every thread it creates, so their
 * notifications and approvals arrive here with their own `threadId`. The supervisor keeps the
 * session's thread tree (`threads.ts`): a child's events are posted to the same channel with
 * the child as `subagentId`, its completed edits reach change capture, and its approvals become
 * cards that name the subagent. A thread outside the tree (one a person started from scratch in
 * an attached TUI) is not this session's work: its frames are dropped and its approvals are left
 * to the client that started it.
 *
 * ## Reconnect
 * A dropped socket is a reconnect, not a failure. After reconnecting, the supervisor resumes the
 * thread — Codex replays pending approvals to a resubscribing client — and closes any card
 * whose approval was not replayed as resolved elsewhere, because someone answered it while
 * Overlord was away. Event ids are content-derived, so re-posting a frame is a no-op. With
 * `importHistory`, every resume also pages the tree's history (`history.ts`) so work done while
 * nobody was listening still reaches the feed and the change ledger.
 *
 * ## Stop
 * When the channel stops honoring the credential (Overlord ended the session) or the caller
 * aborts, the supervisor interrupts the running turn and closes the connection. It also stops on
 * its own when the heartbeat reports that the objective ended, or that the session delivered and
 * the thread has then sat idle for `idleAfterDeliveryMs` (ADR 0092): a delivered session can
 * still take a follow-up turn for a while, but its server must not run forever.
 */

/** Objective states after which the session has nothing left to do. */
const ENDED_OBJECTIVE_STATES = new Set([
  'complete',
  'cancelled',
  'canceled',
  'archived',
  'deleted'
]);
const DEFAULT_IDLE_AFTER_DELIVERY_MS = 15 * 60 * 1000;
/**
 * A new thread's rollout is written shortly after its first turn starts; `thread/resume` (and
 * so a terminal attach) fails with "no rollout found" before that (spike §3.2, ~500 ms LIVE).
 */
const ROLLOUT_READY_DELAY_MS = 750;

export type HeartbeatLifecycle = {
  objectiveState?: string | null;
  deliveryState?: string | null;
};

export const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];
const RECONCILE_WINDOW_MS = 3000;

export type SupervisorOptions = {
  codec: CodecSpec;
  client: ChannelClient;
  connect: () => Promise<MessageTransport>;
  cwd: string;
  clientVersion: string;
  /** Resume this thread instead of starting one. */
  threadId?: string | null;
  /** The objective prompt, sent as the first turn of a new thread. */
  firstPrompt?: string | null;
  threadSettings?: {
    model?: string | null;
    effort?: string | null;
    approvalPolicy?: 'untrusted' | 'on-request' | 'never' | null;
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
    developerInstructions?: string | null;
  };
  policy?: ApprovalPolicy;
  /** Local changed-file capture for a completed item (`ovld protocol capture-change`). */
  capture?: (frame: ProjectedFrame) => void;
  /**
   * After resuming a thread (a reconnect, or a supervisor started on an existing thread), import
   * the thread tree's history so nothing done while disconnected is missing. Off by default so a
   * recorded-frame fixture only exchanges the frames it scripts.
   */
  importHistory?: boolean;
  maxReconnects?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 disables the periodic heartbeat (one is still sent after binding). */
  heartbeatIntervalMs?: number;
  /** 0 disables the inbox timer; inputs are still drained at turn start and completion. */
  injectIntervalMs?: number;
  /** How long to wait after `initialize` for the remote-control status (default 500 ms). */
  remoteControlWaitMs?: number;
  stopSignal?: AbortSignal;
  reconcileWindowMs?: number;
  now?: () => Date;
  /** Called once the thread can be resumed by another client (terminal attach). */
  onThreadReady?: (threadId: string) => void;
  /** Stop after the session delivered and the thread stayed idle this long. 0 disables. */
  idleAfterDeliveryMs?: number;
  /** Delay between the first `turn/started` of a new thread and `onThreadReady`. */
  rolloutReadyDelayMs?: number;
  /**
   * Called after the thread is resumed on a reconnect with no turn running. A non-null result is
   * sent as a new turn: after the app server crashed, its last turn was interrupted, and the
   * objective must not silently stall.
   */
  consumeContinuationPrompt?: () => string | null;
};

export type SupervisorResult = {
  reason:
    | 'connect-failed'
    | 'version-unsupported'
    | 'remote-control-enabled'
    | 'thread-start-failed'
    | 'thread-closed'
    | 'channel-ended'
    | 'objective-ended'
    | 'stopped'
    | 'reconnect-exhausted';
  threadId: string | null;
  serverVersion: string | null;
  posted: number;
  duplicates: number;
  reconnects: number;
  injected: number;
  interrupted: boolean;
  /** Child threads (subagents and forks) attributed to this session. */
  childThreads: number;
  /** Completed items replayed from thread history after a resume. */
  historyItems: number;
};

type Ending = { kind: 'closed' } | { kind: SupervisorResult['reason'] };

export async function runCodexAppServerSupervisor(
  options: SupervisorOptions
): Promise<SupervisorResult> {
  const sleep = options.sleep ?? defaultSleep;
  const maxReconnects = options.maxReconnects ?? RECONNECT_DELAYS_MS.length;
  const tracker = createThreadTracker(options.threadId ?? null);
  const result: SupervisorResult = {
    reason: 'connect-failed',
    threadId: options.threadId ?? null,
    serverVersion: null,
    posted: 0,
    duplicates: 0,
    reconnects: 0,
    injected: 0,
    interrupted: false,
    childThreads: 0,
    historyItems: 0
  };
  const tree = new ThreadTree(options.threadId ?? null);
  /** The active turn of each child thread, so stopping the session stops them too. */
  const childTurns = new Map<string, string>();
  let threadCwd: string | null = options.cwd;
  const router = new DecisionRouter({
    client: options.client,
    tracker,
    cwd: () => threadCwd,
    ...(options.policy ? { policy: options.policy } : {}),
    sleep
  });
  let promptSent = Boolean(options.threadId);
  let threadReadyReported = false;
  const reportThreadReady = (delayMs: number): void => {
    if (threadReadyReported || !tracker.threadId || !options.onThreadReady) return;
    threadReadyReported = true;
    const threadId = tracker.threadId;
    const fire = (): void => {
      try {
        options.onThreadReady?.(threadId);
      } catch {
        // Attach metadata is best effort; the session runs without it.
      }
    };
    if (delayMs > 0) setTimeout(fire, delayMs).unref?.();
    else fire();
  };
  const idleAfterDeliveryMs = options.idleAfterDeliveryMs ?? DEFAULT_IDLE_AFTER_DELIVERY_MS;
  let idleSince: number | null = null;
  const clock = (): number => (options.now ? options.now().getTime() : Date.now());
  /** Read the lifecycle fields a heartbeat reports, and decide whether the session is over. */
  const lifecycleEnded = (value: unknown): boolean => {
    const lifecycle = (value ?? {}) as HeartbeatLifecycle;
    if (
      typeof lifecycle.objectiveState === 'string' &&
      ENDED_OBJECTIVE_STATES.has(lifecycle.objectiveState)
    ) {
      return true;
    }
    if (lifecycle.deliveryState !== 'delivered' || idleAfterDeliveryMs <= 0) {
      idleSince = null;
      return false;
    }
    if (tracker.activeTurnId) {
      idleSince = null;
      return false;
    }
    idleSince ??= clock();
    return clock() - idleSince >= idleAfterDeliveryMs;
  };

  for (let attempt = 0; ; attempt += 1) {
    if (attempt > 0) {
      if (attempt > maxReconnects) {
        result.reason = result.threadId ? 'reconnect-exhausted' : 'connect-failed';
        return result;
      }
      result.reconnects += 1;
      await sleep(RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)]!);
    }

    let transport: MessageTransport;
    try {
      transport = await options.connect();
    } catch {
      continue;
    }

    const rpc = new JsonRpcPeer(transport, { sleep });
    let finish: (ending: Ending) => void = () => undefined;
    let endedAs: Ending | null = null;
    const ended = new Promise<Ending>(resolve => {
      finish = value => {
        endedAs ??= value;
        resolve(value);
      };
    });
    let remoteControlStatus: string | null = null;
    let reportRemoteControl: () => void = () => undefined;
    const remoteControlReported = new Promise<void>(resolve => {
      reportRemoteControl = resolve;
    });
    rpc.onClose(() => finish({ kind: 'closed' }));
    options.stopSignal?.addEventListener('abort', () => finish({ kind: 'stopped' }), {
      once: true
    });
    if (options.stopSignal?.aborted) finish({ kind: 'stopped' });

    // Events post in arrival order; one slow post must not reorder the feed.
    let pushChain: Promise<void> = Promise.resolve();
    let draining = false;
    const drain = (): void => {
      if (draining || !tracker.threadId) return;
      draining = true;
      void drainInputs({
        rpc,
        client: options.client,
        tracker,
        onChannelEnded: () => finish({ kind: 'channel-ended' })
      })
        .then(count => {
          result.injected += count;
        })
        .finally(() => {
          draining = false;
        });
    };

    const readThread = async (threadId: string): Promise<unknown> =>
      (
        await rpc.request<{ thread?: unknown }>('thread/read', {
          threadId,
          includeTurns: false
        })
      )?.thread;
    /** Is this thread part of the session? Unknown threads are looked up once. */
    const belongs = async (threadId: string | null): Promise<boolean> => {
      if (!threadId || !tree.rootId || tree.has(threadId)) return true;
      return (await tree.resolve(threadId, readThread)) !== null;
    };

    /**
     * Project, normalize, post and capture one notification. Runs inside `pushChain`, so frames
     * post in arrival order; history replay calls it directly from within the chain.
     */
    const processFrame = async (
      method: string,
      params: unknown,
      occurredAt: Date | null
    ): Promise<void> => {
      const threadId = threadIdOf(params);
      // Attribution: a thread outside the session tree is not this objective's work.
      if (!(await belongs(threadId))) return;
      const frames = projectNotification({
        method,
        params,
        cwd: threadCwd,
        thread: tree.frameContext(threadId)
      });
      for (const frame of frames) {
        const event = normalizeProjectedFrame({
          codec: options.codec,
          frame,
          ...(occurredAt ? { now: occurredAt } : options.now ? { now: options.now() } : {})
        });
        if (event) {
          const posted = await options.client.post<{ accepted?: { duplicate: boolean }[] }>(
            '/events',
            { nativeSessionId: tracker.threadId, events: [event] }
          );
          if (posted.ok) {
            if (posted.value.accepted?.[0]?.duplicate) result.duplicates += 1;
            else result.posted += 1;
          } else if (posted.reason === 'unauthorized') {
            finish({ kind: 'channel-ended' });
          }
        }
        if (options.capture && frame.event.startsWith('item/completed:')) {
          try {
            options.capture(frame);
          } catch {
            // Capture is best effort and never stops the session.
          }
        }
      }
    };

    rpc.onNotification((method, params) => {
      trackNotification(tracker, method, params);
      if (method === 'remoteControl/status/changed') {
        // Only `disabled` is acceptable (plan §7.2): `connecting`, `connected` and `errored` all
        // mean remote control is switched on for this server.
        const status = (params as { status?: unknown } | null)?.status;
        if (typeof status === 'string') {
          remoteControlStatus = status;
          reportRemoteControl();
          if (status !== 'disabled') finish({ kind: 'remote-control-enabled' });
        }
        return;
      }
      if (method === 'serverRequest/resolved') {
        void router.onServerRequestResolved(params);
        return;
      }
      const threadId = threadIdOf(params);
      const isRoot = !threadId || !tracker.threadId || threadId === tracker.threadId;
      // Admission is synchronous: a parent announces a child before the child's own frames and
      // approvals arrive, so they are attributed without a lookup.
      if (method === 'thread/started') {
        tree.admitThread((params as { thread?: unknown } | null)?.thread);
      } else if (method === 'item/started' || method === 'item/completed') {
        tree.admitFromItem(threadId, (params as { item?: unknown } | null)?.item);
      }
      if (!isRoot && threadId && tree.has(threadId)) {
        const turnId = (params as { turn?: { id?: unknown } } | null)?.turn?.id;
        if (method === 'turn/started' && typeof turnId === 'string') {
          childTurns.set(threadId, turnId);
        }
        if (method === 'turn/completed') childTurns.delete(threadId);
      }
      if (method === 'item/started') recordDiffs(router, params);
      if (method === 'item/completed') forgetDiffs(router, params);
      // A frame that fails to post is dropped; it must not stall the frames behind it.
      pushChain = pushChain.then(() => processFrame(method, params, null)).catch(() => undefined);
      if (isRoot && method === 'turn/started') {
        reportThreadReady(options.rolloutReadyDelayMs ?? ROLLOUT_READY_DELAY_MS);
      }
      if (isRoot && (method === 'turn/started' || method === 'turn/completed')) drain();
      if (
        method === 'thread/closed' &&
        (params as { threadId?: unknown } | null)?.threadId === tracker.threadId
      ) {
        finish({ kind: 'thread-closed' });
      }
    });

    /**
     * Approvals from a child thread are routed like the root's and name the subagent on the
     * card; a request from a thread outside the session is left to the client that owns it.
     */
    const routeRequest =
      (
        handler: (
          params: unknown,
          id: RpcId,
          origin: Record<string, unknown> | null
        ) => Promise<unknown>
      ) =>
      async (params: unknown, id: RpcId): Promise<unknown> => {
        const threadId = threadIdOf(params);
        if (!(await belongs(threadId))) return NoResponse.instance;
        return handler(params, id, tree.cardOrigin(threadId));
      };
    rpc.handleServerRequest(
      'item/commandExecution/requestApproval',
      routeRequest((params, id, origin) => router.commandApproval(params, id, origin))
    );
    rpc.handleServerRequest(
      'item/fileChange/requestApproval',
      routeRequest((params, id, origin) => router.fileChangeApproval(params, id, origin))
    );
    rpc.handleServerRequest(
      'item/tool/requestUserInput',
      routeRequest((params, id, origin) => router.userInput(params, id, origin))
    );

    // ── Handshake and version gate ────────────────────────────────────────────
    try {
      const init = await rpc.request<{ userAgent?: unknown }>(
        'initialize',
        buildInitializeParams(options.clientVersion)
      );
      rpc.notify('initialized');
      result.serverVersion = parseServerVersion(init?.userAgent);
      if (!isSupportedVersion(result.serverVersion)) {
        rpc.close();
        result.reason = 'version-unsupported';
        return result;
      }
    } catch {
      rpc.close();
      continue;
    }

    // ── Remote control must be off before any thread exists ─────────────────────
    // Codex reports `remoteControl/status/changed` right after `initialize` (recorded on 0.170
    // and 0.171). Give it a moment to arrive, and start nothing on a server a remote party
    // could drive. A server that never reports it is still stopped if it reports later.
    if (remoteControlStatus === null) {
      await Promise.race([remoteControlReported, sleep(options.remoteControlWaitMs ?? 500)]);
    }
    if (endedAs !== null && (endedAs as Ending).kind === 'remote-control-enabled') {
      rpc.close();
      result.reason = 'remote-control-enabled';
      return result;
    }

    // ── Bind the thread ───────────────────────────────────────────────────────
    const reconciling = attempt > 0 ? router.beginReconcile() : null;
    let resumed = false;
    try {
      if (!tracker.threadId) {
        const started = await rpc.request<{ thread?: { id?: unknown }; cwd?: unknown }>(
          'thread/start',
          buildThreadStartParams({ cwd: options.cwd, ...(options.threadSettings ?? {}) })
        );
        const id = started?.thread?.id;
        if (typeof id !== 'string') throw new Error('thread/start returned no thread id');
        tracker.threadId = id;
        tree.setRoot(id);
        if (typeof started.cwd === 'string') threadCwd = started.cwd;
      } else {
        const resumedThread = await rpc.request<{
          thread?: { turns?: { id?: unknown; status?: unknown }[] };
          cwd?: unknown;
        }>('thread/resume', { threadId: tracker.threadId, approvalsReviewer: 'user' });
        resumed = true;
        tree.setRoot(tracker.threadId);
        if (typeof resumedThread?.cwd === 'string') threadCwd = resumedThread.cwd;
        const running = (resumedThread?.thread?.turns ?? []).filter(
          turn => turn?.status === 'inProgress' && typeof turn.id === 'string'
        );
        tracker.activeTurnId = (running.at(-1)?.id as string | undefined) ?? null;
        // A resumable thread already has its rollout.
        reportThreadReady(0);
        const continuation = tracker.activeTurnId ? null : options.consumeContinuationPrompt?.();
        if (continuation) {
          try {
            const started = await rpc.request<{ turn?: { id?: unknown } }>('turn/start', {
              threadId: tracker.threadId,
              input: textInput(continuation)
            });
            if (typeof started?.turn?.id === 'string') tracker.activeTurnId = started.turn.id;
          } catch {
            // The thread is bound; a person can continue it from the terminal or the inbox.
          }
        }
      }
    } catch {
      rpc.close();
      if (!result.threadId && !tracker.threadId) {
        result.reason = 'thread-start-failed';
        return result;
      }
      continue;
    }
    result.threadId = tracker.threadId;

    // The heartbeat records the thread id as the channel's native session alias.
    const beat = await options.client.post('/heartbeat', { nativeSessionId: tracker.threadId });
    if (!beat.ok && beat.reason === 'unauthorized') finish({ kind: 'channel-ended' });
    else if (beat.ok && lifecycleEnded(beat.value)) finish({ kind: 'objective-ended' });

    if (!promptSent && options.firstPrompt) {
      promptSent = true;
      try {
        const started = await rpc.request<{ turn?: { id?: unknown } }>('turn/start', {
          threadId: tracker.threadId,
          input: textInput(options.firstPrompt)
        });
        if (typeof started?.turn?.id === 'string') tracker.activeTurnId = started.turn.id;
      } catch {
        // The thread exists; the prompt can still be sent from the terminal or the inbox.
      }
    }

    if (resumed && options.importHistory) {
      // Fill what happened while nobody was listening. Inside the chain, so live frames that
      // arrive meanwhile post after the history they follow.
      pushChain = pushChain.then(async () => {
        try {
          const imported = await importSessionHistory({
            rpc,
            tree,
            shouldStop: () => endedAs !== null,
            replay: async (method, params, occurredAt) => {
              tree.admitFromItem(threadIdOf(params), params.item);
              await processFrame(method, params, occurredAt);
            }
          });
          result.historyItems += imported.items;
        } catch {
          // History is a gap filler; the live session goes on without it.
        }
      });
    }

    const timers: NodeJS.Timeout[] = [];
    const heartbeatMs = options.heartbeatIntervalMs ?? 15_000;
    if (heartbeatMs > 0) {
      timers.push(
        setInterval(() => {
          void options.client
            .post('/heartbeat', { nativeSessionId: tracker.threadId })
            .then(response => {
              if (!response.ok && response.reason === 'unauthorized') {
                finish({ kind: 'channel-ended' });
              } else if (response.ok && lifecycleEnded(response.value)) {
                finish({ kind: 'objective-ended' });
              }
            });
        }, heartbeatMs)
      );
    }
    const injectMs = options.injectIntervalMs ?? 1000;
    if (injectMs > 0) timers.push(setInterval(drain, injectMs));
    if (reconciling) {
      timers.push(
        setTimeout(
          () => void router.finishReconcile(reconciling),
          options.reconcileWindowMs ?? RECONCILE_WINDOW_MS
        )
      );
    }
    drain();

    const ending = await ended;
    for (const timer of timers) clearInterval(timer);
    await pushChain;

    router.abandonAll();
    result.childThreads = tree.childCount;
    if (ending.kind === 'closed') continue;
    if (
      ending.kind === 'channel-ended' ||
      ending.kind === 'stopped' ||
      ending.kind === 'objective-ended' ||
      ending.kind === 'remote-control-enabled'
    ) {
      // Overlord stopped this session: stop the running turn before letting go of the thread,
      // and any subagent still working for it.
      result.interrupted = await interruptActiveTurn({ rpc, tracker });
      await interruptChildTurns(rpc, childTurns);
    }
    rpc.close();
    result.reason = ending.kind;
    return result;
  }
}

async function interruptChildTurns(
  rpc: JsonRpcPeer,
  childTurns: Map<string, string>
): Promise<void> {
  await Promise.allSettled(
    [...childTurns].map(([threadId, turnId]) => rpc.request('turn/interrupt', { threadId, turnId }))
  );
  childTurns.clear();
}

/** A completed file change can no longer ask for approval; its diffs are not kept. */
function forgetDiffs(router: DecisionRouter, params: unknown): void {
  const item = (params as { item?: { type?: unknown; id?: unknown } } | null)?.item;
  if (item?.type === 'fileChange' && typeof item.id === 'string') router.forgetDiffs(item.id);
}

function recordDiffs(router: DecisionRouter, params: unknown): void {
  const item = (params as { item?: { type?: unknown; id?: unknown; changes?: unknown } } | null)
    ?.item;
  if (item?.type !== 'fileChange' || typeof item.id !== 'string' || !Array.isArray(item.changes)) {
    return;
  }
  router.recordDiffs(
    item.id,
    item.changes.map(change => (change as { diff?: unknown } | null)?.diff)
  );
}

async function drainInputs({
  rpc,
  client,
  tracker,
  onChannelEnded
}: {
  rpc: JsonRpcPeer;
  client: ChannelClient;
  tracker: ReturnType<typeof createThreadTracker>;
  onChannelEnded: () => void;
}): Promise<number> {
  let delivered = 0;
  for (let index = 0; index < 3; index += 1) {
    const claimed = await client.post<{ input: ClaimedInput | null }>(
      '/inputs/claim',
      {},
      { timeoutMs: 3000 }
    );
    if (!claimed.ok) {
      if (claimed.reason === 'unauthorized') onChannelEnded();
      return delivered;
    }
    if (!claimed.value.input) return delivered;
    const outcome = await injectClaimedInput({ rpc, client, tracker, input: claimed.value.input });
    if (outcome.outcome === 'delivered') delivered += 1;
  }
  return delivered;
}
