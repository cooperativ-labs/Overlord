import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { ConnectedAccounts } from '@/components/connections/ConnectedAccounts.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  callbackMessage,
  type ConnectedAccountsSearch,
  takeConnectionReturn
} from '@/lib/connections.ts';
import { invalidateAfterConnectionChange } from '@/lib/queries.ts';

/**
 * `/settings/connections`: Connected accounts, and the web return path of every
 * account-connection callback. The callback carries only `provider` and `status`;
 * the page reloads connection state and shows the result. A Knowledgebase sign-in
 * started from Chat goes back to Chat with the same status.
 */
export function ConnectedAccountsPage() {
  const search = useSearch({ strict: false }) as ConnectedAccountsSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const { provider, status } = search;

  useEffect(() => {
    if (!provider || !status) return;
    void invalidateAfterConnectionChange(qc, provider);
    const back = takeConnectionReturn(provider);
    if (back === '/chat') {
      void navigate({ to: '/chat', search: { connection: status }, replace: true });
      return;
    }
    setNotice(callbackMessage(provider, status));
    // Drop the status so a reload does not repeat the notice; keep the provider focus.
    void navigate({ to: '.', search: { provider }, replace: true });
  }, [provider, status, qc, navigate]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      {notice ? (
        <div
          role="status"
          className="flex flex-none items-center justify-between border-b bg-(--color-bg-subtle) px-6 py-2 text-xs"
        >
          <span>{notice}</span>
          <Button variant="ghost" size="xs" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-3xl px-6 pb-8 pt-6">
        <ConnectedAccounts focusProvider={provider} />
      </div>
    </div>
  );
}
