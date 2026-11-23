import { setTimeout as defaultSleep } from 'node:timers/promises';

import { JSON_RPC_ERRORS } from './protocol.js';
import type { MessageTransport } from './transport.js';

/**
 * JSON-RPC over a Codex app-server transport.
 *
 * Codex omits the `jsonrpc` field and so does this peer. It correlates responses to requests,
 * fans notifications out, and dispatches server → client requests to registered handlers.
 *
 * Two rules matter more than the plumbing:
 *  - **An unknown server request is refused, never left unanswered.** Codex blocks the turn on
 *    a server request until some client answers it, so silence would hang the agent. The refusal
 *    is a JSON-RPC error, which Codex treats as "this client cannot handle it"; another
 *    subscriber (the TUI) can still answer.
 *  - **Overload is retried.** `-32001` means the server is busy; a request is retried with
 *    bounded backoff before it fails.
 */

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export type RpcId = number | string;

export type ServerRequestHandler = (params: unknown, id: RpcId) => Promise<unknown>;

const OVERLOAD_DELAYS_MS = [100, 250, 500, 1000];

export class JsonRpcPeer {
  private nextId = 1;
  private readonly pending = new Map<
    RpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly notificationListeners: ((method: string, params: unknown) => void)[] = [];
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private readonly closeListeners: ((reason: string) => void)[] = [];
  private closed = false;

  constructor(
    private readonly transport: MessageTransport,
    private readonly options: {
      requestTimeoutMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {
    transport.onMessage(text => this.receive(text));
    transport.onClose(reason => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new RpcError(-1, `transport closed: ${reason}`));
      }
      this.pending.clear();
      for (const listener of this.closeListeners) listener(reason);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onNotification(listener: (method: string, params: unknown) => void): void {
    this.notificationListeners.push(listener);
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  handleServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  notify(method: string, params?: unknown): void {
    this.transport.send(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestOnce<T>(method, params);
      } catch (error) {
        const delay = OVERLOAD_DELAYS_MS[attempt];
        if (
          !(error instanceof RpcError) ||
          error.code !== JSON_RPC_ERRORS.overloaded ||
          delay === undefined
        ) {
          throw error;
        }
        await (this.options.sleep ?? defaultSleep)(delay);
      }
    }
  }

  close(): void {
    this.transport.close();
  }

  private requestOnce<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(-1, 'transport closed'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(-2, `${method} timed out`));
      }, this.options.requestTimeoutMs ?? 30_000);
      timer.unref?.();
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.transport.send(
        JSON.stringify(params === undefined ? { id, method } : { id, method, params })
      );
    });
  }

  private receive(text: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const id = message.id as RpcId | undefined;
    const method = typeof message.method === 'string' ? message.method : null;

    if (method && id !== undefined && id !== null) {
      void this.dispatchServerRequest(method, message.params, id);
      return;
    }
    if (method) {
      for (const listener of this.notificationListeners) {
        try {
          listener(method, message.params);
        } catch {
          // A listener failure must not stop the stream.
        }
      }
      return;
    }
    if (id === undefined || id === null) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (message.error && typeof message.error === 'object') {
      const error = message.error as { code?: unknown; message?: unknown; data?: unknown };
      entry.reject(
        new RpcError(
          typeof error.code === 'number' ? error.code : -32603,
          typeof error.message === 'string' ? error.message : 'error',
          error.data
        )
      );
      return;
    }
    entry.resolve(message.result);
  }

  private async dispatchServerRequest(method: string, params: unknown, id: RpcId): Promise<void> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) {
      this.respondError(id, JSON_RPC_ERRORS.methodNotFound, `${method} is not handled by Overlord`);
      return;
    }
    let result: unknown;
    try {
      result = await handler(params, id);
    } catch (error) {
      if (error instanceof NoResponse) return;
      this.respondError(
        id,
        error instanceof RpcError ? error.code : -32603,
        error instanceof Error ? error.message : 'handler failed'
      );
      return;
    }
    if (result instanceof NoResponse) return;
    if (!this.closed) this.transport.send(JSON.stringify({ id, result }));
  }

  private respondError(id: RpcId, code: number, message: string): void {
    if (!this.closed) this.transport.send(JSON.stringify({ id, error: { code, message } }));
  }
}

/**
 * Returned (or thrown) by a server-request handler that must not answer: another client
 * already resolved the request, or the decision is left to the terminal. Codex keeps the request
 * open for the other subscribers either way.
 */
export class NoResponse {
  static readonly instance = new NoResponse();
}
