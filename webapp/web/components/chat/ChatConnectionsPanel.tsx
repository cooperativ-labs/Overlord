import type { ChatProviderReadinessDto } from '@overlord/contract';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';

import { ConnectionRow } from '@/components/connections/ConnectedAccounts.tsx';
import { chatErrorMessage } from '@/lib/chat/errors.ts';
import { useChatProviders } from '@/lib/chat/use-chat.ts';
import { connectionRow } from '@/lib/connections.ts';

const PROVIDER_STATE: Record<ChatProviderReadinessDto['state'], string> = {
  ready: 'Ready',
  not_configured: 'Not configured on this server',
  unavailable: 'Unavailable right now',
  rate_limited: 'Rate limited, try again shortly'
};

/**
 * Assistant readiness and a shortcut to the caller's Knowledgebase connection. The
 * row is the same one Connected accounts shows; a sign-in started here returns to
 * Chat with its status. Every account is managed on Connected accounts.
 */
export function ChatConnectionsPanel({ scope }: { scope: string }) {
  const providers = useChatProviders(scope);

  if (providers.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {chatErrorMessage(providers.error)}
      </p>
    );
  }

  const gemini = providers.data?.providers.find(provider => provider.provider === 'gemini');
  const knowledgebase =
    providers.data?.connections.find(c => c.provider === 'knowledgebase') ?? null;
  const row = providers.data
    ? connectionRow(
        {
          provider: 'knowledgebase',
          scope: 'organization',
          credentialKind: 'oauth',
          available: true,
          reason: null
        },
        knowledgebase
      )
    : null;

  return (
    <div className="grid gap-2 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5" />
        <span className="font-medium">Assistant</span>
        <span className="text-(--color-ink-dim)">
          {gemini ? `${gemini.model} · ${PROVIDER_STATE[gemini.state]}` : 'Checking…'}
        </span>
      </div>
      {row ? <ConnectionRow row={row} returnPath="/chat" compact /> : null}
      <Link
        to="/settings/connections"
        className="text-(--color-ink-dim) underline-offset-2 hover:underline"
      >
        Manage connected accounts
      </Link>
    </div>
  );
}
