import { createHash } from 'node:crypto';

import type { ChatOwner } from '../../packages/core/service/chat/store.ts';

import type { GeminiCacheCreate, GeminiClient } from './gemini-client.ts';

/**
 * Requests whose previous reported prompt reaches this size go inline: a cached request gains
 * no implicit hits on the conversation, which implicit caching covers on large prompts.
 */
export const STATIC_CACHE_SWITCH_TOKENS = 16_000;

/** Exactly what a cached request omits: the instruction, declarations and AUTO tool config. */
export type StaticPrefix = Pick<
  GeminiCacheCreate['config'],
  'systemInstruction' | 'tools' | 'toolConfig'
>;
/** Awaited private capture in the owner's thread; a cache is used only once its creation is recorded. */
export type CacheObserver = (kind: string, payload: unknown) => Promise<unknown>;

interface Entry {
  key: string;
  owner: string;
  state: 'pending' | 'ready' | 'failed';
  name: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface StaticCacheOptions {
  ttlSeconds?: number;
  /** A cache is reused only while at least this much of its TTL remains. */
  reuseMarginMs?: number;
  maxEntries?: number;
  maxPerOwner?: number;
  createTimeoutMs?: number;
  now?: () => number;
}

/** Canonical JSON: sorted object keys, arrays in order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, canonical((value as Record<string, unknown>)[k])])
    );
  return value;
}

/**
 * Process-local registry of owner-keyed Gemini explicit caches for the static prefix. It never
 * blocks a request: a missing cache starts a single-flight creation and the caller goes inline.
 */
export class GeminiStaticCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlSeconds: number;
  private readonly reuseMarginMs: number;
  private readonly maxEntries: number;
  private readonly maxPerOwner: number;
  private readonly createTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: GeminiClient,
    options: StaticCacheOptions = {}
  ) {
    this.ttlSeconds = options.ttlSeconds ?? 600;
    this.reuseMarginMs = options.reuseMarginMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 64;
    this.maxPerOwner = options.maxPerOwner ?? 4;
    this.createTimeoutMs = options.createTimeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  get supported(): boolean {
    return Boolean(this.client.createCache && this.client.deleteCache);
  }

  key(owner: ChatOwner, model: string, prefix: StaticPrefix): string {
    return createHash('sha256')
      .update(
        JSON.stringify(canonical({ owner: [owner.profileId, owner.organizationId], model, prefix }))
      )
      .digest('hex');
  }

  /**
   * Returns a ready cache name, or null for an inline request. When no entry exists (and the
   * registry has room) it starts creation and returns that promise; the caller awaits it
   * before its attempt finishes. The promise never rejects.
   */
  use(
    owner: ChatOwner,
    model: string,
    prefix: StaticPrefix,
    observe: CacheObserver
  ): { key: string; name: string | null; creation: Promise<void> | null } {
    const key = this.key(owner, model, prefix);
    if (!this.supported) return { key, name: null, creation: null };
    this.prune();
    const entry = this.entries.get(key);
    if (entry)
      return {
        key,
        name:
          entry.state === 'ready' && entry.expiresAt - this.now() >= this.reuseMarginMs
            ? entry.name
            : null,
        creation: null
      };
    if (this.entries.size >= this.maxEntries) return { key, name: null, creation: null };
    const ownerKey = `${owner.profileId}\u0000${owner.organizationId}`;
    const created: Entry = {
      key,
      owner: ownerKey,
      state: 'pending',
      name: null,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlSeconds * 1000
    };
    this.entries.set(key, created);
    return { key, name: null, creation: this.create(created, model, prefix, observe) };
  }

  /** Drops an entry the provider refused, so later requests go inline or recreate it. */
  invalidate(key: string, name: string) {
    const entry = this.entries.get(key);
    if (entry?.name === name) this.entries.delete(key);
  }

  private prune() {
    const now = this.now();
    // Expired caches are removed by the provider itself; failed keys are retried after the TTL.
    for (const [key, entry] of this.entries)
      if (entry.state !== 'pending' && entry.expiresAt <= now) this.entries.delete(key);
  }

  private async create(entry: Entry, model: string, prefix: StaticPrefix, observe: CacheObserver) {
    const request: GeminiCacheCreate = {
      model,
      config: {
        ...prefix,
        ttl: `${this.ttlSeconds}s`,
        displayName: `overlord-chat-${entry.key.slice(0, 16)}`
      }
    };
    const started = this.now();
    try {
      const cache = await this.client.createCache!({
        ...request,
        config: { ...request.config, abortSignal: AbortSignal.timeout(this.createTimeoutMs) }
      });
      const reported = cache.expireTime ? Date.parse(cache.expireTime) : NaN;
      try {
        await observe('provider.cache_create', {
          key: entry.key,
          request,
          response: cache,
          elapsedMs: this.now() - started
        });
      } catch {
        // Unrecorded caches are never used; this one expires by TTL.
        entry.state = 'failed';
        return;
      }
      entry.name = cache.name;
      entry.expiresAt = Number.isFinite(reported)
        ? Math.min(entry.expiresAt, reported)
        : entry.expiresAt;
      entry.state = 'ready';
      await this.retireOverflow(entry, observe);
    } catch (error) {
      entry.state = 'failed';
      await observe('provider.cache_create', {
        key: entry.key,
        request,
        error,
        elapsedMs: this.now() - started
      }).catch(() => undefined);
    }
  }

  /** Deletes the owner's oldest ready caches beyond the per-owner bound, from that owner's attempt. */
  private async retireOverflow(current: Entry, observe: CacheObserver) {
    const mine = [...this.entries.values()].filter(
      e => e.owner === current.owner && e.state !== 'failed'
    );
    const retire = mine
      .filter(e => e.state === 'ready' && e !== current)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(0, mine.length - this.maxPerOwner));
    for (const entry of retire) {
      this.entries.delete(entry.key);
      let error: unknown;
      try {
        await this.client.deleteCache!(entry.name!);
      } catch (e) {
        error = e; // An undeleted cache still expires by TTL.
      }
      await observe('provider.cache_delete', {
        key: entry.key,
        name: entry.name,
        reason: 'owner_bound',
        ...(error === undefined ? {} : { error })
      }).catch(() => undefined);
    }
  }
}
