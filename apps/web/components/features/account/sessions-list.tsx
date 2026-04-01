'use client';

import { Github, Globe, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

import { DisconnectIdentityButton } from '@/components/features/account/disconnect-identity-button';
import type { OAuthIdentity } from '@/lib/actions/account';

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email / Password',
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  slack: 'Slack',
  discord: 'Discord',
  twitter: 'Twitter / X',
  azure: 'Microsoft Azure',
  facebook: 'Facebook'
};

function ProviderIcon({ provider }: { provider: string }): ReactNode {
  switch (provider) {
    case 'github':
      return <Github className="size-4" />;
    case 'email':
      return <Mail className="size-4" />;
    default:
      return <Globe className="size-4" />;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

type SessionsListProps = {
  identities: OAuthIdentity[];
  onDisconnected?: () => void;
};

export function SessionsList({ identities, onDisconnected }: SessionsListProps) {
  if (identities.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          No linked accounts found.
        </div>
        <p className="text-sm text-muted-foreground">
          Add a sign-in method from the Profile tab before removing your current one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        You can disconnect linked OAuth accounts here. If this is your only sign-in method, add
        another one in Profile first so you do not lose access.
      </p>
      <div className="divide-y rounded-lg border">
        {identities.map(identity => (
          <div
            key={identity.id}
            className="flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center"
          >
            <div className="text-muted-foreground">
              <ProviderIcon provider={identity.provider} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {PROVIDER_LABELS[identity.provider] ?? identity.provider}
              </p>
              {identity.email && (
                <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
              )}
              {identity.provider === 'email' ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Email/password stays connected until you add a different primary login method.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="text-right text-xs text-muted-foreground">
                <p>Linked {formatDate(identity.createdAt)}</p>
                {identity.lastSignInAt && <p>Last used {formatDate(identity.lastSignInAt)}</p>}
              </div>
              {identity.provider !== 'email' ? (
                identities.length > 1 ? (
                  <DisconnectIdentityButton
                    identityId={identity.identityId}
                    provider={identity.provider}
                    onDisconnected={onDisconnected}
                  />
                ) : (
                  <p className="max-w-56 text-right text-xs text-muted-foreground">
                    Add another sign-in method before disconnecting this account.
                  </p>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
