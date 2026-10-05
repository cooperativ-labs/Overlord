import type { ChatSourceKind } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import {
  type ChatOptions,
  ChatStore,
  type SourceChecker
} from '../../packages/core/service/chat/store.ts';

import {
  CALLBACK_PATH,
  CLIENT_METADATA_PATH,
  type ConnectionsConfig,
  connectionsConfigFromEnv
} from './config.ts';
import type { FetchLike } from './egress.ts';
import { KnowledgebaseMcp } from './mcp-client.ts';
import { KnowledgebaseOAuth, OAUTH_SCOPE } from './oauth.ts';
import { AccountConnections } from './service.ts';
import { composeSourceCheckers, knowledgebaseSourceChecker } from './source-check.ts';

/** The wired account-connections module: one instance per backend process. */
export interface ConnectionsRuntime {
  config: ConnectionsConfig;
  connections: AccountConnections;
  knowledgebase: KnowledgebaseMcp | null;
  /** Inject into `Conversations` / `ChatRuns` as `checkSource`. */
  checkSource: SourceChecker;
  /** Client ID Metadata Document, or null when the Knowledgebase is not configured. */
  clientMetadata(): Record<string, unknown> | null;
}

export function createConnectionsRuntime(options: {
  db: DatabaseClient;
  env: NodeJS.ProcessEnv;
  publicBaseUrl: string;
  webReturnOrigin: string | null;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  sourceCheckTtlMs?: number;
  /** Chat limits (e.g. the notification grace period) applied when access loss ends a run. */
  chatLimits?: ChatOptions['limits'];
  /** Checkers for the other source kinds (Overlord entities, repository observations). */
  checkers?: Partial<Record<Exclude<ChatSourceKind, 'knowledgebase'>, SourceChecker>>;
}): ConnectionsRuntime {
  const config = connectionsConfigFromEnv(
    options.env,
    options.publicBaseUrl,
    options.webReturnOrigin
  );
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const clientId = `${config.publicBaseUrl}${CLIENT_METADATA_PATH}`;
  const redirectUri = `${config.publicBaseUrl}${CALLBACK_PATH}`;
  const oauth = config.knowledgebase
    ? new KnowledgebaseOAuth({
        ...config.knowledgebase,
        clientId,
        redirectUri,
        fetch: fetchImpl,
        now: options.now
      })
    : null;
  let knowledgebase: KnowledgebaseMcp | null = null;
  let checkSource: SourceChecker = composeSourceCheckers({ ...options.checkers });
  const connections = new AccountConnections(options.db, {
    config,
    oauth,
    now: options.now,
    sleep: options.sleep,
    listWorkspaces: async token =>
      knowledgebase ? knowledgebase.listWorkspacesWithToken(token) : null,
    // Proactively invalidate every thread that cited this connection, through the shared projection.
    onAccessLost: connectionId =>
      new ChatStore(options.db, {
        checkSource,
        now: options.now,
        limits: options.chatLimits
      }).revalidateConnection(connectionId)
  });
  if (config.knowledgebase)
    knowledgebase = new KnowledgebaseMcp({
      ...config.knowledgebase,
      connections,
      fetch: fetchImpl,
      now: options.now
    });
  checkSource = composeSourceCheckers({
    ...options.checkers,
    ...(knowledgebase
      ? {
          knowledgebase: knowledgebaseSourceChecker(
            knowledgebase,
            async (owner, id) => {
              const row = await connections.row(owner, id);
              return row ? { state: row.state } : null;
            },
            { ttlMs: options.sourceCheckTtlMs, now: options.now }
          )
        }
      : {})
  });
  return {
    config,
    connections,
    knowledgebase,
    get checkSource() {
      return checkSource;
    },
    clientMetadata: () =>
      config.knowledgebase
        ? {
            client_id: clientId,
            client_name: 'Overlord',
            client_uri: config.publicBaseUrl,
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            scope: OAUTH_SCOPE
          }
        : null
  };
}
