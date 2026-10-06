import type { AccountConnectionDto, AccountConnectionProvider } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Clock3, FolderGit2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError } from '@/lib/api.ts';
import {
  type ConnectionRowModel,
  connectionRows,
  type ConnectionStatusTone,
  PROVIDER_COPY,
  rememberConnectionReturn
} from '@/lib/connections.ts';
import { getDesktopBridge } from '@/lib/desktop-chrome.ts';
import {
  invalidateAfterConnectionChange,
  useAccountConnections,
  useDisconnectAccountConnection,
  useSetAccountConnectionApiKey,
  useStartAccountConnection,
  useUpdateAccountConnection
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const PROVIDER_ICON: Record<AccountConnectionProvider, LucideIcon> = {
  knowledgebase: BookOpen,
  github: FolderGit2,
  everhour: Clock3
};

const TONE_CLASS: Record<ConnectionStatusTone, string> = {
  connected: 'bg-emerald-500/15 text-emerald-600',
  attention: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  idle: 'bg-muted text-muted-foreground',
  unavailable: 'bg-muted text-muted-foreground'
};

function connectionErrorMessage(provider: AccountConnectionProvider, error: unknown): string {
  const label = PROVIDER_COPY[provider].label;
  if (!(error instanceof ApiRequestError)) return `Could not reach the server. Try again.`;
  switch (error.code) {
    case 'credential_rejected':
      return `${label} rejected this API key. Check it and try again.`;
    case 'provider_not_ready':
      return `${label} can't be connected on this server yet. Ask an administrator to finish the account-connection setup.`;
    case 'provider_not_available':
    case 'chat_unavailable':
      return `${label} is not available on this server.`;
    case 'provider_unavailable':
      return `${label} could not be reached. Try again shortly.`;
    case 'limit_exceeded':
      return 'Too many sign-ins are open. Wait a few minutes and try again.';
    case 'invalid_request':
      return provider === 'everhour' ? 'Enter a valid Everhour API key.' : error.message;
    default:
      return error.message;
  }
}

/**
 * Knowledgebase write scope (contract v158). Off: the assistant edits only the workspace
 * allowed on a single message. On: it reads and writes every workspace this connection is
 * authorized for, in every conversation, until turned off (which takes effect at once).
 */
function KnowledgebaseWriteScope({ connection }: { connection: AccountConnectionDto }) {
  const update = useUpdateAccountConnection();
  const [error, setError] = useState<string | null>(null);
  const checked = connection.assistantWriteScope === 'all_workspaces';
  const id = `knowledgebase-write-scope-${connection.id}`;
  const workspaces = connection.authorizedWorkspaces;

  async function onChange(next: boolean) {
    setError(null);
    try {
      await update.mutateAsync({
        id: connection.id,
        body: {
          expectedRevision: connection.revision,
          assistantWriteScope: next ? 'all_workspaces' : 'per_request'
        }
      });
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError && cause.code === 'stale_revision'
          ? 'This connection changed elsewhere. Review the setting and try again.'
          : connectionErrorMessage('knowledgebase', cause)
      );
    }
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={next => void onChange(next)}
        />
        <label htmlFor={id} className="text-xs font-medium">
          Let the assistant edit notes in all authorized workspaces
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {checked
          ? `The assistant can read and write ${workspaces.length ? workspaces.join(', ') : 'every workspace this account can access'} in any conversation, without asking per message.`
          : 'Off: the assistant only edits the workspace you allow on a single message.'}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One account connection. Every provider shows the same status chip and the same
 * Connect / Reconnect and Disconnect actions; only how a credential is supplied
 * differs (an OAuth sign-in page, or an API key that is sent once and never shown).
 */
export function ConnectionRow({
  row,
  returnPath,
  openKeyForm = false,
  compact = false
}: {
  row: ConnectionRowModel;
  /** Where an OAuth callback returns on this origin (defaults to Connected accounts). */
  returnPath?: string;
  /** Open the API-key form immediately (deep link `?provider=everhour`). */
  openKeyForm?: boolean;
  compact?: boolean;
}) {
  const { provider } = row;
  const copy = PROVIDER_COPY[provider];
  const Icon = PROVIDER_ICON[provider];
  const qc = useQueryClient();
  const start = useStartAccountConnection();
  const setKey = useSetAccountConnectionApiKey();
  const disconnect = useDisconnectAccountConnection();
  const [keyFormOpen, setKeyFormOpen] = useState(
    openKeyForm &&
      row.status.credentialKind === 'api_key' &&
      row.connectAction !== null &&
      row.tone !== 'connected'
  );
  const [apiKey, setApiKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [awaitingBrowser, setAwaitingBrowser] = useState(false);
  // The browser is leaving for the provider's sign-in page; keep the button busy.
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = start.isPending || redirecting || setKey.isPending || disconnect.isPending;

  useEffect(() => {
    // Returning with the Back button restores this page from the cache mid-redirect.
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  async function beginOAuth() {
    setError(null);
    try {
      const { authorizeUrl } = await start.mutateAsync({ provider, returnPath });
      const bridge = getDesktopBridge();
      if (bridge?.openExternal) {
        await bridge.openExternal(authorizeUrl);
        setAwaitingBrowser(true);
        return;
      }
      // Knowledgebase has no server-side return path; remember where to come back to.
      if (provider === 'knowledgebase' && returnPath)
        rememberConnectionReturn(provider, returnPath);
      setRedirecting(true);
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setError(connectionErrorMessage(provider, cause));
    }
  }

  async function saveKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(`Enter your ${copy.label} API key.`);
      return;
    }
    setError(null);
    try {
      await setKey.mutateAsync({ provider, apiKey: trimmed });
      setApiKey('');
      setKeyFormOpen(false);
    } catch (cause) {
      setError(connectionErrorMessage(provider, cause));
    }
  }

  async function confirmDisconnect() {
    if (!row.connection) return;
    setError(null);
    try {
      await disconnect.mutateAsync({ id: row.connection.id, provider });
      setConfirmOpen(false);
    } catch (cause) {
      setConfirmOpen(false);
      setError(connectionErrorMessage(provider, cause));
    }
  }

  function onConnect() {
    if (row.status.credentialKind === 'api_key') {
      setError(null);
      setKeyFormOpen(open => !open);
    } else {
      void beginOAuth();
    }
  }

  return (
    <div
      data-provider={provider}
      className={cn('grid gap-2', compact ? 'text-xs' : 'rounded-lg border border-border p-4')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('shrink-0', compact ? 'size-3.5' : 'size-4')} aria-hidden />
        <span className={cn('font-medium', compact ? '' : 'text-sm')}>{copy.label}</span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
            TONE_CLASS[row.tone]
          )}
        >
          {row.statusLabel}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {row.connectAction ? (
            <Button
              type="button"
              size="xs"
              variant={
                row.connectAction === 'connect' || row.tone === 'attention' ? 'default' : 'outline'
              }
              disabled={busy}
              onClick={onConnect}
            >
              {start.isPending || redirecting
                ? `Opening ${copy.label}…`
                : row.connectAction === 'connect'
                  ? 'Connect'
                  : 'Reconnect'}
            </Button>
          ) : null}
          {row.canDisconnect ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
      {!compact ? <p className="text-xs text-muted-foreground">{copy.description}</p> : null}
      {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
      {!compact && provider === 'knowledgebase' && row.connection?.state === 'connected' ? (
        <KnowledgebaseWriteScope connection={row.connection} />
      ) : null}

      {keyFormOpen ? (
        <form
          className="grid gap-1.5"
          onSubmit={event => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <label htmlFor={`${provider}-api-key`} className="text-xs font-medium">
            {copy.label} API key
          </label>
          <div className="flex gap-2">
            <Input
              id={`${provider}-api-key`}
              type="password"
              autoComplete="off"
              autoFocus
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              className="h-8 font-mono text-xs"
            />
            <Button type="submit" size="sm" className="h-8 shrink-0" disabled={busy}>
              {setKey.isPending ? 'Checking…' : 'Save'}
            </Button>
          </div>
          {provider === 'everhour' ? (
            <p className="text-xs text-muted-foreground">
              Find your key in Everhour under Account → Profile, at the bottom. It is checked with
              Everhour, stored encrypted on the server, and never shown again.
            </p>
          ) : null}
        </form>
      ) : null}

      {awaitingBrowser ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Finish signing in to {copy.label} in your browser.</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setAwaitingBrowser(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setAwaitingBrowser(false);
              void invalidateAfterConnectionChange(qc, provider);
            }}
          >
            I finished signing in
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disconnect {copy.label}?</DialogTitle>
            <DialogDescription>
              Overlord erases the stored credential. You can connect again at any time.
              {provider === 'everhour' ? ' Timers stay hidden until you reconnect.' : null}
              {provider === 'knowledgebase'
                ? ' Conversations that cited your notes will show those sources as unavailable.'
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() => void confirmDisconnect()}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Connected accounts: the one place to manage every external account connection. */
export function ConnectedAccounts({
  focusProvider
}: {
  /** Scroll to this provider's row and, for an API-key provider, open its form. */
  focusProvider?: AccountConnectionProvider;
}) {
  const connections = useAccountConnections();
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = connections.data ? connectionRows(connections.data) : [];

  useEffect(() => {
    if (!focusProvider || !rows.length) return;
    containerRef.current
      ?.querySelector(`[data-provider="${focusProvider}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusProvider, rows.length]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Connected accounts</h2>
        <p className="text-sm text-muted-foreground">
          Accounts you connect belong to you. Credentials are encrypted on the server and never sent
          back to the browser.
        </p>
      </div>
      {connections.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading connected accounts…
        </p>
      ) : connections.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {connections.error instanceof Error
              ? connections.error.message
              : 'Connected accounts could not be loaded.'}
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={connections.isFetching}
            onClick={() => void connections.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div ref={containerRef} className="grid max-w-xl gap-3">
          {rows.map(row => (
            <ConnectionRow
              key={row.provider}
              row={row}
              openKeyForm={focusProvider === row.provider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
