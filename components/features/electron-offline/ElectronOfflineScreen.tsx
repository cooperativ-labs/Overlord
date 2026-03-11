'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

type Props = {
  onRetry: () => Promise<boolean>;
};

export function ElectronOfflineScreen({ onRetry }: Props) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  async function handleRetry() {
    setIsRetrying(true);
    setRetryFailed(false);
    const connected = await onRetry();
    setIsRetrying(false);
    if (!connected) {
      setRetryFailed(true);
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-full bg-muted p-5">
          <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">No Internet Connection</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Overlord is having trouble connecting to the Internet. Check your network connection and
            try again.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button onClick={handleRetry} disabled={isRetrying} variant="default" size="default">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
          {isRetrying ? 'Checking connection...' : 'Try Again'}
        </Button>

        {retryFailed && (
          <p className="text-xs text-muted-foreground">
            Still no connection. Overlord will reconnect automatically when the network is
            available.
          </p>
        )}
      </div>
    </div>
  );
}
