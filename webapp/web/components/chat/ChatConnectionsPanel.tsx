import type { AccountConnectionDto, ChatProviderReadinessDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { api } from '@/lib/api.ts';
import { chatErrorCode, chatErrorMessage } from '@/lib/chat/errors.ts';
import { useChatProviders } from '@/lib/chat/use-chat.ts';
import { getDesktopBridge } from '@/lib/desktop-chrome.ts';
import { keys } from '@/lib/query-keys.ts';

const PROVIDER_STATE: Record<ChatProviderReadinessDto['state'], string> = {
  ready: 'Ready',
  not_configured: 'Not configured on this server',
  unavailable: 'Unavailable right now',
  rate_limited: 'Rate limited, try again shortly'
};

function connectionSummary(connection: AccountConnectionDto | undefined): string {
  if (!connection) return 'Not connected';
  switch (connection.state) {
    case 'connected':
      return connection.authorizedWorkspaces.length
        ? `Connected · ${connection.authorizedWorkspaces.join(', ')}`
        : 'Connected';
    case 'pending':
      return 'Sign-in not finished';
    case 'reauthorization_required':
      return 'Sign in again to keep using your notes';
    default:
      return 'Disconnected';
  }
}

/**
 * Assistant readiness and the caller's Knowledgebase connection. Sign-in opens
 * the server-provided authorization URL: in the same tab on the web (the callback
 * returns to `/settings/connections`), in the system browser from the desktop
 * shell, after which focus returns here and the state is reloaded.
 */
export function ChatConnectionsPanel({ scope }: { scope: string }) {
  const providers = useChatProviders(scope);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingBrowser, setAwaitingBrowser] = useState(false);

  const gemini = providers.data?.providers.find(provider => provider.provider === 'gemini');
  const knowledgebase = providers.data?.connections.find(c => c.provider === 'knowledgebase');
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.chatProviders(scope) });

  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      const { authorizeUrl } = await api.startAccountConnection();
      const bridge = getDesktopBridge();
      if (bridge?.openExternal) {
        await bridge.openExternal(authorizeUrl);
        setAwaitingBrowser(true);
      } else {
        window.location.assign(authorizeUrl);
      }
    } catch (cause) {
      setError(
        chatErrorCode(cause) === 'provider_not_ready'
          ? 'Knowledgebase sign-in is not configured on this server.'
          : chatErrorMessage(cause)
      );
    } finally {
      setPending(false);
    }
  };

  const disconnect = async (connection: AccountConnectionDto) => {
    setPending(true);
    setError(null);
    try {
      await api.disconnectAccountConnection(connection.id);
      await refresh();
    } catch (cause) {
      setError(chatErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  if (providers.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {chatErrorMessage(providers.error)}
      </p>
    );
  }

  return (
    <div className="grid gap-2 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5" />
        <span className="font-medium">Assistant</span>
        <span className="text-(--color-ink-dim)">
          {gemini ? `${gemini.model} · ${PROVIDER_STATE[gemini.state]}` : 'Checking…'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="size-3.5" />
        <span className="font-medium">Knowledgebase</span>
        <span className="text-(--color-ink-dim)">{connectionSummary(knowledgebase)}</span>
        {knowledgebase?.state === 'connected' ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={pending}
            onClick={() => void disconnect(knowledgebase)}
          >
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="xs" disabled={pending} onClick={() => void signIn()}>
            {knowledgebase && knowledgebase.state !== 'pending' ? 'Sign in again' : 'Connect'}
          </Button>
        )}
        {awaitingBrowser ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setAwaitingBrowser(false);
              void refresh();
            }}
          >
            I finished signing in
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
