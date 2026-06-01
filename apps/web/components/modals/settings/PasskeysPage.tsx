'use client';

import { useCallback, useEffect, useState } from 'react';

import { PasskeysList } from '@/components/features/account/passkeys-list';
import { RegisterPasskeyButton } from '@/components/features/account/register-passkey-button';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { listPasskeysAction, type PasskeyEntry } from '@/lib/actions/passkeys';

type PasskeysPageProps = {
  open: boolean;
};

export function PasskeysPage({ open }: PasskeysPageProps) {
  const [passkeys, setPasskeys] = useState<PasskeyEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await listPasskeysAction();
      setPasskeys(loaded);
    } catch (err) {
      console.error('Failed to load passkeys:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load passkeys.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setErrorMessage(null);
      return;
    }
    void loadPasskeys();
  }, [open, loadPasskeys]);

  if (isLoading && !passkeys) {
    return <p className="text-sm text-muted-foreground">Loading passkeys...</p>;
  }

  if (!passkeys) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {errorMessage ?? 'Passkeys are unavailable right now.'}
        </p>
        <Button variant="outline" onClick={() => void loadPasskeys()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Passkeys</h2>
          <p className="text-muted-foreground text-sm">
            Passkeys let you sign in with your device&apos;s biometrics or security key instead of a
            password.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Add a passkey</p>
            <p className="text-sm text-muted-foreground">
              Register a fingerprint, face, or security key for fast, passwordless sign-in.
            </p>
          </div>
          <RegisterPasskeyButton onRegistered={loadPasskeys} />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Registered passkeys</h3>
          <p className="text-muted-foreground text-sm">
            Manage the passkeys linked to your account. You can rename or remove them at any time.
          </p>
        </div>
        <PasskeysList passkeys={passkeys} onChanged={loadPasskeys} />
      </div>
    </div>
  );
}
