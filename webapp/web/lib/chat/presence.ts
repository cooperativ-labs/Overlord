import type { ChatAckDto, ChatPresenceDto, UpdateChatPresenceBody } from '@overlord/contract';
import { CHAT_DEFAULT_LIMITS } from '@overlord/contract';

/**
 * Foreground presence and rendered-event acknowledgement for one thread in one
 * browser tab (contract v152). Presence is renewed only while the tab is
 * visible and focused and is released as soon as it is not; an open stream is
 * never presence. `rendered(seq)` is called by the UI after a commit that shows
 * events through `seq`, and an acknowledgement is sent only while foreground, so
 * a hidden or unfocused tab never suppresses a notification. Acknowledgements
 * are monotonic and coalesced, and wait for the presence renewal they depend on.
 */
export interface ChatPresenceDeps {
  updatePresence: (threadId: string, body: UpdateChatPresenceBody) => Promise<ChatPresenceDto>;
  ack: (threadId: string, body: { clientId: string; seq: number }) => Promise<ChatAckDto>;
}

export interface ChatPresenceOptions {
  clientId: string;
  platform: 'web' | 'desktop';
  ttlMs?: number;
  /** Fraction of the TTL after which presence is renewed. */
  renewFraction?: number;
}

export class ChatPresence {
  private foreground = false;
  private stopped = false;
  private renewTimer: ReturnType<typeof setInterval> | undefined;
  private presenceReady: Promise<boolean> = Promise.resolve(false);
  private renderedSeq = 0;
  private ackedSeq = 0;
  private acking: Promise<void> | null = null;
  private readonly ttlMs: number;

  constructor(
    readonly threadId: string,
    private readonly deps: ChatPresenceDeps,
    private readonly options: ChatPresenceOptions
  ) {
    this.ttlMs = options.ttlMs ?? CHAT_DEFAULT_LIMITS.presenceTtlMs;
  }

  /** Update whether this tab is foreground on the thread (visible and focused). */
  setForeground(foreground: boolean): void {
    if (this.stopped || foreground === this.foreground) return;
    this.foreground = foreground;
    if (foreground) {
      this.renew();
      this.renewTimer = setInterval(
        () => this.renew(),
        this.ttlMs * (this.options.renewFraction ?? 0.5)
      );
      void this.flushAck();
    } else {
      clearInterval(this.renewTimer);
      this.renewTimer = undefined;
      this.release();
    }
  }

  /** The UI committed events through `seq`. */
  rendered(seq: number): void {
    if (seq > this.renderedSeq) this.renderedSeq = seq;
    void this.flushAck();
  }

  stop(): void {
    if (this.stopped) return;
    this.setForeground(false);
    this.stopped = true;
  }

  get isForeground(): boolean {
    return this.foreground;
  }

  private renew(): void {
    this.presenceReady = this.deps
      .updatePresence(this.threadId, {
        clientId: this.options.clientId,
        platform: this.options.platform,
        state: 'foreground'
      })
      .then(
        () => true,
        () => false
      );
    // An acknowledgement that waited on a failed renewal is retried once presence is live.
    void this.presenceReady.then(ready => {
      if (ready) void this.flushAck();
    });
  }

  private release(): void {
    this.presenceReady = Promise.resolve(false);
    void this.deps
      .updatePresence(this.threadId, {
        clientId: this.options.clientId,
        platform: this.options.platform,
        state: 'released'
      })
      .catch(() => undefined);
  }

  private flushAck(): Promise<void> {
    if (this.acking) return this.acking;
    // `.finally` always runs asynchronously, so `acking` is cleared after it is set.
    const run = this.sendAcks().finally(() => {
      if (this.acking === run) this.acking = null;
    });
    this.acking = run;
    return run;
  }

  private async sendAcks(): Promise<void> {
    while (!this.stopped && this.foreground && this.renderedSeq > this.ackedSeq) {
      const seq = this.renderedSeq;
      if (!(await this.presenceReady) || !this.foreground) return;
      try {
        const result = await this.deps.ack(this.threadId, {
          clientId: this.options.clientId,
          seq
        });
        this.ackedSeq = Math.max(this.ackedSeq, result.ackedSeq, seq);
      } catch {
        // A failed ack is retried on the next render or foreground change.
        return;
      }
    }
  }
}

/** One id per page load: duplicated tabs and reloads are distinct clients. */
let tabClientId: string | null = null;
export function chatTabClientId(): string {
  tabClientId ??= `web-${globalThis.crypto.randomUUID()}`;
  return tabClientId;
}

/** Visible and focused, the browser's best signal that a person is looking at the tab. */
export function isDocumentForeground(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}
