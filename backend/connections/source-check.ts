import type { ChatSourceKind, ChatSourceLocatorDto } from '@overlord/contract';

import type { ChatOwner, SourceChecker } from '../../packages/core/service/chat/store.ts';

import type { KnowledgebaseMcp } from './mcp-client.ts';

/**
 * Dispatches the conversation services' injected source check by locator kind.
 * A kind without a registered checker answers `unknown`, which fails closed.
 */
export function composeSourceCheckers(
  checkers: Partial<Record<ChatSourceKind, SourceChecker>>
): SourceChecker {
  return async (owner, source, signal) => {
    const checker = checkers[source.kind];
    if (!checker) return 'unknown';
    try {
      const state = await checker(owner, source, signal);
      return state === 'authorized' || state === 'revoked' ? state : 'unknown';
    } catch {
      return 'unknown';
    }
  };
}

/**
 * Live Knowledgebase source check. The connection row (owner, organization,
 * state) is consulted on every call, so a disconnect or reauthorization takes
 * effect immediately. Only a positive upstream answer is cached, for `ttlMs`
 * (default 15 s), bounding how often snapshots and replay polls reach the
 * provider; a revocation upstream is therefore observed within `ttlMs`.
 * Concurrent checks of the same node share one upstream call.
 */
export function knowledgebaseSourceChecker(
  mcp: Pick<KnowledgebaseMcp, 'checkNode'>,
  connectionState: (owner: ChatOwner, connectionId: string) => Promise<{ state: string } | null>,
  options: { ttlMs?: number; now?: () => number } = {}
): SourceChecker {
  const ttlMs = options.ttlMs ?? 15_000;
  const now = () => options.now?.() ?? Date.now();
  const cache = new Map<string, number>();
  const inflight = new Map<string, Promise<'authorized' | 'revoked' | 'unknown'>>();
  return async (owner, source: ChatSourceLocatorDto, signal) => {
    if (source.kind !== 'knowledgebase') return 'unknown';
    const connection = await connectionState(owner, source.connectionId);
    if (!connection || connection.state === 'disconnected') return 'revoked';
    if (connection.state !== 'connected') return 'unknown';
    // Keyed by owner as well as connection, so one owner's answer never serves another.
    const key = [
      owner.profileId,
      owner.organizationId,
      source.connectionId,
      source.workspace,
      source.nodeId
    ].join('\u0000');
    const cachedAt = cache.get(key);
    if (cachedAt !== undefined && now() - cachedAt < ttlMs) return 'authorized';
    cache.delete(key);
    let pending = inflight.get(key);
    if (!pending) {
      pending = mcp.checkNode(owner, source, signal).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const state = await pending;
    if (state === 'authorized') cache.set(key, now());
    if (cache.size > 10_000) cache.clear();
    return state;
  };
}
