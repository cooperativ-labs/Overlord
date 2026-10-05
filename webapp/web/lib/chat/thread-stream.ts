import type {
  ChatEventPageDto,
  ChatMessageDto,
  ChatProposalDto,
  ChatQuestionDto,
  ChatRunDto,
  ChatStreamFrameDto,
  ChatThreadDto,
  ChatThreadSnapshotDto
} from '@overlord/contract';

import { ApiRequestError } from '../api/request.ts';

import {
  applyChatEvent,
  type ChatThreadState,
  isGap,
  prependEarlier,
  stateFromSnapshot
} from './thread-state.ts';

/**
 * Reconnecting transport for one private chat thread (contract v152).
 *
 * It loads an authorized snapshot, subscribes with `after = eventCursor` (the
 * atomic snapshot/cursor handoff), applies events strictly in sequence, drops
 * duplicates, and reloads the snapshot on a gap, a `snapshot_required` frame or
 * 409, or `content.invalidated`. Transient failures reconnect with jittered
 * backoff; repeated failures fall back to bounded polling and periodically retry
 * the stream. A closed stream never implies the run finished. Authentication,
 * `chat_unavailable`, and not-found failures stop the controller.
 *
 * The controller never acknowledges anything: acknowledgement happens only after
 * the UI has rendered an event (see `presence.ts`).
 */
export type ChatStreamStatus =
  | 'loading'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'unavailable'
  | 'not_found'
  | 'unauthorized'
  | 'stopped';

export interface ChatStreamView {
  state: ChatThreadState | null;
  status: ChatStreamStatus;
  /** Number of snapshot reloads, for diagnostics and tests. */
  snapshotLoads: number;
}

export interface ChatStreamDeps {
  loadSnapshot: (threadId: string, before?: string) => Promise<ChatThreadSnapshotDto>;
  /** Opens the SSE response; the controller reads and parses its body. */
  openStream: (threadId: string, after: number, signal: AbortSignal) => Promise<Response>;
  poll: (threadId: string, after: number) => Promise<ChatEventPageDto>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface ChatStreamOptions {
  /** Consecutive stream failures before switching to polling. */
  failuresBeforePolling?: number;
  /** How long a polling period lasts before the stream is retried. */
  pollWindowMs?: number;
  pollIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Abort and reconnect when the stream is silent this long (server heartbeats every 15 s). */
  idleTimeoutMs?: number;
}

const DEFAULTS: Required<ChatStreamOptions> = {
  failuresBeforePolling: 3,
  pollWindowMs: 30_000,
  pollIntervalMs: 2_000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  idleTimeoutMs: 45_000
};

class TerminalError extends Error {
  constructor(
    public status: Extract<ChatStreamStatus, 'unavailable' | 'not_found' | 'unauthorized'>
  ) {
    super(status);
  }
}
class ResyncSignal extends Error {}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      resolve();
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Classifies an HTTP failure from a REST call or a stream response. */
function classify(status: number, code: string | undefined): Error {
  if (status === 401 || status === 403) return new TerminalError('unauthorized');
  if (code === 'chat_unavailable') return new TerminalError('unavailable');
  if (status === 404) return new TerminalError('not_found');
  if (status === 409 && code === 'snapshot_required') return new ResyncSignal('snapshot_required');
  return new Error(`chat stream failed (${status})`);
}

function classifyError(error: unknown): Error {
  if (error instanceof TerminalError || error instanceof ResyncSignal) return error;
  if (error instanceof ApiRequestError) return classify(error.status, error.code);
  return error instanceof Error ? error : new Error(String(error));
}

/** Incremental SSE parser: returns the `data` payload of every completed frame. */
export class SseFrameParser {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') {
        if (this.data.length > 0) out.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        const value = line.slice(5);
        this.data.push(value.startsWith(' ') ? value.slice(1) : value);
      }
      // `event:`, `id:`, `retry:` and `:` comments carry nothing this channel uses.
    }
    return out;
  }
}

export class ChatThreadStream {
  private view: ChatStreamView = { state: null, status: 'loading', snapshotLoads: 0 };
  private listeners = new Set<() => void>();
  private stopped = false;
  private lifetime = new AbortController();
  private wakeController = new AbortController();
  private streamController: AbortController | null = null;
  private readonly options: Required<ChatStreamOptions>;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private failures = 0;
  private pollingUntil = 0;
  private needsSnapshot = true;

  constructor(
    readonly threadId: string,
    private readonly deps: ChatStreamDeps,
    options: ChatStreamOptions = {}
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
  }

  start(): void {
    void this.loop();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.lifetime.abort();
    this.streamController?.abort();
    this.set({ status: 'stopped' });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): ChatStreamView => this.view;

  /** Reconnect now (network back online, tab visible again) instead of waiting out backoff. */
  wake(): void {
    if (this.stopped) return;
    this.pollingUntil = 0;
    this.failures = 0;
    this.wakeController.abort();
  }

  /** Reload the authorized snapshot and resubscribe from its cursor. */
  resync(): void {
    this.needsSnapshot = true;
    this.streamController?.abort();
    this.wake();
  }

  async loadEarlier(): Promise<void> {
    const state = this.view.state;
    const oldest = state?.messages[0];
    if (!state || !oldest || !state.hasEarlierMessages) return;
    const page = await this.deps.loadSnapshot(this.threadId, oldest.id);
    if (this.stopped || !this.view.state) return;
    this.set({ state: prependEarlier(this.view.state, page) });
  }

  /**
   * Merge a REST response (submission, answer, cancel, create) before its event
   * arrives. Revisions guard against regressions; the cursor is untouched, so the
   * matching event still applies normally and duplicates are harmless.
   */
  merge(update: {
    thread?: ChatThreadDto;
    message?: ChatMessageDto;
    run?: ChatRunDto;
    question?: ChatQuestionDto;
    proposal?: ChatProposalDto;
  }): void {
    let state = this.view.state;
    if (!state) return;
    if (update.thread && update.thread.revision >= state.thread.revision)
      state = { ...state, thread: update.thread };
    if (update.message) {
      const message = update.message;
      const index = state.messages.findIndex(m => m.id === message.id);
      if (index === -1) state = { ...state, messages: [...state.messages, message] };
      else if (state.messages[index]!.revision <= message.revision) {
        const messages = state.messages.slice();
        messages[index] = message;
        state = { ...state, messages };
      }
    }
    if (update.run) {
      const run = update.run;
      const unfinished = ['queued', 'running', 'waiting_user'].includes(run.state);
      if (unfinished) {
        if (
          !state.activeRun ||
          state.activeRun.id !== run.id ||
          state.activeRun.revision <= run.revision
        )
          state = {
            ...state,
            activeRun: run,
            thread: {
              ...state.thread,
              activeRunState: run.state as ChatThreadDto['activeRunState']
            }
          };
      } else if (
        !state.latestRun ||
        state.latestRun.id !== run.id ||
        state.latestRun.revision <= run.revision
      ) {
        state = {
          ...state,
          latestRun: run,
          activeRun: state.activeRun?.id === run.id ? null : state.activeRun
        };
      }
    }
    if (
      update.question &&
      state.openQuestion?.id === update.question.id &&
      update.question.state !== 'open'
    )
      state = { ...state, openQuestion: null };
    if (update.proposal) {
      const existing = state.proposals[update.proposal.id];
      if (!existing || existing.current.revision <= update.proposal.current.revision)
        state = {
          ...state,
          proposals: { ...state.proposals, [update.proposal.id]: update.proposal }
        };
    }
    if (state !== this.view.state) this.set({ state });
  }

  private set(patch: Partial<ChatStreamView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        if (this.needsSnapshot || !this.view.state) await this.loadSnapshot();
        if (Date.now() < this.pollingUntil) await this.pollOnce();
        else await this.streamOnce();
      } catch (raw) {
        if (this.stopped) return;
        const error = classifyError(raw);
        if (error instanceof TerminalError) {
          this.set({ status: error.status });
          this.stopped = true;
          return;
        }
        if (error instanceof ResyncSignal) {
          this.needsSnapshot = true;
          continue;
        }
        this.failures += 1;
        const polling = Date.now() < this.pollingUntil;
        if (!polling && this.failures >= this.options.failuresBeforePolling) {
          this.pollingUntil = Date.now() + this.options.pollWindowMs;
          this.set({ status: 'polling' });
        } else if (!polling) {
          this.set({ status: 'reconnecting' });
        }
        await this.backoff();
      }
    }
  }

  private async backoff(): Promise<void> {
    const exponent = Math.min(this.failures - 1, 10);
    const delay = Math.min(this.options.maxBackoffMs, this.options.baseBackoffMs * 2 ** exponent);
    await this.pause(delay * (0.5 + this.random() / 2));
  }

  private async pause(ms: number): Promise<void> {
    if (this.wakeController.signal.aborted) this.wakeController = new AbortController();
    const signal = AbortSignal.any([this.lifetime.signal, this.wakeController.signal]);
    await this.sleep(ms, signal);
  }

  private async loadSnapshot(): Promise<void> {
    if (!this.view.state) this.set({ status: 'loading' });
    const snapshot = await this.deps.loadSnapshot(this.threadId);
    if (this.stopped) return;
    this.needsSnapshot = false;
    this.set({ state: stateFromSnapshot(snapshot), snapshotLoads: this.view.snapshotLoads + 1 });
  }

  /** Applies one event; returns false when the stream must stop for a resync. */
  private apply(event: Parameters<typeof applyChatEvent>[1]): boolean {
    const state = this.view.state;
    if (!state || this.stopped) return false;
    if (event.seq <= state.cursor) return true;
    if (isGap(state, event)) {
      this.needsSnapshot = true;
      return false;
    }
    const next = applyChatEvent(state, event);
    this.set({ state: next });
    if (next.needsSnapshot) {
      this.needsSnapshot = true;
      return false;
    }
    return true;
  }

  private async pollOnce(): Promise<void> {
    const state = this.view.state!;
    const page = await this.deps.poll(this.threadId, state.cursor);
    if (this.stopped) return;
    this.set({ status: 'polling' });
    for (const event of page.events) if (!this.apply(event)) return;
    if (!page.hasMore) await this.pause(this.options.pollIntervalMs);
  }

  private async streamOnce(): Promise<void> {
    const state = this.view.state!;
    const controller = new AbortController();
    this.streamController = controller;
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      globalThis.clearTimeout(idle);
      idle = globalThis.setTimeout(() => controller.abort(), this.options.idleTimeoutMs);
    };
    try {
      const response = await this.deps.openStream(this.threadId, state.cursor, signal);
      if (!response.ok || !response.body) {
        let code: string | undefined;
        try {
          code = ((await response.json()) as { code?: string }).code;
        } catch {
          /* non-JSON */
        }
        throw classify(response.status, code);
      }
      this.failures = 0;
      this.pollingUntil = 0;
      this.set({ status: 'live' });
      armIdle();
      const reader = response.body.getReader();
      // Cancel the body on any abort (resync, idle watchdog, stop) even if the
      // transport ignores the signal, so no read or timer outlives the stream.
      const cancelRead = () => void reader.cancel().catch(() => undefined);
      if (signal.aborted) cancelRead();
      else signal.addEventListener('abort', cancelRead, { once: true });
      const decoder = new TextDecoder();
      const parser = new SseFrameParser();
      while (true) {
        const { done, value } = await reader.read();
        if (done || this.stopped) break;
        armIdle();
        for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
          let frame: ChatStreamFrameDto;
          try {
            frame = JSON.parse(payload) as ChatStreamFrameDto;
          } catch {
            continue;
          }
          if (frame.type === 'snapshot_required') {
            this.needsSnapshot = true;
            controller.abort();
            return;
          }
          if (frame.type === 'event' && !this.apply(frame.event)) {
            controller.abort();
            return;
          }
        }
      }
      if (this.needsSnapshot || this.stopped) return;
      // The server closed the stream: reconnect without implying completion.
      throw new Error('chat stream closed');
    } catch (error) {
      // Intentional aborts (resync, idle watchdog) end quietly; idle counts as a failure.
      if (this.stopped || this.needsSnapshot) return;
      if (controller.signal.aborted) throw new Error('chat stream idle');
      throw error;
    } finally {
      globalThis.clearTimeout(idle);
      if (this.streamController === controller) this.streamController = null;
    }
  }
}
