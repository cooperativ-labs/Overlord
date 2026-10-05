import type {
  AccountConnectionDto,
  AccountConnectionListResponse,
  AccountConnectionProvider,
  AccountConnectionProviderStatusDto
} from '@overlord/contract';

/** The web return path of every account-connection callback (contract v152/v153). */
export const CONNECTED_ACCOUNTS_PATH = '/settings/connections';

export const CONNECTION_CALLBACK_STATUSES = ['connected', 'denied', 'expired', 'failed'] as const;
export type ConnectionCallbackStatus = (typeof CONNECTION_CALLBACK_STATUSES)[number];

/** Display order on every surface: assistant sources first, then personal integrations. */
const PROVIDER_ORDER: AccountConnectionProvider[] = ['knowledgebase', 'github', 'everhour'];

export const PROVIDER_COPY: Record<
  AccountConnectionProvider,
  { label: string; description: string }
> = {
  knowledgebase: {
    label: 'Knowledgebase',
    description:
      'Lets the assistant read your notes in this organization, and edit them only in a workspace you allow for a single message.'
  },
  github: {
    label: 'GitHub',
    description:
      'Your personal GitHub account, used to create repositories for new projects. Separate from the workspace GitHub App.'
  },
  everhour: {
    label: 'Everhour',
    description: 'Tracks time on missions as your own Everhour user, in every workspace.'
  }
};

export type ConnectionStatusTone = 'connected' | 'attention' | 'idle' | 'unavailable';

export interface ConnectionRowModel {
  provider: AccountConnectionProvider;
  status: AccountConnectionProviderStatusDto;
  /** The caller's live connection for this provider, if any. */
  connection: AccountConnectionDto | null;
  statusLabel: string;
  tone: ConnectionStatusTone;
  /** Connect, Reconnect, or null when the provider cannot be connected here. */
  connectAction: 'connect' | 'reconnect' | null;
  canDisconnect: boolean;
  detail: string | null;
}

const UNAVAILABLE_LABEL: Record<
  NonNullable<AccountConnectionProviderStatusDto['reason']>,
  string
> = {
  not_offered_on_edition: 'Not available on this server',
  not_configured: 'Not configured on this server',
  encryption_not_configured: 'Not configured on this server'
};

const ERROR_DETAIL: Record<string, string> = {
  invalid_grant: 'The sign-in expired or was revoked.',
  upstream_unauthorized: 'The provider no longer accepts this sign-in.',
  grant_expired: 'The sign-in expired.',
  credential_unreadable: 'The stored credential can no longer be read on this server.',
  insufficient_scope: 'Some requested permissions were not granted.',
  account_in_use: 'That account is already connected to another Overlord user.',
  identity_changed: 'The signed-in account changed.',
  account_lookup_failed: 'The account could not be confirmed.'
};

function liveConnection(
  items: AccountConnectionDto[],
  provider: AccountConnectionProvider
): AccountConnectionDto | null {
  return items.find(item => item.provider === provider && item.state !== 'disconnected') ?? null;
}

/** One row per offered provider, in a stable order, with the same states for every provider. */
export function connectionRows(list: AccountConnectionListResponse): ConnectionRowModel[] {
  const statuses = list.providers ?? [];
  return [...statuses]
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider))
    .map(status => connectionRow(status, liveConnection(list.items, status.provider)));
}

export function connectionRow(
  status: AccountConnectionProviderStatusDto,
  connection: AccountConnectionDto | null
): ConnectionRowModel {
  const base = { provider: status.provider, status, connection };
  const account = connection?.account?.label ?? null;
  if (connection?.state === 'connected') {
    return {
      ...base,
      statusLabel: 'Connected',
      tone: 'connected',
      connectAction: status.available ? 'reconnect' : null,
      canDisconnect: true,
      detail:
        [
          account ? `Connected as ${account}` : null,
          connection.authorizedWorkspaces.length
            ? `Workspaces: ${connection.authorizedWorkspaces.join(', ')}`
            : null
        ]
          .filter(Boolean)
          .join(' · ') || null
    };
  }
  if (connection?.state === 'reauthorization_required') {
    return {
      ...base,
      statusLabel: 'Needs reconnecting',
      tone: 'attention',
      connectAction: status.available ? 'reconnect' : null,
      canDisconnect: true,
      detail:
        (connection.lastErrorCode && ERROR_DETAIL[connection.lastErrorCode]) ??
        (account ? `Was connected as ${account}` : null)
    };
  }
  if (!status.available) {
    return {
      ...base,
      statusLabel: status.reason ? UNAVAILABLE_LABEL[status.reason] : 'Not available',
      tone: 'unavailable',
      connectAction: null,
      // A credential stored earlier stays listed (and removable) while the server lacks a key.
      canDisconnect: connection !== null,
      detail: null
    };
  }
  return {
    ...base,
    statusLabel: connection?.state === 'pending' ? 'Sign-in not finished' : 'Not connected',
    tone: 'idle',
    connectAction: 'connect',
    canDisconnect: false,
    detail: null
  };
}

export function isConnectionCallbackStatus(value: unknown): value is ConnectionCallbackStatus {
  return (
    typeof value === 'string' && (CONNECTION_CALLBACK_STATUSES as readonly string[]).includes(value)
  );
}

export function isAccountConnectionProvider(value: unknown): value is AccountConnectionProvider {
  return typeof value === 'string' && (PROVIDER_ORDER as string[]).includes(value);
}

export function callbackMessage(
  provider: AccountConnectionProvider,
  status: ConnectionCallbackStatus
): string {
  const label = PROVIDER_COPY[provider].label;
  switch (status) {
    case 'connected':
      return `${label} connected.`;
    case 'denied':
      return `${label} access was not granted.`;
    case 'expired':
      return `The ${label} sign-in expired or was already used. Try again.`;
    default:
      return `${label} could not be connected. Try again.`;
  }
}

/**
 * Where to send the browser after a callback lands on Connected accounts. The
 * Knowledgebase callback has no server-side return path, so a sign-in started from
 * Chat records its origin in session storage and is sent back there.
 */
const RETURN_KEY = 'overlord.connections.return';

export function rememberConnectionReturn(
  provider: AccountConnectionProvider,
  path: string,
  storage: Pick<Storage, 'setItem'> | null = safeSessionStorage()
): void {
  if (!isSafeReturnPath(path)) return;
  try {
    storage?.setItem(RETURN_KEY, JSON.stringify({ provider, path }));
  } catch {
    // Storage may be unavailable; the callback then stays on Connected accounts.
  }
}

export function takeConnectionReturn(
  provider: AccountConnectionProvider,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = safeSessionStorage()
): string | null {
  try {
    const raw = storage?.getItem(RETURN_KEY);
    if (!raw) return null;
    storage?.removeItem(RETURN_KEY);
    const parsed = JSON.parse(raw) as { provider?: unknown; path?: unknown };
    return parsed.provider === provider && isSafeReturnPath(parsed.path) ? parsed.path : null;
  } catch {
    return null;
  }
}

/** A relative path on this origin: starts with `/`, not `//` or `/\`, at most 512 characters. */
export function isSafeReturnPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  );
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type ConnectedAccountsSearch = {
  /** Provider to focus, and the provider of a callback result. */
  provider?: AccountConnectionProvider;
  /** Callback result; only meaningful together with `provider`. */
  status?: ConnectionCallbackStatus;
};

export function parseConnectedAccountsSearch(
  search: Record<string, unknown>
): ConnectedAccountsSearch {
  const provider = isAccountConnectionProvider(search.provider) ? search.provider : undefined;
  const status = provider && isConnectionCallbackStatus(search.status) ? search.status : undefined;
  return { ...(provider ? { provider } : {}), ...(status ? { status } : {}) };
}
