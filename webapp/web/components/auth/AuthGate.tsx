import { type ReactNode, useEffect } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { authClient } from '@/lib/auth-client';
import { setDismissalAccount } from '@/lib/dismissed-agent-requests';
import { ResourceAccountContext } from '@/lib/resource-account';

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const session = authClient.useSession();
  const accountId = session.data?.user?.id ?? null;
  // Client-side dismissals are scoped per account (mission-panel-redesign plan §5).
  useEffect(() => setDismissalAccount(accountId), [accountId]);

  if (session.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-4 text-sm text-muted-foreground">
        Loading account…
      </main>
    );
  }

  if (!session.data) {
    return (
      <AuthScreen
        onAuthenticated={async () => {
          await session.refetch();
        }}
      />
    );
  }

  return (
    <ResourceAccountContext.Provider key={accountId} value={accountId}>
      {children}
    </ResourceAccountContext.Provider>
  );
}
