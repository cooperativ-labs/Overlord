const CONNECTION_STATUSES = new Set(['connected', 'denied', 'expired', 'failed']);

export type ChatSearch = {
  /** Result of a Knowledgebase sign-in, from the `/settings/connections` callback. */
  connection?: 'connected' | 'denied' | 'expired' | 'failed';
};

export function parseChatSearch(search: Record<string, unknown>): ChatSearch {
  const raw = search.connection;
  return typeof raw === 'string' && CONNECTION_STATUSES.has(raw)
    ? { connection: raw as ChatSearch['connection'] }
    : {};
}
