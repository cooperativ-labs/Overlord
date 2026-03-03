import { Github, Globe, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

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
};

export function SessionsList({ identities }: SessionsListProps) {
  if (identities.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No linked accounts found.
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {identities.map(identity => (
        <div key={identity.id} className="flex items-center gap-4 px-4 py-3">
          <div className="text-muted-foreground">
            <ProviderIcon provider={identity.provider} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {PROVIDER_LABELS[identity.provider] ?? identity.provider}
            </p>
            {identity.email && (
              <p className="text-xs text-muted-foreground truncate">{identity.email}</p>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground shrink-0">
            <p>Linked {formatDate(identity.createdAt)}</p>
            {identity.lastSignInAt && <p>Last used {formatDate(identity.lastSignInAt)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
